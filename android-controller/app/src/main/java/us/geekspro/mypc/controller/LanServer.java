package us.geekspro.mypc.controller;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;

/**
 * The phone's small web server on the home network (port 47800): a TV web app cannot listen on a port, so the TV is always
 * the one that asks, and this server answers. No internet server is involved.
 *
 *   GET  /mypc/hello                     {"app":"mypc","v":1,"name":"<phone>","id":"<random per install>","share":1,"db":1}
 *                                        (what the TV's scan looks for, js/core/lan.js)
 *   GET  /mypc/inbox?tv=&name=&since=&wait=   the shares this phone sends to that TV, newer than since (a long poll: answers at
 *                                        once when there is one, else after wait seconds, 25 at most). Every call also tells the
 *                                        phone that this TV's Receiver is open (the phone's Send to TV screen lists it).
 *                                        {"seq":n,"items":[{"id","seq","kind":"text"|"file","mime","name","size","text","subject"}]}
 *   GET  /mypc/file/<id>?tv=             the shared file, with Range (the TV's player streams a video / song straight from here).
 *                                        Only for the TV it was sent to, from that TV's address; tv=net:<code> = a TV it was sent
 *                                        to over the internet (the id came through its Firestore inbox); and the phone's own page
 *                                        (127.0.0.1, it shrinks a photo before sending it over the internet).
 *   POST /mypc/ack/<id>?tv=              the TV opened it
 *   POST /db                             the local rooms hub of the offline multiplayer (LanDb.handle, JSON in and out)
 *   OPTIONS *                            CORS / Private Network Access preflight
 *
 * A share waits for the user to pick the TV on the phone (Send to TV screen), or goes at once to the TV picked with "Always send
 * to this TV" while that TV's Receiver is open. The ids are 128 random bits. Plain Java (no Android classes): MainActivity gives it
 * a Files callback for content:// files and hears every change through Listener.
 */
final class LanServer {
    static final int PORT = 47800;
    private static final int MAX_ITEMS = 40, MAX_BODY = 16 * 1024, TV_GONE_MS = 40000, MAX_WAIT = 25;

    interface Files {
        /** opens a shared file (content:// on Android); null when it cannot be read any more */
        InputStream open(String uri) throws IOException;
    }
    interface Listener { void changed(); }

    static final class Item {
        final String id, kind, mime, name, text, subject, uri;
        final long size, at;
        final int seq;
        String tv = "";          // the TV it goes to ("" = waiting for the user, unless a TV is remembered)
        String state = "wait";   // wait | sent (the TV can take it) | taken (the TV opened it) | failed
        Item(String id, int seq, String kind, String mime, String name, long size, String text, String subject, String uri) {
            this.id = id; this.seq = seq; this.kind = kind; this.mime = mime; this.name = name; this.size = size;
            this.text = text; this.subject = subject; this.uri = uri; this.at = System.currentTimeMillis();
        }
    }
    static final class Tv { String id, name, ip; long at; }

    private final Files files;
    private final Listener listener;
    private final LanDb db = new LanDb();
    private final String phoneName, phoneId;
    private final List<Item> items = new ArrayList<>();
    private final Map<String, Tv> tvs = new LinkedHashMap<>();
    private final SecureRandom rnd = new SecureRandom();
    private String remembered = "";
    private int seq = 0;
    private ServerSocket server;
    private ExecutorService pool;
    private volatile boolean running;

    LanServer(String phoneName, String phoneId, String rememberedTv, Files files, Listener listener) {
        this.phoneName = phoneName; this.phoneId = phoneId; this.remembered = rememberedTv == null ? "" : rememberedTv;
        this.files = files; this.listener = listener;
    }

    /* ---------------- life ---------------- */

