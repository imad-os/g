/* AI for installed apps (MyPC.ai in the SDK): one request format for every AI service.
 *
 * Services (providers) are added on the TV in Settings > AI, with their API key; apps never see the keys. An app can
 * also bring its own provider (with its own key) in the request. Kinds of provider:
 *   openai     OpenAI and every OpenAI-compatible API: NVIDIA, OpenRouter, Groq, Mistral, DeepSeek, xAI, Together,
 *              Ollama / LM Studio on a computer at home, or any custom address
 *   gemini     Google Gemini (text, images, speech, video with Veo, embeddings)
 *   anthropic  Anthropic Claude (text, images, PDF)
 *
 * Request (everything optional except a prompt or messages):
 *   { provider: 'gemini' | '<provider id>' | { type, url, key, model, headers },   model: 'gemini-2.5-flash',
 *     task: 'chat' | 'image' | 'speech' | 'transcribe' | 'video' | 'embed',      (guessed from output when missing)
 *     system: 'You are...' | ['line', ...],  rules: ['Answer in French', ...],  context: 'text' | { any JSON },
 *     examples: [{ input, output }],         messages: [{ role: 'user' | 'assistant' | 'system', content }],
 *     prompt: 'text' | part | [text | part, ...],
 *       part = { type: 'text', text } | { type: 'image' | 'audio' | 'video' | 'file', data: ArrayBuffer | base64 | data: URL, mime, url, name }
 *     output: 'text' | 'json' | 'image' | 'audio' | 'video' | ['text', 'image'],   schema: { JSON schema } (output json),
 *     temperature, maxTokens, topP, stop, seed, voice, format, size, n, aspectRatio, duration, language,
 *     stream: true (text arrives in pieces: onEvent({ ev: 'delta', text })),  extra: { fields merged into the API's own body },
 *     timeout: ms,  raw: true (the API's own answer in result.raw) }
 * Result: { text, json, parts: [{ type: 'text', text } | { type: 'image' | 'audio' | 'video', mime, data: ArrayBuffer }],
 *           vectors (embed), provider, model, usage: { input, output, total }, finish, raw }
 * Errors: { code: 'no-provider' | 'unsupported' | 'bad-request' | 'http' | 'network' | 'timeout' | 'blocked' | 'cancelled'
 *           | 'too-big' | 'safety', message, status }
 *
 *   AI.start(req, provider, onEvent) -> { promise, cancel() }   AI.raw(req, provider) the API's own endpoints, key added
 *   AI.resolve(spec, appDefault) -> provider   AI.providers() list without keys   AI.add / update / remove / setDefault
 * Needs js/core/web-proxy.js. Runs in My PC (TV-wide store arc_dev_ai, never in the cloud backup) and, without the store,
 * inside an app opened directly in a browser (sdk/mypc-sdk.js loads both files). */
