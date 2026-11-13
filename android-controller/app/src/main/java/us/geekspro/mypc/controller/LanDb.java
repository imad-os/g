package us.geekspro.mypc.controller;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * The room hub of My PC on the home network (owner request 2026-11-13): when the internet is missing or limited, multiplayer
 * rooms (js/core/rooms.js) live here instead of Firestore. LanServer routes POST /db to handle(body). Same protocol and limits
 * as tools/lan-hub.mjs (the tests run that one); see js/core/lan-db.js:
 *   { op: get | set | merge | del | list, path | parent + coll, data, fields, exists, limit } -> { t, data | docs | err }
 * In memory only, nothing on disk; documents expire at their "exp" (ISO time or ms), else 1 hour after the last write.
 */
final class LanDb {
    private static final int MAX_DOCS = 400, MAX_DOC = 8192;
    private static final long NO_EXP_TTL = 3600000L;
    private static final Pattern SEG = Pattern.compile("^[A-Za-z0-9_-]{1,64}$");

    private static final class Doc { JSONObject data; long w; Doc(JSONObject d, long t) { data = d; w = t; } }
    private final Map<String, Doc> docs = new LinkedHashMap<>();

    private static long exp(Doc d) {
        Object e = d.data.opt("exp");
        try {
            if (e instanceof String) return Instant.parse((String) e).toEpochMilli();
            if (e instanceof Number) return ((Number) e).longValue();
        } catch (Exception ignored) { }
        return d.w + NO_EXP_TTL;
    }
    private void sweep(long now) {
        Iterator<Map.Entry<String, Doc>> it = docs.entrySet().iterator();
        while (it.hasNext()) if (exp(it.next().getValue()) < now) it.remove();
    }
    private static boolean seg(String s) { return s != null && SEG.matcher(s).matches(); }
    private static boolean docPath(String p) {
        if (p == null || p.isEmpty()) return false;
        String[] s = p.split("/", -1);
        if (s.length % 2 != 0 || s.length > 6) return false;
        for (String x : s) if (!seg(x)) return false;
        return true;
    }
    private static String out(long now, String key, Object val) {
        try {
            JSONObject o = new JSONObject();
            o.put("t", now);
            if (key != null) o.put(key, val);
            return o.toString();
        } catch (Exception e) { return "{\"err\":\"invalid\"}"; }
    }
    private static String err(long now, String code) { return out(now, "err", code); }

    synchronized String handle(String body) {
        long now = System.currentTimeMillis();
        JSONObject q;
        try { q = new JSONObject(body); } catch (Exception e) { return err(now, "invalid"); }
        sweep(now);
        String op = q.optString("op", "");
        try {
            if ("list".equals(op)) {
                String parent = q.optString("parent", ""), coll = q.optString("coll", "");
                if ((!parent.isEmpty() && !docPath(parent)) || !seg(coll)) return err(now, "invalid");
                String pre = (parent.isEmpty() ? "" : parent + "/") + coll + "/";
                int lim = q.optInt("limit", 50);
                if (lim < 1) lim = 50;
                if (lim > 100) lim = 100;
                List<Map.Entry<String, Doc>> hits = new ArrayList<>();
                for (Map.Entry<String, Doc> en : docs.entrySet()) {
                    String p = en.getKey();
                    if (p.startsWith(pre) && p.indexOf('/', pre.length()) < 0) hits.add(en);
                }
                Collections.sort(hits, (a, b) -> Long.compare(b.getValue().w, a.getValue().w));
                JSONArray arr = new JSONArray();
                for (int i = 0; i < hits.size() && i < lim; i++) {
                    JSONObject d = new JSONObject();
                    d.put("id", hits.get(i).getKey().substring(pre.length()));
                    d.put("data", hits.get(i).getValue().data);
                    arr.put(d);
                }
                return out(now, "docs", arr);
            }
            String path = q.optString("path", "");
            if (!docPath(path)) return err(now, "invalid");
            Doc cur = docs.get(path);
            if ("get".equals(op)) return cur == null ? err(now, "notfound") : out(now, "data", cur.data);
            if ("del".equals(op)) {
                Iterator<String> it = docs.keySet().iterator();
                while (it.hasNext()) { String p = it.next(); if (p.equals(path) || p.startsWith(path + "/")) it.remove(); }
                return out(now, null, null);
            }
            if ("set".equals(op) || "merge".equals(op)) {
                JSONObject in = q.optJSONObject("data");
                if (in == null) return err(now, "invalid");
                Object ex = q.opt("exists");
                if (Boolean.TRUE.equals(ex) && cur == null) return err(now, "notfound");
                if (Boolean.FALSE.equals(ex) && cur != null) return err(now, "conflict");
                JSONObject data;
                if ("set".equals(op) || cur == null) data = new JSONObject(in.toString());
                else {
                    data = new JSONObject(cur.data.toString());
                    JSONArray fields = q.optJSONArray("fields");
                    List<String> names = new ArrayList<>();
                    if (fields != null) for (int i = 0; i < fields.length(); i++) names.add(fields.optString(i, ""));
                    else { Iterator<String> k = in.keys(); while (k.hasNext()) names.add(k.next()); }
                    for (String f : names) {
                        if (f.isEmpty()) continue;
                        if (in.has(f)) data.put(f, in.get(f)); else data.remove(f);
                    }
                }
                if (data.toString().length() > MAX_DOC) return err(now, "invalid");
                if (cur == null && docs.size() >= MAX_DOCS) return err(now, "full");
                docs.put(path, new Doc(data, now));
                return out(now, null, null);
            }
        } catch (Exception e) {
            return err(now, "invalid");
        }
        return err(now, "invalid");
    }
}