    synchronized void start() {
        if (running) return;
        try {
            server = new ServerSocket();
            server.setReuseAddress(true);
            server.bind(new InetSocketAddress(PORT));
        } catch (IOException e) {
            server = null;
            return;                                              // the port is taken: nothing shared on the network this time
        }
        running = true;
        pool = Executors.newCachedThreadPool(daemon("mypc-lan"));
        final ServerSocket s = server;
        Thread t = new Thread(() -> {
            while (running) {
                try {
                    Socket c = s.accept();
                    pool.execute(() -> serve(c));
                } catch (IOException e) { if (!running) break; }
                catch (RuntimeException e) { /* the pool is shutting down */ }
            }
        }, "mypc-lan-accept");
        t.setDaemon(true);
        t.start();
    }

    synchronized void stop() {
        running = false;
        try { if (server != null) server.close(); } catch (IOException e) { /* closed */ }
        server = null;
        if (pool != null) pool.shutdownNow();
        pool = null;
        synchronized (items) { items.notifyAll(); }
    }

    boolean listening() { return running; }

    private static ThreadFactory daemon(String name) {
        return r -> { Thread t = new Thread(r, name); t.setDaemon(true); return t; };
    }

    /* ---------------- what the phone's page asks (Bridge) ---------------- */

    String newId() {
        byte[] b = new byte[16];
        rnd.nextBytes(b);
        StringBuilder s = new StringBuilder();
        for (byte x : b) s.append(String.format(Locale.ROOT, "%02x", x));
        return s.toString();
    }

    void addText(String text, String subject) { add(new Item(newId(), 0, "text", "text/plain", "", text.length(), text, subject == null ? "" : subject, null)); }
    void addFile(String uri, String mime, String name, long size) { add(new Item(newId(), 0, "file", mime == null ? "application/octet-stream" : mime, name == null ? "file" : name, size, "", "", uri)); }

    private void add(Item proto) {
        synchronized (items) {
            Item it = new Item(proto.id, ++seq, proto.kind, proto.mime, proto.name, proto.size, proto.text, proto.subject, proto.uri);
            Tv tv = tvs.get(remembered);
            if (!remembered.isEmpty() && tv != null && alive(tv)) { it.tv = remembered; it.state = "sent"; }
            items.add(it);
            while (items.size() > MAX_ITEMS) items.remove(0);
            items.notifyAll();
        }
        changed();
    }

    /** sends the items still waiting (id "" = all of them) to that TV; remember = "Always send to this TV" */
    void send(String id, String tv, boolean remember) {
        synchronized (items) {
            for (Item it : items) if ((id.isEmpty() && "wait".equals(it.state)) || it.id.equals(id)) { it.tv = tv; it.state = "sent"; }
            if (remember) remembered = tv;
            items.notifyAll();
        }
        changed();
    }

    /** the page's own news about an item sent over the internet: taken (the TV deleted it) or failed */
    void mark(String id, String state) {
        if (!"taken".equals(state) && !"failed".equals(state)) return;
        synchronized (items) { for (Item it : items) if (it.id.equals(id)) it.state = state; }
        changed();
    }

    void forgetTv() { synchronized (items) { remembered = ""; } changed(); }
    String rememberedTv() { synchronized (items) { return remembered; } }

    void remove(String id) {
        synchronized (items) {
            for (int i = items.size() - 1; i >= 0; i--) if (id.isEmpty() || items.get(i).id.equals(id)) items.remove(i);
        }
        changed();
    }

    /** {"ip","port","listening","name","tv" (remembered),"tvs":[{id,name,ip,open}],"items":[{id,kind,mime,name,size,text,state,tv,at}]} */
    String info() {
        JSONObject o = new JSONObject();
        try {
            o.put("ip", localIp()); o.put("port", PORT); o.put("listening", running); o.put("name", phoneName);
            synchronized (items) {
                o.put("tv", remembered);
                JSONArray t = new JSONArray();
                for (Tv v : tvs.values()) t.put(new JSONObject().put("id", v.id).put("name", v.name).put("ip", v.ip).put("open", alive(v)));
                o.put("tvs", t);
                JSONArray a = new JSONArray();
                for (Item it : items) a.put(itemJson(it).put("state", it.state).put("tv", it.tv).put("at", it.at));
                o.put("items", a);
            }
        } catch (JSONException e) { /* not with these values */ }
        return o.toString();
    }