var AI = (function () {
    'use strict';

    var KEY = 'arc_dev_ai';

    // ready-made services for Settings > AI (any other OpenAI-compatible API: "custom")
    var PRESETS = [
        { preset: 'gemini', type: 'gemini', name: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-flash', site: 'aistudio.google.com' },
        { preset: 'openai', type: 'openai', name: 'OpenAI (ChatGPT)', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini', site: 'platform.openai.com' },
        { preset: 'anthropic', type: 'anthropic', name: 'Anthropic Claude', url: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', site: 'console.anthropic.com' },
        { preset: 'nvidia', type: 'openai', name: 'NVIDIA', url: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.3-70b-instruct', site: 'build.nvidia.com' },
        { preset: 'openrouter', type: 'openai', name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', site: 'openrouter.ai' },
        { preset: 'groq', type: 'openai', name: 'Groq', url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', site: 'console.groq.com' },
        { preset: 'mistral', type: 'openai', name: 'Mistral', url: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', site: 'console.mistral.ai' },
        { preset: 'deepseek', type: 'openai', name: 'DeepSeek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', site: 'platform.deepseek.com' },
        { preset: 'xai', type: 'openai', name: 'xAI Grok', url: 'https://api.x.ai/v1', model: 'grok-3-mini', site: 'console.x.ai' },
        { preset: 'together', type: 'openai', name: 'Together AI', url: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', site: 'api.together.ai' },
        { preset: 'ollama', type: 'openai', name: 'Ollama (computer at home)', url: 'http://192.168.1.10:11434/v1', model: 'llama3.2', noKey: true, lan: true },
        { preset: 'custom', type: 'openai', name: 'Custom (OpenAI-compatible)', url: 'https://', model: '' }
    ];
    // the model used for a task when neither the request nor the provider names one
    var MODELS = {
        openai: { image: 'gpt-image-1', speech: 'gpt-4o-mini-tts', transcribe: 'gpt-4o-mini-transcribe', video: 'sora-2', embed: 'text-embedding-3-small' },
        gemini: { image: 'gemini-2.5-flash-image', speech: 'gemini-2.5-flash-preview-tts', video: 'veo-3.0-fast-generate-001', embed: 'gemini-embedding-001' },
        anthropic: {}
    };
    var TASKS = { chat: 1, image: 1, speech: 1, transcribe: 1, video: 1, embed: 1 };

    function err(code, message, extra) { var e = new Error(message); e.code = code; if (extra) for (var k in extra) e[k] = extra[k]; return e; }

    /* ---------------- providers kept on this TV ---------------- */

    function rawGet() { try { var v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && Array.isArray(v.list) ? v : { list: [], def: '' }; } catch (e) { return { list: [], def: '' }; } }
    function rawSet(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
    function clean(p) {
        var pre = presetOf(p.preset) || {};
        return { id: String(p.id || ''), preset: p.preset || 'custom', type: /^(openai|gemini|anthropic)$/.test(p.type) ? p.type : (pre.type || 'openai'),
                 name: String(p.name || pre.name || 'AI').slice(0, 40), url: String(p.url || pre.url || '').replace(/\/+$/, ''), key: String(p.key || ''),
                 model: String(p.model || '').trim(), models: p.models && typeof p.models === 'object' ? p.models : {}, lan: !!(p.lan || pre.lan) };
    }
    function presetOf(id) { for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].preset === id) return PRESETS[i]; return null; }
    function list() { return rawGet().list.map(clean); }
    function find(id) { var l = list(); for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
    function add(p) {
        var all = rawGet(), base = String(p.preset || p.type || 'ai').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'ai', id = base, n = 2;
        while (all.list.some(function (x) { return x.id === id; })) id = base + n++;
        var c = clean(Object.assign({}, p, { id: id }));
        all.list.push(c);
        if (!all.def) all.def = id;
        rawSet(all);
        return c;
    }
    function update(id, patch) {
        var all = rawGet();
        all.list = all.list.map(function (x) { return x.id === id ? clean(Object.assign({}, x, patch, { id: id })) : x; });
        rawSet(all);
        return find(id);
    }
    function remove(id) {
        var all = rawGet();
        all.list = all.list.filter(function (x) { return x.id !== id; });
        if (all.def === id) all.def = all.list.length ? all.list[0].id : '';
        rawSet(all);
    }
    function setDefault(id) { var all = rawGet(); if (find(id)) { all.def = id; rawSet(all); } }
    function defaultId() { var all = rawGet(); return find(all.def) ? all.def : (all.list[0] ? all.list[0].id : ''); }
    // what an app may know: no keys, no addresses
    function providers() {
        var d = defaultId();
        return list().map(function (p) { return { id: p.id, name: p.name, type: p.type, preset: p.preset, model: p.model, isDefault: p.id === d }; });
    }

    // spec: undefined (the app's config "ai.provider", else the TV's default) | an id | a type / preset name | an app's own { type, url, key }
    function resolve(spec, appDefault) {
        if (spec && typeof spec === 'object') {
            var t = /^(openai|gemini|anthropic)$/.test(spec.type) ? spec.type : (presetOf(spec.preset || spec.type) || {}).type || 'openai';
            var pre = presetOf(spec.preset || spec.type) || presetOf(t) || {};
            var url = String(spec.url || pre.url || '').replace(/\/+$/, '');
            if (!/^https?:\/\//.test(url)) return null;
            return { id: 'app', own: true, type: t, name: String(spec.name || pre.name || 'App'), url: url, key: String(spec.key || ''), model: String(spec.model || ''),
                     models: spec.models && typeof spec.models === 'object' ? spec.models : {}, headers: spec.headers && typeof spec.headers === 'object' ? spec.headers : null };
        }
        var want = spec || appDefault, l = list(), i;
        if (!want) return find(defaultId());
        for (i = 0; i < l.length; i++) if (l[i].id === want) return l[i];
        for (i = 0; i < l.length; i++) if (l[i].preset === want) return l[i];
        for (i = 0; i < l.length; i++) if (l[i].type === want) return l[i];
        return null;
    }

    /* ---------------- transport ---------------- */

    function authHeaders(p) {
        var h = {};
        if (p.type === 'gemini') { if (p.key) h['x-goog-api-key'] = p.key; }
        else if (p.type === 'anthropic') { if (p.key) h['x-api-key'] = p.key; h['anthropic-version'] = '2023-06-01'; h['anthropic-dangerous-direct-browser-access'] = 'true'; }
        else if (p.key) h.Authorization = 'Bearer ' + p.key;
        if (p.headers) for (var k in p.headers) h[k] = p.headers[k];
        return h;
    }

    function apiMessage(body) {
        var b = body;
        if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { return b.slice(0, 300); } }
        if (b instanceof ArrayBuffer) { try { b = JSON.parse(new TextDecoder().decode(b)); } catch (e) { return ''; } }
        if (!b) return '';
        if (Array.isArray(b) && b[0]) b = b[0];
        var e2 = b.error || b;
        return String((e2 && (e2.message || e2.detail || e2.status)) || b.message || b.detail || '').slice(0, 300);
    }

    // one HTTP call; ctl keeps the open requests so cancel() can stop them
    function http(ctl, p, opt) {
        return new Promise(function (resolve, reject) {
            if (ctl.cancelled) return reject(err('cancelled', 'Cancelled.'));
            var headers = Object.assign(opt.auth === false ? {} : authHeaders(p), opt.headers || {});
            var h = WebProxy.request({ url: opt.url, method: opt.method || (opt.json || opt.form ? 'POST' : 'GET'), headers: headers, json: opt.json, form: opt.form, body: opt.body,
                                       responseType: opt.responseType || 'json', timeout: opt.timeout || ctl.timeout, stream: !!opt.onChunk },
                                     { lan: p.lan || ctl.lan }, opt.onChunk, function (e, r) {
                ctl.open.delete(h);
                if (e) return reject(err(e.code, e.message));
                if (!r.ok) return reject(err('http', (p.name || 'The AI service') + ' answered ' + r.status + (apiMessage(r.body) ? ': ' + apiMessage(r.body) : ''), { status: r.status }));
                resolve(r);
            });
            ctl.open.add(h);
        });
    }

    function sse(onData) {
        var buf = '';
        return function (piece) {
            buf += piece;
            var lines = buf.split(/\r?\n/);
            buf = lines.pop();
            for (var i = 0; i < lines.length; i++) {
                var l = lines[i];
                if (l.indexOf('data:') !== 0) continue;
                var d = l.slice(5).trim();
                if (!d || d === '[DONE]') continue;
                try { onData(JSON.parse(d)); } catch (e) {}
            }
        };
    }

    /* ---------------- request normalisation ---------------- */

    var KINDS = { text: 1, image: 1, audio: 1, video: 1, file: 1 };
    function part(x) {
        if (typeof x === 'string') return { type: 'text', text: x };
        if (!x || typeof x !== 'object') return null;
        if (x.type === 'text' || (!x.type && typeof x.text === 'string')) return { type: 'text', text: String(x.text || '') };
        var t = KINDS[x.type] ? x.type : (/^image\//.test(x.mime) ? 'image' : /^audio\//.test(x.mime) ? 'audio' : /^video\//.test(x.mime) ? 'video' : 'file');
        return { type: t, data: x.data, mime: x.mime || '', url: x.url || '', name: x.name || '', fileUri: x.fileUri || '' };
    }
    function parts(c) { return (Array.isArray(c) ? c : [c]).map(part).filter(Boolean); }
    function asText(v) { return typeof v === 'string' ? v : JSON.stringify(v); }

    function normalise(req) {
        var sys = [], msgs = [];
        if (req.system) sys.push(Array.isArray(req.system) ? req.system.map(asText).join('\n') : asText(req.system));
        if (req.rules) sys.push('Rules:\n' + (Array.isArray(req.rules) ? req.rules : [req.rules]).map(function (r) { return '- ' + asText(r); }).join('\n'));
        if (req.context !== undefined && req.context !== null && req.context !== '') sys.push('Context:\n' + asText(req.context));
        (Array.isArray(req.examples) ? req.examples : []).forEach(function (e) {
            if (!e) return;
            msgs.push({ role: 'user', parts: parts(e.input !== undefined ? (typeof e.input === 'object' && !Array.isArray(e.input) && !e.input.type ? asText(e.input) : e.input) : '') });
            msgs.push({ role: 'assistant', parts: [{ type: 'text', text: asText(e.output) }] });
        });
        (Array.isArray(req.messages) ? req.messages : []).forEach(function (m) {
            if (!m) return;
            if (m.role === 'system') { sys.push(parts(m.content).map(function (p) { return p.text || ''; }).join('\n')); return; }
            msgs.push({ role: m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user', parts: parts(m.content) });
        });
        if (req.prompt !== undefined && req.prompt !== null) msgs.push({ role: 'user', parts: parts(req.prompt) });
        var out = Array.isArray(req.output) ? req.output.slice() : [req.output || (req.schema ? 'json' : 'text')];
        var words = out.indexOf('text') >= 0 || out.indexOf('json') >= 0;       // with words too, images / audio come from a chat answer
        var task = TASKS[req.task] ? req.task : out.indexOf('video') >= 0 ? 'video' : out.indexOf('image') >= 0 && !words ? 'image' : out.indexOf('audio') >= 0 && !words ? 'speech' : 'chat';
        var json = out.indexOf('json') >= 0;
        if (json) sys.push(req.schema ? 'Reply with JSON only, matching this JSON schema:\n' + JSON.stringify(req.schema) : 'Reply with JSON only.');
        return { sys: sys.filter(Boolean).join('\n\n'), msgs: msgs, out: out, task: task, json: json };
    }

    function allText(n) { var s = []; n.msgs.forEach(function (m) { if (m.role === 'user') m.parts.forEach(function (p) { if (p.type === 'text') s.push(p.text); }); }); return s.join('\n'); }
    function media(n, type) { var l = []; n.msgs.forEach(function (m) { m.parts.forEach(function (p) { if (p.type === type) l.push(p); }); }); return l; }

    var MIME = { image: 'image/png', audio: 'audio/wav', video: 'video/mp4', file: 'application/pdf' };
    // the part's bytes as base64 (+ its mime type): ArrayBuffer, typed array, Blob, base64, data: URL, or an address to download
    async function load(ctl, p, part2) {
        if (part2._b64) return part2;
        var d = part2.data, mime = part2.mime;
        if (d instanceof Blob) { mime = mime || d.type; d = await d.arrayBuffer(); }
        if (d instanceof ArrayBuffer || ArrayBuffer.isView(d)) part2._b64 = WebProxy.b64(d);
        else if (typeof d === 'string' && d) {
            var m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(d);
            if (m) { mime = mime || m[1]; part2._b64 = m[2] ? m[3] : btoa(unescape(encodeURIComponent(decodeURIComponent(m[3])))); }
            else part2._b64 = d.replace(/\s+/g, '');
        } else if (part2.url) {
            var r = await http(ctl, { lan: ctl.lan }, { url: part2.url, responseType: 'arraybuffer', auth: false });
            mime = mime || String(r.headers['content-type'] || '').split(';')[0];
            part2._b64 = WebProxy.b64(r.body);
        } else throw err('bad-request', 'A ' + part2.type + ' part has no data.');
        part2.mime = mime || MIME[part2.type];
        return part2;
    }
    async function loadAll(ctl, p, n, skipUrls) {
        for (var i = 0; i < n.msgs.length; i++) for (var j = 0; j < n.msgs[i].parts.length; j++) {
            var x = n.msgs[i].parts[j];
            if (x.type !== 'text' && !x.fileUri && !(skipUrls && x.url && !x.data)) await load(ctl, p, x);
        }
    }

    function bytes(b64, mime) { return { data: WebProxy.unb64(b64), mime: mime }; }
    function mediaPart(type, b64, mime) {
        var m = String(mime || '');
        // Gemini speech is raw 16-bit PCM ("audio/L16;codec=pcm;rate=24000"): made a playable .wav
        if (/^audio\/(l16|pcm)/i.test(m)) { var rate = +((/rate=(\d+)/.exec(m) || [])[1] || 24000); return { type: 'audio', mime: 'audio/wav', data: WebProxy.wav(WebProxy.unb64(b64), rate, 1) }; }
        var b = bytes(b64, m.split(';')[0] || MIME[type]);
        return { type: type, mime: b.mime, data: b.data };
    }
    function kindOf(mime) { return /^image\//.test(mime) ? 'image' : /^audio\//.test(mime) ? 'audio' : /^video\//.test(mime) ? 'video' : 'file'; }

    function parseJson(text) {
        var t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        try { return JSON.parse(t); } catch (e) {}
        var a = t.search(/[[{]/), z = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
        if (a >= 0 && z > a) { try { return JSON.parse(t.slice(a, z + 1)); } catch (e2) {} }
        return undefined;
    }

    function result(p, model, text, media2, usage, finish, raw, req) {
        var r = { text: text || '', parts: [], provider: p.id, model: model, usage: usage || null, finish: finish || '' };
        if (text) r.parts.push({ type: 'text', text: text });
        (media2 || []).forEach(function (m) { r.parts.push(m); });
        if (req.raw) r.raw = raw;
        return r;
    }

    /* ---------------- OpenAI and compatible APIs ---------------- */

    function oaMessages(n) {
        var out = [];
        if (n.sys) out.push({ role: 'system', content: n.sys });
        n.msgs.forEach(function (m) {
            if (m.parts.length === 1 && m.parts[0].type === 'text') return out.push({ role: m.role, content: m.parts[0].text });
            out.push({ role: m.role, content: m.parts.map(function (x) {
                if (x.type === 'text') return { type: 'text', text: x.text };
                if (x.type === 'image') return { type: 'image_url', image_url: { url: x._b64 ? 'data:' + x.mime + ';base64,' + x._b64 : x.url } };
                if (x.type === 'audio') return { type: 'input_audio', input_audio: { data: x._b64, format: /mp3|mpeg/.test(x.mime) ? 'mp3' : 'wav' } };
                if (x.type === 'file') return { type: 'file', file: { filename: x.name || 'file.pdf', file_data: 'data:' + x.mime + ';base64,' + x._b64 } };
                throw err('unsupported', 'This AI service does not take videos. Use Gemini for videos.');
            }) });
        });
        return out;
    }

    async function oaChat(ctl, p, model, n, req, onEvent) {
        await loadAll(ctl, p, n, true);
        var body = { model: model, messages: oaMessages(n) };
        if (req.temperature !== undefined) body.temperature = +req.temperature;
        if (req.topP !== undefined) body.top_p = +req.topP;
        if (req.stop) body.stop = req.stop;
        if (req.seed !== undefined) body.seed = +req.seed;
        if (req.maxTokens) body[/api\.openai\.com/.test(p.url) ? 'max_completion_tokens' : 'max_tokens'] = +req.maxTokens;
        if (n.json) body.response_format = req.schema ? { type: 'json_schema', json_schema: { name: req.schemaName || 'answer', schema: req.schema, strict: false } } : { type: 'json_object' };
        if (n.out.indexOf('audio') >= 0) { body.modalities = ['text', 'audio']; body.audio = { voice: req.voice || 'alloy', format: req.format || 'wav' }; }
        var stream = !!req.stream && n.out.indexOf('audio') < 0;
        if (stream) body.stream = true;
        Object.assign(body, req.extra || {});
        if (stream) {
            var text = '', usage = null, finish = '';
            await http(ctl, p, { url: p.url + '/chat/completions', json: body, responseType: 'text', onChunk: sse(function (d) {
                var c = d.choices && d.choices[0];
                if (c && c.delta && typeof c.delta.content === 'string' && c.delta.content) { text += c.delta.content; onEvent({ ev: 'delta', text: c.delta.content }); }
                if (c && c.finish_reason) finish = c.finish_reason;
                if (d.usage) usage = { input: d.usage.prompt_tokens, output: d.usage.completion_tokens, total: d.usage.total_tokens };
            }) });
            return result(p, model, text, [], usage, finish, null, req);
        }
        var r = await http(ctl, p, { url: p.url + '/chat/completions', json: body });
        var b = r.body || {}, c2 = (b.choices && b.choices[0]) || {}, msg = c2.message || {}, t = msg.content, extra = [];
        if (Array.isArray(t)) t = t.map(function (x) { return x.text || ''; }).join('');
        if (msg.audio && msg.audio.data) { extra.push(mediaPart('audio', msg.audio.data, 'audio/' + (req.format === 'mp3' ? 'mpeg' : req.format || 'wav'))); if (!t) t = msg.audio.transcript || ''; }
        var u = b.usage ? { input: b.usage.prompt_tokens, output: b.usage.completion_tokens, total: b.usage.total_tokens } : null;
        return result(p, model, t || '', extra, u, c2.finish_reason, b, req);
    }

    async function oaImage(ctl, p, model, n, req) {
        var imgs = media(n, 'image'), prompt = [n.sys, allText(n)].filter(Boolean).join('\n\n'), r;
        var opts = {};
        if (req.size) opts.size = req.size;
        if (req.n) opts.n = +req.n;
        if (req.quality) opts.quality = req.quality;
        if (/^dall-e/.test(model)) opts.response_format = 'b64_json';
        else if (req.format) opts.output_format = req.format;
        Object.assign(opts, req.extra || {});
        if (imgs.length) {
            var im = await load(ctl, p, imgs[0]), form = { model: model, prompt: prompt, image: { data: WebProxy.unb64(im._b64), name: 'image.png', type: im.mime } };
            Object.keys(opts).forEach(function (k) { form[k] = String(opts[k]); });
            r = await http(ctl, p, { url: p.url + '/images/edits', form: form });
        } else r = await http(ctl, p, { url: p.url + '/images/generations', json: Object.assign({ model: model, prompt: prompt }, opts) });
        var out = [];
        for (var i = 0; r.body && r.body.data && i < r.body.data.length; i++) {
            var d = r.body.data[i];
            if (d.b64_json) out.push(mediaPart('image', d.b64_json, 'image/' + (req.format || 'png')));
            else if (d.url) { var g = await http(ctl, p, { url: d.url, responseType: 'arraybuffer', auth: false }); out.push({ type: 'image', mime: String(g.headers['content-type'] || 'image/png').split(';')[0], data: g.body, url: d.url }); }
        }
        if (!out.length) throw err('http', 'No image came back.');
        var text = r.body.data[0].revised_prompt || '';
        return result(p, model, text, out, r.body.usage ? { input: r.body.usage.input_tokens, output: r.body.usage.output_tokens, total: r.body.usage.total_tokens } : null, 'stop', r.body, req);
    }

    async function oaSpeech(ctl, p, model, n, req) {
        var fmt = req.format || 'mp3', body = Object.assign({ model: model, input: allText(n), voice: req.voice || 'alloy', response_format: fmt }, req.extra || {});
        if (n.sys && !/^tts-1/.test(model)) body.instructions = n.sys;
        var r = await http(ctl, p, { url: p.url + '/audio/speech', json: body, responseType: 'arraybuffer' });
        var mime = { mp3: 'audio/mpeg', wav: 'audio/wav', opus: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac', pcm: 'audio/L16;rate=24000' }[fmt] || 'audio/mpeg';
        var part2 = fmt === 'pcm' ? { type: 'audio', mime: 'audio/wav', data: WebProxy.wav(r.body, 24000, 1) } : { type: 'audio', mime: mime, data: r.body };
        return result(p, model, '', [part2], null, 'stop', null, req);
    }

    async function oaTranscribe(ctl, p, model, n, req) {
        var a = media(n, 'audio').concat(media(n, 'video'))[0];
        if (!a) throw err('bad-request', 'Give the audio to write down (a part { type: "audio", data }).');
        await load(ctl, p, a);
        var ext = (/(mp3|mpeg|webm|ogg|m4a|mp4|wav|flac)/.exec(a.mime) || [, 'wav'])[1].replace('mpeg', 'mp3');
        var form = Object.assign({ file: { data: WebProxy.unb64(a._b64), name: 'audio.' + ext, type: a.mime }, model: model, response_format: 'json' }, req.extra || {});
        if (req.language) form.language = req.language;
        var hint = [n.sys, allText(n)].filter(Boolean).join('\n');
        if (hint) form.prompt = hint;
        var r = await http(ctl, p, { url: p.url + '/audio/transcriptions', form: form });
        return result(p, model, (r.body && r.body.text) || '', [], null, 'stop', r.body, req);
    }

    async function oaVideo(ctl, p, model, n, req, onEvent) {
        var body = Object.assign({ model: model, prompt: allText(n) }, req.duration ? { seconds: String(req.duration) } : {}, req.size ? { size: req.size } : {}, req.extra || {});
        var r = await http(ctl, p, { url: p.url + '/videos', json: body }), job = r.body || {}, until = Date.now() + (req.timeout || 600000);
        if (!job.id) throw err('unsupported', (p.name || 'This service') + ' did not start a video.');
        while (job.status !== 'completed') {
            if (job.status === 'failed' || job.error) throw err('http', 'The video failed: ' + apiMessage(job));
            if (Date.now() > until) throw err('timeout', 'The video is not ready yet.');
            onEvent({ ev: 'status', state: job.status || 'queued', progress: job.progress });
            await wait(ctl, req.pollMs || 5000);
            job = (await http(ctl, p, { url: p.url + '/videos/' + encodeURIComponent(job.id) })).body || {};
        }
        var v = await http(ctl, p, { url: p.url + '/videos/' + encodeURIComponent(job.id) + '/content', responseType: 'arraybuffer' });
        return result(p, model, '', [{ type: 'video', mime: 'video/mp4', data: v.body }], null, 'stop', job, req);
    }

    async function oaEmbed(ctl, p, model, n, req) {
        var input = Array.isArray(req.input) ? req.input.map(asText) : [allText(n)];
        var r = await http(ctl, p, { url: p.url + '/embeddings', json: Object.assign({ model: model, input: input }, req.extra || {}) });
        var out = result(p, model, '', [], null, 'stop', r.body, req);
        out.vectors = ((r.body && r.body.data) || []).map(function (d) { return d.embedding; });
        return out;
    }

    /* ---------------- Google Gemini ---------------- */

    function gContents(n) {
        return n.msgs.map(function (m) {
            return { role: m.role === 'assistant' ? 'model' : 'user', parts: m.parts.map(function (x) {
                if (x.type === 'text') return { text: x.text };
                if (x.fileUri) return { file_data: { file_uri: x.fileUri, mime_type: x.mime } };
                return { inline_data: { mime_type: x.mime, data: x._b64 } };
            }) };
        });
    }
    function gUsage(u) { return u ? { input: u.promptTokenCount, output: u.candidatesTokenCount, total: u.totalTokenCount } : null; }
    function gModel(model) { return String(model).replace(/^models\//, ''); }

    async function gGenerate(ctl, p, model, n, req, onEvent, cfg) {
        await loadAll(ctl, p, n, false);
        var gc = Object.assign({}, cfg || {});
        if (req.temperature !== undefined) gc.temperature = +req.temperature;
        if (req.topP !== undefined) gc.topP = +req.topP;
        if (req.maxTokens) gc.maxOutputTokens = +req.maxTokens;
        if (req.stop) gc.stopSequences = Array.isArray(req.stop) ? req.stop : [req.stop];
        if (req.seed !== undefined) gc.seed = +req.seed;
        if (n.json) { gc.responseMimeType = 'application/json'; if (req.schema) gc.responseJsonSchema = req.schema; }
        if (!cfg) {
            var mods = [];
            if (n.out.indexOf('image') >= 0) mods.push('IMAGE');
            if (n.out.indexOf('audio') >= 0) mods.push('AUDIO');
            if (mods.length) { if (n.out.indexOf('text') >= 0 || n.json || mods.indexOf('IMAGE') >= 0) mods.unshift('TEXT'); gc.responseModalities = mods; }
        }
        var body = { contents: gContents(n), generationConfig: gc };
        if (n.sys) body.systemInstruction = { parts: [{ text: n.sys }] };
        var ex = req.extra || {};
        Object.keys(ex).forEach(function (k) { if (k === 'generationConfig') Object.assign(gc, ex[k]); else body[k] = ex[k]; });
        var base = p.url + '/models/' + encodeURIComponent(gModel(model));
        var stream = !!req.stream && !gc.responseModalities && !cfg;
        var text = '', out = [], usage = null, finish = '';
        function take(d) {
            if (d.usageMetadata) usage = gUsage(d.usageMetadata);
            if (!d.candidates && d.promptFeedback && d.promptFeedback.blockReason) throw err('safety', 'Gemini refused this request (' + d.promptFeedback.blockReason + ').');
            var c = d.candidates && d.candidates[0];
            if (!c) return;
            if (c.finishReason) finish = c.finishReason;
            ((c.content && c.content.parts) || []).forEach(function (x) {
                if (x.thought) return;
                if (typeof x.text === 'string') { text += x.text; if (stream && x.text) onEvent({ ev: 'delta', text: x.text }); }
                var id = x.inlineData || x.inline_data;
                if (id && id.data) out.push(mediaPart(kindOf(id.mimeType || id.mime_type), id.data, id.mimeType || id.mime_type));
            });
        }
        if (stream) {
            var bad = null;
            await http(ctl, p, { url: base + ':streamGenerateContent?alt=sse', json: body, responseType: 'text', onChunk: sse(function (d) { try { take(d); } catch (e) { bad = e; } }) });
            if (bad) throw bad;
            return result(p, model, text, out, usage, finish, null, req);
        }
        var r = await http(ctl, p, { url: base + ':generateContent', json: body });
        take(r.body || {});
        if (!text && !out.length && finish === 'SAFETY') throw err('safety', 'Gemini stopped the answer for safety.');
        return result(p, model, text, out, usage, finish, r.body, req);
    }

    async function gImage(ctl, p, model, n, req, onEvent) {
        if (!/^imagen/.test(gModel(model))) {
            var save = n.out;
            n.out = ['text', 'image'];
            var cfg = { responseModalities: ['TEXT', 'IMAGE'] };
            if (req.aspectRatio) cfg.imageConfig = { aspectRatio: req.aspectRatio };
            try { return await gGenerate(ctl, p, model, n, req, onEvent, cfg); } finally { n.out = save; }
        }
        var params = Object.assign({ sampleCount: +req.n || 1 }, req.aspectRatio ? { aspectRatio: req.aspectRatio } : {}, req.extra || {});
        var r = await http(ctl, p, { url: p.url + '/models/' + encodeURIComponent(gModel(model)) + ':predict', json: { instances: [{ prompt: [n.sys, allText(n)].filter(Boolean).join('\n\n') }], parameters: params } });
        var out = ((r.body && r.body.predictions) || []).filter(function (x) { return x.bytesBase64Encoded; }).map(function (x) { return mediaPart('image', x.bytesBase64Encoded, x.mimeType || 'image/png'); });
        if (!out.length) throw err('http', 'No image came back.');
        return result(p, model, '', out, null, 'stop', r.body, req);
    }

    function gSpeech(ctl, p, model, n, req, onEvent) {
        var cfg = { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: req.voice || 'Kore' } } } };
        var only = { sys: '', out: ['audio'], json: false, msgs: [{ role: 'user', parts: [{ type: 'text', text: (n.sys ? n.sys + ': ' : '') + allText(n) }] }] };
        return gGenerate(ctl, p, model, only, req, onEvent, cfg);
    }

    function gTranscribe(ctl, p, model, n, req, onEvent) {
        if (!media(n, 'audio').length && !media(n, 'video').length) throw err('bad-request', 'Give the audio to write down (a part { type: "audio", data }).');
        n.sys = [n.sys, 'Write down exactly what is said in the audio' + (req.language ? ' (language: ' + req.language + ')' : '') + '. Reply with the words only.'].filter(Boolean).join('\n\n');
        return gGenerate(ctl, p, model, n, req, onEvent, {});
    }

    async function gVideo(ctl, p, model, n, req, onEvent) {
        var inst = { prompt: [n.sys, allText(n)].filter(Boolean).join('\n\n') }, img = media(n, 'image')[0];
        if (img) { await load(ctl, p, img); inst.image = { bytesBase64Encoded: img._b64, mimeType: img.mime }; }
        var params = Object.assign({}, req.aspectRatio ? { aspectRatio: req.aspectRatio } : {}, req.duration ? { durationSeconds: +req.duration } : {}, req.extra || {});
        var r = await http(ctl, p, { url: p.url + '/models/' + encodeURIComponent(gModel(model)) + ':predictLongRunning', json: { instances: [inst], parameters: params } });
        var op = r.body || {}, until = Date.now() + (req.timeout || 600000);
        if (!op.name && !op.done) throw err('unsupported', (p.name || 'This service') + ' did not start a video.');
        while (!op.done) {
            if (Date.now() > until) throw err('timeout', 'The video is not ready yet.');
            onEvent({ ev: 'status', state: 'running' });
            await wait(ctl, req.pollMs || 8000);
            op = (await http(ctl, p, { url: p.url + '/' + op.name })).body || {};
        }
        if (op.error) throw err('http', 'The video failed: ' + (op.error.message || ''));
        var res = op.response || {}, s = (res.generateVideoResponse && res.generateVideoResponse.generatedSamples) || res.generatedVideos || [], out = [];
        for (var i = 0; i < s.length; i++) {
            var v = s[i].video || {};
            if (v.bytesBase64Encoded) { out.push(mediaPart('video', v.bytesBase64Encoded, v.mimeType || 'video/mp4')); continue; }
            if (!v.uri) continue;
            var g = await http(ctl, p, { url: v.uri, responseType: 'arraybuffer', timeout: 120000 });
            out.push({ type: 'video', mime: 'video/mp4', data: g.body, url: v.uri });
        }
        if (!out.length) throw err('http', 'No video came back.');
        return result(p, model, '', out, null, 'stop', op, req);
    }

    async function gEmbed(ctl, p, model, n, req) {
        var input = Array.isArray(req.input) ? req.input.map(asText) : [allText(n)], m = 'models/' + gModel(model);
        var r = await http(ctl, p, { url: p.url + '/' + m + ':batchEmbedContents', json: { requests: input.map(function (t) { return Object.assign({ model: m, content: { parts: [{ text: t }] } }, req.extra || {}); }) } });
        var out = result(p, model, '', [], null, 'stop', r.body, req);
        out.vectors = ((r.body && r.body.embeddings) || []).map(function (e) { return e.values; });
        return out;
    }

    /* ---------------- Anthropic Claude ---------------- */

    async function anChat(ctl, p, model, n, req, onEvent) {
        await loadAll(ctl, p, n, true);
        var msgs = n.msgs.map(function (m) {
            return { role: m.role, content: m.parts.map(function (x) {
                if (x.type === 'text') return { type: 'text', text: x.text };
                if (x.type === 'image') return { type: 'image', source: x._b64 ? { type: 'base64', media_type: x.mime, data: x._b64 } : { type: 'url', url: x.url } };
                if (x.type === 'file') return { type: 'document', source: x._b64 ? { type: 'base64', media_type: x.mime || 'application/pdf', data: x._b64 } : { type: 'url', url: x.url } };
                throw err('unsupported', 'Claude does not take ' + x.type + '. Use Gemini for audio and video.');
            }) };
        });
        var body = { model: model, max_tokens: +req.maxTokens || 1024, messages: msgs };
        if (n.sys) body.system = n.sys;
        if (req.temperature !== undefined) body.temperature = +req.temperature;
        if (req.topP !== undefined) body.top_p = +req.topP;
        if (req.stop) body.stop_sequences = Array.isArray(req.stop) ? req.stop : [req.stop];
        Object.assign(body, req.extra || {});
        var text = '', usage = { input: 0, output: 0, total: 0 }, finish = '';
        if (req.stream) {
            body.stream = true;
            await http(ctl, p, { url: p.url + '/messages', json: body, responseType: 'text', onChunk: sse(function (d) {
                if (d.type === 'content_block_delta' && d.delta && d.delta.type === 'text_delta') { text += d.delta.text; onEvent({ ev: 'delta', text: d.delta.text }); }
                if (d.type === 'message_start' && d.message && d.message.usage) usage.input = d.message.usage.input_tokens || 0;
                if (d.type === 'message_delta') { if (d.usage) usage.output = d.usage.output_tokens || 0; if (d.delta && d.delta.stop_reason) finish = d.delta.stop_reason; }
            }) });
            usage.total = usage.input + usage.output;
            return result(p, model, text, [], usage, finish, null, req);
        }
        var r = await http(ctl, p, { url: p.url + '/messages', json: body }), b = r.body || {};
        text = (b.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('');
        var u = b.usage ? { input: b.usage.input_tokens, output: b.usage.output_tokens, total: (b.usage.input_tokens || 0) + (b.usage.output_tokens || 0) } : null;
        return result(p, model, text, [], u, b.stop_reason, b, req);
    }

    /* ---------------- running a request ---------------- */

    var RUN = {
        openai: { chat: oaChat, image: oaImage, speech: oaSpeech, transcribe: oaTranscribe, video: oaVideo, embed: oaEmbed },
        gemini: { chat: function (c, p, m, n, r, e) { return gGenerate(c, p, m, n, r, e, null); }, image: gImage, speech: gSpeech, transcribe: gTranscribe, video: gVideo, embed: gEmbed },
        anthropic: { chat: anChat }
    };

    function wait(ctl, ms) {
        return new Promise(function (resolve, reject) {
            var t = setTimeout(function () { ctl.timers.delete(stop); resolve(); }, ms);
            function stop() { clearTimeout(t); reject(err('cancelled', 'Cancelled.')); }
            ctl.timers.add(stop);
        });
    }

    function newCtl(opts) { return { cancelled: false, open: new Set(), timers: new Set(), timeout: 120000, lan: !!(opts && opts.lan) }; }
    function cancelCtl(ctl) {
        ctl.cancelled = true;
        ctl.open.forEach(function (h) { try { h.abort(); } catch (e) {} });
        ctl.timers.forEach(function (s) { try { s(); } catch (e) {} });
    }

    // opts.lan: the app may reach the local network (its own provider / media addresses)
    function start(req, p, onEvent, opts) {
        var ctl = newCtl(opts);
        onEvent = typeof onEvent === 'function' ? onEvent : function () {};
        var promise = (async function () {
            req = req && typeof req === 'object' ? req : {};
            if (!p) throw err('no-provider', 'No AI service is set up. Add one in My PC: Settings > AI.');
            if (!p.url) throw err('no-provider', 'The AI service has no address.');
            if (req.timeout) ctl.timeout = Math.min(Math.max(5000, +req.timeout), 600000);
            var n = normalise(req);
            if (!n.msgs.length && !(n.task === 'embed' && Array.isArray(req.input))) throw err('bad-request', 'Give a prompt or messages.');
            var fn = (RUN[p.type] || {})[n.task];
            if (!fn) throw err('unsupported', (p.name || p.type) + ' cannot do "' + n.task + '". ' + (n.task === 'chat' ? '' : 'Gemini and OpenAI can.'));
            var model = req.model || (n.task === 'chat' || n.task === 'transcribe' && p.type === 'gemini' ? '' : (p.models && p.models[n.task]) || MODELS[p.type][n.task]) || p.model;
            if (!model) throw err('bad-request', 'Name a model (the request\'s "model", or the service\'s model in Settings > AI).');
            var r = await fn(ctl, p, model, n, req, onEvent);
            if (n.json) r.json = parseJson(r.text);
            return r;
        })();
        return { promise: promise, cancel: function () { cancelCtl(ctl); } };
    }

    // the service's own API, with its key: { method, path: 'models' | url (same site as the service), headers, json | body | form, responseType }
    function raw(req, p, opts) {
        var ctl = newCtl(opts);
        var promise = (async function () {
            if (!p) throw err('no-provider', 'No AI service is set up. Add one in My PC: Settings > AI.');
            req = req && typeof req === 'object' ? req : {};
            var url = req.url ? String(req.url) : p.url + '/' + String(req.path || '').replace(/^\/+/, '');
            var a = new URL(url), b = new URL(p.url + '/');
            if (a.origin !== b.origin) throw err('blocked', 'The key of ' + p.name + ' is only sent to ' + b.host + '.');
            if (req.timeout) ctl.timeout = Math.min(Math.max(5000, +req.timeout), 600000);
            var r = await http(ctl, p, { url: url, method: req.method, headers: req.headers, json: req.json, body: req.body, form: req.form, responseType: req.responseType || 'json' });
            return { status: r.status, headers: r.headers, body: r.body };
        })();
        return { promise: promise, cancel: function () { cancelCtl(ctl); } };
    }

    return { PRESETS: PRESETS, MODELS: MODELS, presetOf: presetOf, list: list, find: find, add: add, update: update, remove: remove, setDefault: setDefault,
             defaultId: defaultId, providers: providers, resolve: resolve, start: start, raw: raw, normalise: normalise, parseJson: parseJson };
})();