    private static boolean alive(Tv t) { return System.currentTimeMillis() - t.at < TV_GONE_MS; }
    private void changed() { if (listener != null) { try { listener.changed(); } catch (RuntimeException e) { /* the page is gone */ } } }

    /** the phone's address on the Wi-Fi (or any private IPv4) */
    static String localIp() {
        String any = "";
        try {
            for (Enumeration<NetworkInterface> e = NetworkInterface.getNetworkInterfaces(); e != null && e.hasMoreElements(); ) {
                NetworkInterface n = e.nextElement();
                if (!n.isUp() || n.isLoopback()) continue;
                for (Enumeration<InetAddress> a = n.getInetAddresses(); a.hasMoreElements(); ) {
                    InetAddress x = a.nextElement();
                    if (!(x instanceof Inet4Address) || !x.isSiteLocalAddress()) continue;
                    String name = n.getName().toLowerCase(Locale.ROOT);
                    if (name.startsWith("wlan") || name.startsWith("eth") || name.startsWith("ap")) return x.getHostAddress();
                    if (any.isEmpty()) any = x.getHostAddress();
                }
            }
        } catch (Exception e) { /* no network */ }
        return any;
    }

    /* ---------------- HTTP ---------------- */

    private static final class Req {
        String method = "", path = "", query = "", range = "", ip = "";
        byte[] body = new byte[0];
        String q(String k) {
            for (String p : query.split("&")) {
                int i = p.indexOf('=');
                String n = i < 0 ? p : p.substring(0, i);
                if (n.equals(k)) { try { return URLDecoder.decode(i < 0 ? "" : p.substring(i + 1), "UTF-8"); } catch (Exception e) { return ""; } }
            }
            return "";
        }
    }

    private void serve(Socket c) {
        try (Socket s = c) {
            s.setSoTimeout(15000);
            InputStream in = new BufferedInputStream(s.getInputStream());
            OutputStream out = s.getOutputStream();
            Req r = read(in);
            if (r == null) return;
            r.ip = s.getInetAddress().getHostAddress();
            route(r, out);
            out.flush();
        } catch (SocketTimeoutException e) { /* the TV went quiet */ }
        catch (IOException e) { /* the TV closed the connection (a stopped video, a scan that gave up) */ }
        catch (RuntimeException e) { /* never takes the app down */ }
    }

    private static String line(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        for (int ch; (ch = in.read()) >= 0; ) {
            if (ch == '\n') break;
            if (ch != '\r') b.write(ch);
            if (b.size() > 8192) throw new IOException("line too long");
        }
        return b.toString("ISO-8859-1");
    }

    private static Req read(InputStream in) throws IOException {
        String first = line(in);
        String[] p = first.split(" ");
        if (p.length < 2) return null;
        Req r = new Req();
        r.method = p[0].toUpperCase(Locale.ROOT);
        int q = p[1].indexOf('?');
        r.path = q < 0 ? p[1] : p[1].substring(0, q);
        r.query = q < 0 ? "" : p[1].substring(q + 1);
        int len = 0;
        for (int n = 0; n < 60; n++) {
            String h = line(in);
            if (h.isEmpty()) break;
            int i = h.indexOf(':');
            if (i < 0) continue;
            String k = h.substring(0, i).trim().toLowerCase(Locale.ROOT), v = h.substring(i + 1).trim();
            if (k.equals("content-length")) { try { len = Integer.parseInt(v); } catch (NumberFormatException e) { len = 0; } }
            else if (k.equals("range")) r.range = v;
        }
        if (len > MAX_BODY) return null;
        if (len > 0) {
            byte[] b = new byte[len];
            int got = 0;
            while (got < len) { int n = in.read(b, got, len - got); if (n < 0) break; got += n; }
            r.body = b;
        }
        return r;
    }

    private static void head(OutputStream out, int code, String type, long length, String extra) throws IOException {
        String msg = code == 200 ? "OK" : code == 204 ? "No Content" : code == 206 ? "Partial Content" : code == 404 ? "Not Found" : code == 416 ? "Range Not Satisfiable" : "Error";
        StringBuilder h = new StringBuilder("HTTP/1.1 ").append(code).append(' ').append(msg).append("\r\n")
                .append("Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Private-Network: true\r\n")
                .append("Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges\r\n")
                .append("Cache-Control: no-store\r\nConnection: close\r\n");
        if (type != null) h.append("Content-Type: ").append(type).append("\r\n");
        if (length >= 0) h.append("Content-Length: ").append(length).append("\r\n");
        if (extra != null) h.append(extra);
        h.append("\r\n");
        out.write(h.toString().getBytes(StandardCharsets.ISO_8859_1));
    }

    private static void json(OutputStream out, int code, String body) throws IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        head(out, code, "application/json; charset=utf-8", b.length, null);
        out.write(b);
    }

    private void route(Req r, OutputStream out) throws IOException {
        if (r.method.equals("OPTIONS")) {
            head(out, 204, null, 0, "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nAccess-Control-Max-Age: 600\r\n");
            return;
        }
        String path = r.path;
        if (path.equals("/mypc/hello")) {
            json(out, 200, "{\"app\":\"mypc\",\"v\":1,\"name\":" + JSONObject.quote(phoneName) + ",\"id\":" + JSONObject.quote(phoneId) + ",\"share\":1,\"db\":1}");
            return;
        }
        if (path.equals("/db") && r.method.equals("POST")) {
            String res;
            try { res = db.handle(new String(r.body, StandardCharsets.UTF_8)); } catch (RuntimeException e) { res = "{\"error\":\"db\"}"; }
            json(out, 200, res == null ? "{}" : res);
            return;
        }
        if (path.equals("/mypc/inbox")) { inbox(r, out); return; }
        if (path.startsWith("/mypc/file/")) { file(r, out, path.substring(11)); return; }
        if (path.startsWith("/mypc/ack/") && r.method.equals("POST")) {
            String id = path.substring(10), tv = r.q("tv");
            boolean ok = false;
            synchronized (items) { for (Item it : items) if (it.id.equals(id) && it.tv.equals(tv)) { it.state = r.q("fail").isEmpty() ? "taken" : "failed"; ok = true; } }
            if (ok) changed();
            json(out, ok ? 200 : 404, "{\"ok\":" + ok + "}");
            return;
        }
        json(out, 404, "{\"error\":\"not-found\"}");
    }

    private static JSONObject itemJson(Item it) throws JSONException {
        return new JSONObject().put("id", it.id).put("seq", it.seq).put("kind", it.kind).put("mime", it.mime).put("name", it.name)
                .put("size", it.size).put("text", it.text).put("subject", it.subject);
    }

    private void inbox(Req r, OutputStream out) throws IOException {
        String tv = r.q("tv");
        if (tv.isEmpty() || tv.length() > 80) { json(out, 400, "{\"error\":\"tv\"}"); return; }
        int since = 0, wait = 0;
        try { since = Integer.parseInt(r.q("since")); } catch (NumberFormatException e) { since = 0; }
        try { wait = Math.min(MAX_WAIT, Math.max(0, Integer.parseInt(r.q("wait")))); } catch (NumberFormatException e) { wait = 0; }
        boolean isNew;
        synchronized (items) {
            Tv t = tvs.get(tv);
            isNew = t == null || !alive(t);
            if (t == null) { t = new Tv(); t.id = tv; tvs.put(tv, t); }
            String n = r.q("name");
            t.name = n.isEmpty() ? (t.name == null ? "TV" : t.name) : n.length() > 60 ? n.substring(0, 60) : n;
            t.ip = r.ip; t.at = System.currentTimeMillis();
            // the remembered TV's Receiver came back: what waited goes to it now
            if (isNew && tv.equals(remembered)) for (Item it : items) if ("wait".equals(it.state)) { it.tv = tv; it.state = "sent"; }
        }
        if (isNew) changed();
        long end = System.currentTimeMillis() + wait * 1000L;
        JSONArray a = new JSONArray();
        int top;
        synchronized (items) {
            while (true) {
                a = new JSONArray();
                top = seq;
                try { for (Item it : items) if (it.seq > since && tv.equals(it.tv) && "sent".equals(it.state)) a.put(itemJson(it)); } catch (JSONException e) { /* no */ }
                long left = end - System.currentTimeMillis();
                if (a.length() > 0 || left <= 0 || !running) break;
                try { items.wait(left); } catch (InterruptedException e) { break; }
                Tv t = tvs.get(tv);
                if (t != null) t.at = System.currentTimeMillis();
            }
        }
        json(out, 200, "{\"seq\":" + top + ",\"items\":" + a + "}");
    }

    private void file(Req r, OutputStream out, String id) throws IOException {
        Item it = null;
        String tv = r.q("tv");
        synchronized (items) {
            for (Item x : items) if (x.id.equals(id)) it = x;
            if (it != null) {
                Tv t = tvs.get(tv);
                // the phone's own page (it shrinks a photo before sending it over the internet), the TV it went to over the
                // internet (any address: the 128-bit id came through that TV's Firestore inbox), or the TV on this Wi-Fi it was sent to
                boolean self = r.ip.equals("127.0.0.1") || r.ip.equals("::1") || r.ip.endsWith(":127.0.0.1");
                boolean net = tv.startsWith("net:") && tv.equals(it.tv);
                if (it.uri == null || !(self || net || (tv.equals(it.tv) && t != null && r.ip.equals(t.ip)))) it = null;
            }
        }
        if (it == null) { json(out, 404, "{\"error\":\"not-found\"}"); return; }
        InputStream in;
        try { in = files.open(it.uri); } catch (IOException | RuntimeException e) { in = null; }
        if (in == null) { json(out, 404, "{\"error\":\"gone\"}"); return; }
        try (InputStream src = in) {
            long size = it.size, from = 0, to = size - 1;
            boolean part = false;
            if (size > 0 && r.range.startsWith("bytes=")) {
                String[] p = r.range.substring(6).split(",")[0].split("-", -1);
                try {
                    if (p[0].isEmpty()) { from = Math.max(0, size - Long.parseLong(p[1])); }
                    else { from = Long.parseLong(p[0]); if (p.length > 1 && !p[1].isEmpty()) to = Math.min(size - 1, Long.parseLong(p[1])); }
                    part = true;
                } catch (NumberFormatException e) { part = false; from = 0; to = size - 1; }
                if (part && from > to) { head(out, 416, null, 0, "Content-Range: bytes */" + size + "\r\n"); return; }
            }
            String disp = "Accept-Ranges: " + (size > 0 ? "bytes" : "none") + "\r\n";
            if (part) head(out, 206, it.mime, to - from + 1, disp + "Content-Range: bytes " + from + "-" + to + "/" + size + "\r\n");
            else head(out, 200, it.mime, size > 0 ? size : -1, disp);
            if (r.method.equals("HEAD")) return;
            long skip = from;
            while (skip > 0) { long n = src.skip(skip); if (n <= 0) { if (src.read() < 0) return; n = 1; } skip -= n; }
            byte[] b = new byte[64 * 1024];
            long left = size > 0 ? to - from + 1 : Long.MAX_VALUE;
            while (left > 0) {
                int n = src.read(b, 0, (int) Math.min(b.length, left));
                if (n < 0) break;
                out.write(b, 0, n);
                left -= n;
            }
        }
    }
}
