const NOTION_VERSION = "2022-06-28";
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    try {
      if (p === "/") return htmlResponse();
      if (p === "/api/accounts") return apiAccounts(env);
      if (p === "/api/search") return apiSearch(request, env);
      if (p === "/api/page") return apiPage(request, env);
      if (p === "/api/block") return apiUpdateBlock(request, env);
      if (p === "/api/append") return apiAppend(request, env);
      if (p === "/api/chat") return apiChat(request, env);
      if (p === "/api/models") return apiModels(request, env);
      if (p === "/api/history") return apiHistory(request, env);
      if (p === "/api/history/save") return apiHistorySave(request, env);
      if (p === "/api/history/rename") return apiHistoryRename(request, env);
      if (p === "/api/history/delete") return apiHistoryDelete(request, env);
      if (p === "/api/memory") return apiMemory(request, env);
      if (p === "/api/memory/save") return apiMemorySave(request, env);
      if (p === "/api/settings") return apiSettings(request, env);
      if (p === "/api/settings/save") return apiSettingsSave(request, env);
      if (p.startsWith("/api/")) return json({ error: "Not found" }, 404);
      return htmlResponse();
    } catch (e) { return json({ error: String((e && e.message) || e) }, 500); }
  },
};
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "content-type": "application/json; charset=utf-8" } }); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function getConfig(env) {
  const cfg = { tokens: [], openai_key: "", openai_base: "", openai_model: "", ai_model: "" };
  if (env.CHAT) { const s = await env.CHAT.get("config", "json"); if (s) { cfg.tokens = s.tokens || []; cfg.openai_key = s.openai_key || ""; cfg.openai_base = s.openai_base || ""; cfg.openai_model = s.openai_model || ""; cfg.ai_model = s.ai_model || ""; } }
  return cfg;
}
async function getTokens(env) {
  const set = []; const cfg = await getConfig(env);
  cfg.tokens.forEach((t) => { const v = String(t).trim(); if (v) set.push(v); });
  if (env.NOTION_TOKENS) env.NOTION_TOKENS.split(",").forEach((t) => { const v = t.trim(); if (v) set.push(v); });
  for (let i = 1; i <= 9; i++) { const v = env["NOTION_TOKEN_" + i]; if (v) set.push(String(v).trim()); }
  if (env.NOTION_TOKEN) set.push(String(env.NOTION_TOKEN).trim());
  const u = []; set.forEach((t) => { if (u.indexOf(t) < 0) u.push(t); });
  if (!u.length) throw new Error("Belum ada token Notion. Buka Pengaturan (gear) di web buat nambahin.");
  return u;
}
async function resolveTokens(env, acc, turbo) { const all = await getTokens(env); if (turbo || acc === "auto") return all; const i = parseInt(acc || "0", 10) || 0; return [all[i] || all[0]]; }
async function notion(env, endpoint, init, token) {
  init = init || {};
  for (let a = 0; a < 4; a++) {
    const res = await fetch("https://api.notion.com/v1" + endpoint, { method: init.method || "GET", headers: { Authorization: "Bearer " + token, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" }, body: init.body });
    if (res.status === 429) { const ra = parseFloat(res.headers.get("Retry-After") || "1"); await sleep((ra || 1) * 1000); continue; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || ("Notion error " + res.status));
    return data;
  }
  throw new Error("Notion rate limited (429)");
}
async function notionMulti(env, endpoint, init, tokens) { let last; for (let t = 0; t < tokens.length; t++) { try { return await notion(env, endpoint, init, tokens[t]); } catch (e) { last = e; } } throw last || new Error("Semua token gagal"); }
function rtPlain(rt) { return (rt || []).map((t) => t.plain_text || "").join(""); }
function pageTitle(p) { const pr = p.properties || {}; for (const k in pr) { if (pr[k] && pr[k].type === "title") return rtPlain(pr[k].title) || "Untitled"; } return "Untitled"; }
async function apiAccounts(env) {
  const tokens = await getTokens(env);
  const accounts = await Promise.all(tokens.map(async (tk, i) => { try { const me = await notion(env, "/users/me", {}, tk); const name = (me.bot && me.bot.workspace_name) || me.name || ("Akun " + (i + 1)); return { index: i, name }; } catch (e) { return { index: i, name: "Akun " + (i + 1) + " (token invalid)" }; } }));
  return json({ accounts });
}
async function apiSearch(request, env) {
  const u = new URL(request.url); const q = u.searchParams.get("q") || ""; const acc = u.searchParams.get("acc"); const all = await getTokens(env);
  const body = JSON.stringify({ query: q, page_size: 50, filter: { property: "object", value: "page" }, sort: { direction: "descending", timestamp: "last_edited_time" } });
  let raw = [];
  if (acc === "auto" && all.length > 1) {
    const lists = await Promise.all(all.map((t) => notion(env, "/search", { method: "POST", body }, t).then((d) => d.results || []).catch(() => [])));
    const seen = {}; lists.forEach((arr) => arr.forEach((p) => { if (!seen[p.id]) { seen[p.id] = 1; raw.push(p); } }));
    raw.sort((a, b) => new Date(b.last_edited_time) - new Date(a.last_edited_time));
  } else { const i = parseInt(acc || "0", 10) || 0; const d = await notionMulti(env, "/search", { method: "POST", body }, [all[i] || all[0]]); raw = d.results || []; }
  return json({ results: raw.slice(0, 80).map((p) => ({ id: p.id, title: pageTitle(p), last_edited: p.last_edited_time })) });
}
async function fetchBlocks(env, blockId, tokens, ref) {
  let blocks = []; let cursor = null;
  do {
    const start = ref.i % tokens.length; ref.i++; const order = tokens.slice(start).concat(tokens.slice(0, start));
    const qs = cursor ? "?start_cursor=" + cursor + "&page_size=100" : "?page_size=100";
    const data = await notionMulti(env, "/blocks/" + blockId + "/children" + qs, {}, order);
    for (const b of data.results || []) blocks.push(b);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  const wk = blocks.filter((b) => b.has_children && b.type !== "child_page" && b.type !== "child_database");
  await Promise.all(wk.map((b) => fetchBlocks(env, b.id, tokens, ref).then((c) => { b.children = c; })));
  return blocks;
}
async function apiPage(request, env) {
  const u = new URL(request.url); const id = u.searchParams.get("id"); if (!id) return json({ error: "id wajib" }, 400);
  const turbo = u.searchParams.get("turbo") === "1"; const tokens = await resolveTokens(env, u.searchParams.get("acc"), turbo); const ref = { i: 0 };
  const page = await notionMulti(env, "/pages/" + id, {}, tokens); const blocks = await fetchBlocks(env, id, tokens, ref);
  return json({ id, title: pageTitle(page), blocks });
}
async function apiUpdateBlock(request, env) {
  const body = await request.json(); const tokens = await resolveTokens(env, body.acc, false); const type = body.type || "code"; const payload = {};
  payload[type] = { rich_text: [{ type: "text", text: { content: body.text || "" } }] };
  if (type === "code" && body.language) payload[type].language = body.language;
  const data = await notionMulti(env, "/blocks/" + body.id, { method: "PATCH", body: JSON.stringify(payload) }, tokens);
  return json({ ok: true, block: data });
}
async function apiAppend(request, env) {
  const body = await request.json(); const tokens = await resolveTokens(env, body.acc, false);
  const data = await notionMulti(env, "/blocks/" + body.pageId + "/children", { method: "PATCH", body: JSON.stringify({ children: [{ object: "block", type: "code", code: { rich_text: [{ type: "text", text: { content: body.text || "" } }], language: body.language || "plain text" } }] }) }, tokens);
  return json({ ok: true, result: data });
}
async function apiChat(request, env) {
  const body = await request.json(); const messages = body.messages || []; const cfg = await getConfig(env); const key = cfg.openai_key || env.OPENAI_API_KEY;
  if (!key && env.AI) { const stream = await env.AI.run(body.model || cfg.ai_model || env.AI_MODEL || "@cf/meta/llama-3.1-8b-instruct", { messages, stream: true }); return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } }); }
  if (!key) return json({ error: "OpenAI API Key belum di-set. Buka Pengaturan di web." }, 400);
  const base = cfg.openai_base || env.OPENAI_BASE_URL || "https://api.openai.com/v1"; const model = body.model || cfg.openai_model || env.OPENAI_MODEL || "gpt-4o-mini";
  const res = await fetch(base + "/chat/completions", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ model, messages, stream: true }) });
  if (!res.ok) { const t = await res.text(); return json({ error: "LLM error: " + t }, 500); }
  return new Response(res.body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}
async function apiModels(request, env) {
  const cfg = await getConfig(env); const key = cfg.openai_key || env.OPENAI_API_KEY;
  if (!key) return json({ models: ["@cf/meta/llama-3.1-8b-instruct", "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/qwen/qwen2.5-coder-32b-instruct", "@cf/deepseek-ai/deepseek-coder-6.7b-instruct-awq"], source: "workers-ai" });
  const base = cfg.openai_base || env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  try { const res = await fetch(base + "/models", { headers: { Authorization: "Bearer " + key } }); if (!res.ok) return json({ models: [], error: "HTTP " + res.status }); const d = await res.json(); const arr = d.data || d.models || []; const models = arr.map((m) => (typeof m === "string" ? m : m.id || m.name)).filter(Boolean).sort(); return json({ models }); } catch (e) { return json({ models: [], error: String((e && e.message) || e) }); }
}
async function readIndex(env) { if (!env.CHAT) return []; return (await env.CHAT.get("index", "json")) || []; }
async function apiHistory(request, env) {
  if (!env.CHAT) return json({ error: "KV binding CHAT belum di-set" }, 400);
  const u = new URL(request.url); const id = u.searchParams.get("id");
  if (id) { const s = await env.CHAT.get("session:" + id, "json"); if (!s) return json({ error: "Sesi nggak ketemu" }, 404); return json(s); }
  const index = await readIndex(env); index.sort((a, b) => (b.updated || 0) - (a.updated || 0)); return json({ sessions: index });
}
async function apiHistorySave(request, env) {
  if (!env.CHAT) return json({ error: "KV binding CHAT belum di-set" }, 400);
  const body = await request.json(); const id = body.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
  let title = (body.title || "").slice(0, 80);
  if (!title && body.id) { const prev = await env.CHAT.get("session:" + body.id, "json"); if (prev && prev.title) title = prev.title; }
  if (!title) title = "Chat baru"; const updated = Date.now();
  await env.CHAT.put("session:" + id, JSON.stringify({ id, title, updated, messages: body.messages || [] }));
  let index = await readIndex(env); index = index.filter((s) => s.id !== id); index.push({ id, title, updated }); await env.CHAT.put("index", JSON.stringify(index));
  return json({ ok: true, id, title, updated });
}
async function apiHistoryRename(request, env) {
  if (!env.CHAT) return json({ error: "KV binding CHAT belum di-set" }, 400);
  const body = await request.json(); const title = (body.title || "Chat").slice(0, 80);
  const s = await env.CHAT.get("session:" + body.id, "json"); if (s) { s.title = title; await env.CHAT.put("session:" + body.id, JSON.stringify(s)); }
  let index = await readIndex(env); index = index.map((x) => (x.id === body.id ? { id: x.id, title, updated: x.updated } : x)); await env.CHAT.put("index", JSON.stringify(index));
  return json({ ok: true });
}
async function apiHistoryDelete(request, env) {
  if (!env.CHAT) return json({ error: "KV binding CHAT belum di-set" }, 400);
  const body = await request.json(); await env.CHAT.delete("session:" + body.id);
  let index = await readIndex(env); index = index.filter((s) => s.id !== body.id); await env.CHAT.put("index", JSON.stringify(index));
  return json({ ok: true });
}
async function apiMemory(request, env) { if (!env.CHAT) return json({ facts: [] }); return json({ facts: (await env.CHAT.get("memory:facts", "json")) || [] }); }
async function apiMemorySave(request, env) { if (!env.CHAT) return json({ error: "KV binding CHAT belum di-set" }, 400); const body = await request.json(); const facts = (body.facts || []).slice(0, 100); await env.CHAT.put("memory:facts", JSON.stringify(facts)); return json({ ok: true, facts }); }
function maskTok(t) { t = String(t); return t.length <= 10 ? "****" : t.slice(0, 6) + "..." + t.slice(-4); }
async function apiSettings(request, env) { if (!env.CHAT) return json({ error: "KV binding CHAT belum di-set. Deploy dengan KV namespace dulu." }, 400); const cfg = await getConfig(env); return json({ tokens: cfg.tokens.map(maskTok), openai_key_set: !!cfg.openai_key, openai_base: cfg.openai_base, openai_model: cfg.openai_model, ai_model: cfg.ai_model }); }
async function apiSettingsSave(request, env) {
  if (!env.CHAT) return json({ error: "KV binding CHAT belum di-set" }, 400);
  const body = await request.json(); const cur = await getConfig(env); let tokens = cur.tokens;
  if (Array.isArray(body.tokens)) tokens = body.tokens.map((t) => String(t).trim()).filter((t) => t);
  let key = cur.openai_key; if (typeof body.openai_key === "string" && body.openai_key.trim()) key = body.openai_key.trim(); if (body.clear_openai_key) key = "";
  await env.CHAT.put("config", JSON.stringify({ tokens, openai_key: key, openai_base: (body.openai_base || "").trim(), openai_model: (body.openai_model || "").trim(), ai_model: (body.ai_model || "").trim() }));
  return json({ ok: true, tokenCount: tokens.length });
}
function htmlResponse() { return new Response(PAGE_HTML, { headers: { "content-type": "text/html; charset=utf-8" } }); }
const PAGE_HTML = `<!DOCTYPE html>
<html lang="id"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Notion Coding</title>
<script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"><\/script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github-dark.min.css">
<script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js"><\/script>
<style>
:root{--bg:#212121;--side:#171717;--panel2:#2a2a2a;--border:#3a3a3a;--text:#ececec;--muted:#9b9b9b;--accent:#10a37f;--userbub:#2f2f2f}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);display:flex;overflow:hidden}
body.light{--bg:#fff;--side:#f9f9f9;--panel2:#f0f0f0;--border:#e3e3e3;--text:#1f1f1f;--muted:#6b6b6b;--userbub:#eef0f2}
button{font-family:inherit}
.iconbtn{background:none;border:none;color:var(--text);cursor:pointer;font-size:16px;padding:6px 8px;border-radius:8px}
.iconbtn:hover{background:var(--panel2)}
#histbar{width:260px;flex:0 0 260px;background:var(--side);height:100vh;display:flex;flex-direction:column;padding:10px;transition:margin .2s;overflow:hidden}
body.nohist #histbar{margin-left:-260px}
.histtop{display:flex;align-items:center;gap:6px;margin-bottom:10px;padding:4px}
.brand{font-size:14px;font-weight:600;flex:1;white-space:nowrap;overflow:hidden}
.newbtn{display:flex;align-items:center;gap:8px;width:100%;background:var(--panel2);border:1px solid var(--border);color:var(--text);padding:10px 12px;border-radius:10px;cursor:pointer;font-size:13px;margin-bottom:10px}
.newbtn:hover{border-color:var(--accent)}
#histlist{flex:1;overflow:auto;display:flex;flex-direction:column;gap:2px}
.hitem{display:flex;align-items:center;gap:4px;padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px}
.hitem:hover,.hitem.active{background:var(--panel2)}
.hitem .t{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hitem .a{opacity:0;background:none;border:none;color:var(--muted);cursor:pointer;font-size:12px;padding:2px}
.hitem:hover .a{opacity:1}
.center{flex:1;display:flex;flex-direction:column;height:100vh;min-width:0}
.topbar{display:flex;align-items:center;gap:6px;padding:10px 14px;border-bottom:1px solid var(--border)}
.ttl{font-weight:600;font-size:15px}
#model{background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px 8px;font-size:12px;max-width:190px}
.msgs{flex:1;overflow:auto;padding:24px 16px}
.thread{max-width:780px;margin:0 auto;display:flex;flex-direction:column;gap:20px}
.empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--muted);gap:8px}
.hello{font-size:24px;font-weight:600;color:var(--text)}
.msg{display:flex;gap:12px}
.msg .avatar{width:30px;height:30px;border-radius:50%;background:var(--panel2);display:flex;align-items:center;justify-content:center;font-size:15px;flex:0 0 30px}
.msg.user{flex-direction:row-reverse}
.msg .mbody{min-width:0;max-width:100%}
.msg.user .mbody{background:var(--userbub);border-radius:16px;padding:8px 14px}
.bubble{font-size:14.5px;line-height:1.6;word-break:break-word}
.bubble pre{background:#0d0d0d;padding:12px;border-radius:10px;overflow:auto;white-space:pre;border:1px solid var(--border)}
body.light .bubble pre{background:#f6f8fa}
.bubble code{background:rgba(127,127,127,.18);padding:1px 5px;border-radius:5px}
.bubble pre code{background:none;padding:0}
.bubble ul,.bubble ol{margin:6px 0;padding-left:22px}
.bubble h2,.bubble h3,.bubble h4{margin:10px 0 4px}
.bubble a{color:var(--accent)}
.opts{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.chip{background:var(--panel2);border:1px solid var(--border);color:var(--text);padding:7px 12px;border-radius:16px;font-size:13px;cursor:pointer}
.chip:hover{border-color:var(--accent)}
.msgact{display:flex;gap:14px;margin-top:6px}
.mini{background:none;border:none;color:var(--muted);font-size:12px;cursor:pointer;padding:0}
.mini:hover{color:var(--accent)}
.thumbs{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.thumbs img{max-width:140px;max-height:140px;border-radius:8px;border:1px solid var(--border)}
.filechip{display:inline-flex;align-items:center;gap:4px;background:var(--panel2);border:1px solid var(--border);border-radius:6px;padding:3px 8px;font-size:12px;margin-top:4px}
.composer{padding:6px 16px 16px;max-width:780px;margin:0 auto;width:100%}
.attbar{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}
.att{display:flex;align-items:center;gap:5px;background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:4px 8px;font-size:12px}
.att .x{cursor:pointer;color:var(--muted)}
.inputwrap{display:flex;align-items:flex-end;gap:8px;background:var(--panel2);border:1px solid var(--border);border-radius:24px;padding:8px 8px 8px 16px}
.inputwrap:focus-within{border-color:var(--accent)}
#chatin{flex:1;background:none;border:none;color:var(--text);resize:none;outline:none;font-size:14.5px;max-height:200px;line-height:1.5;padding:6px 0}
.sendbtn{flex:0 0 auto;width:36px;height:36px;border-radius:50%;background:var(--accent);color:#fff;border:none;cursor:pointer;font-size:17px;display:flex;align-items:center;justify-content:center}
.sendbtn:hover{opacity:.9}
.compfoot{display:flex;align-items:center;gap:14px;margin-top:8px;font-size:12px;color:var(--muted);flex-wrap:wrap}
.compfoot .iconbtn{font-size:12px;padding:4px 8px;border:1px solid var(--border)}
#ctxinfo{cursor:pointer}
#notionbar{width:430px;flex:0 0 430px;background:var(--side);height:100vh;display:flex;flex-direction:column;border-left:1px solid var(--border);transition:margin .2s;overflow:hidden}
body:not(.shownotion) #notionbar{margin-right:-430px}
.nhead{display:flex;align-items:center;gap:6px;padding:12px;border-bottom:1px solid var(--border)}
.npad{padding:12px;overflow:auto;flex:1}
input.search,select,textarea.set{width:100%;background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;margin-bottom:8px}
.plist{display:flex;flex-direction:column;gap:2px;margin-bottom:8px}
.pitem{padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pitem:hover{background:var(--panel2)}
.pitem.active{background:var(--panel2);color:var(--accent)}
.ntoolbar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.btn{display:inline-flex;align-items:center;gap:6px;background:var(--panel2);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:8px;font-size:12px;cursor:pointer}
.btn:hover{border-color:var(--accent)}
.btn.accent{background:var(--accent);border-color:var(--accent);color:#fff}
.title{font-size:20px;font-weight:700;margin:6px 0 14px}
.block{margin:6px 0;line-height:1.6;font-size:14px}
.block h2{font-size:18px}.block h3{font-size:16px}
.callout{background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:10px;display:flex;gap:8px}
blockquote{border-left:3px solid var(--accent);margin:8px 0;padding:2px 0 2px 12px;color:var(--muted)}
.codecard{background:#0d0d0d;border:1px solid var(--border);border-radius:10px;margin:10px 0;overflow:hidden}
body.light .codecard{background:#f6f8fa}
.codehead{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--border);font-size:11px}
.codehead .sp{flex:1}
.codecard pre{margin:0;padding:12px;overflow:auto;font-size:12.5px}
.codecard textarea{width:100%;border:none;background:none;color:var(--text);min-height:200px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;padding:12px;resize:vertical;outline:none}
mark.find{background:#e7b94e;color:#000;border-radius:2px}
#backdrop{display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:30}
#setmodal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:50;align-items:center;justify-content:center}
.modalcard{background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:20px;width:min(520px,92vw);max-height:88vh;overflow:auto}
.field{margin-bottom:8px}.lbl{font-size:11px;color:var(--muted);margin-bottom:3px;display:block}
.muted{color:var(--muted)}.row{display:flex;gap:8px;align-items:center}
#toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#000;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;z-index:90;opacity:0;pointer-events:none;transition:opacity .2s;max-width:90vw;border:1px solid var(--border)}
#toast.show{opacity:1}#toast.err{background:#3a1212;border-color:#7a2a2a;color:#ffd5d5}
@media(max-width:900px){#histbar{position:fixed;z-index:40;left:0;top:0}#notionbar{position:fixed;z-index:40;right:0;top:0;width:88vw;flex-basis:88vw}}
</style></head>
<body>
<div id="backdrop"></div>
<aside id="histbar"><div class="histtop"><span class="brand">🧑‍💻 Notion Coding</span></div><button class="newbtn" id="newchat">＋  Chat baru</button><input id="histsearch" class="search" placeholder="🔎 Cari chat..." style="margin-bottom:6px"/><div id="histlist"></div></aside>
<main class="center">
<header class="topbar"><button class="iconbtn" id="togghist" title="Riwayat">☰</button><div class="ttl">Asisten Coding</div><span style="flex:1"></span><input id="model" list="modellist" placeholder="model (default)"/><datalist id="modellist"></datalist><button class="iconbtn" id="membtn" title="Memori">🧠</button><button class="iconbtn" id="toggnotion" title="Panel Notion">📄</button><button class="iconbtn" id="settings" title="Pengaturan">⚙️</button><button class="iconbtn" id="theme" title="Tema">🌗</button></header>
<div id="msgs" class="msgs"></div>
<div class="composer"><div id="attbar" class="attbar"></div><div class="inputwrap"><textarea id="chatin" rows="1" placeholder="Tanya apa aja soal koding..."></textarea><button class="sendbtn" id="send" title="Kirim">↑</button></div><input type="file" id="fileinput" multiple style="display:none"/><div class="compfoot"><button class="iconbtn" id="attach">📎 Lampirkan</button><label class="row"><input type="checkbox" id="ctx" checked/> Pakai konteks Notion</label><span id="ctxinfo" class="muted"></span></div></div>
</main>
<aside id="notionbar"><div class="nhead"><b>📄 Notion</b><span style="flex:1"></span><button class="iconbtn" id="closenotion">✕</button></div><div class="npad"><select id="acc"></select><label id="turbowrap" class="row muted" style="font-size:12px;margin-bottom:8px;display:none"><input type="checkbox" id="turbo"/> Turbo (paralel)</label><input id="search" class="search" placeholder="Cari halaman..."/><div id="pins" class="plist" style="display:none"></div><div id="plist" class="plist"></div><div class="ntoolbar"><button class="btn" id="refresh">↻</button><button class="btn" id="addctx">➕ Konteks</button><button class="btn" id="zip">Export ZIP</button><button class="btn" id="addcode">+ Code</button><button class="btn" id="pinbtn">📌 Pin</button></div><input id="find" class="search" placeholder="🔎 Cari di halaman..."/><div id="page"><p class="muted">Pilih halaman buat dibuka.</p></div></div></aside>
<div id="setmodal"><div class="modalcard"><h2 style="margin:0 0 4px;font-size:18px">⚙️ Pengaturan</h2><p class="muted" style="margin:0 0 14px;font-size:12px">Semua disimpan di Cloudflare KV.</p><div class="field"><span class="lbl">Notion Tokens (satu per baris)</span><textarea id="settokens" class="set" rows="4" placeholder="ntn_xxx"></textarea><span id="settokinfo" class="muted" style="font-size:11px"></span></div><div class="field"><span class="lbl">OpenAI API Key</span><input id="setkey" class="search" type="password" placeholder="sk-..."/></div><div class="field"><span class="lbl">OpenAI Base URL (opsional)</span><input id="setbase" class="search" placeholder="https://api.openai.com/v1"/></div><div class="field"><span class="lbl">Default Model (opsional)</span><input id="setmodel" class="search" placeholder="gpt-4o-mini"/></div><div class="field"><span class="lbl">Workers AI Model (opsional)</span><input id="setai" class="search" placeholder="@cf/meta/llama-3.1-8b-instruct"/></div><div class="field"><span class="lbl">Backup data (chat + memori)</span><div class="row"><button class="btn" id="setexport">⬇️ Export JSON</button><button class="btn" id="setimport">⬆️ Import JSON</button><input type="file" id="impfile" accept="application/json" style="display:none"/></div></div><div id="setmsg" class="muted" style="font-size:12px;min-height:16px"></div><div class="row" style="margin-top:10px;justify-content:flex-end"><button class="btn" id="setclose">Tutup</button><button class="btn accent" id="setsave">Simpan</button></div></div></div>
<div id="toast"></div>
<script>
var BT=String.fromCharCode(96);var FENCE=BT+BT+BT;
function $(i){return document.getElementById(i)}
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
function el(t,c,h){var e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e}
function toast(m,err){var t=$("toast");t.textContent=m;t.className="show"+(err?" err":"");clearTimeout(window.__tt);window.__tt=setTimeout(function(){t.className=""},err?4000:2200)}
var EXT={javascript:"js",typescript:"ts",python:"py",java:"java",c:"c","c++":"cpp","c#":"cs",go:"go",rust:"rs",ruby:"rb",php:"php",html:"html",css:"css",json:"json",yaml:"yml",bash:"sh",shell:"sh",sql:"sql",markdown:"md",kotlin:"kt",swift:"swift",dart:"dart"};
var LANGS=["plain text","javascript","typescript","python","java","c","c++","c#","go","rust","ruby","php","html","css","json","yaml","bash","shell","sql","markdown","kotlin","swift","dart"];
var TEXTEXT=["js","ts","py","java","c","cpp","cs","go","rs","rb","php","html","css","json","yml","yaml","sh","sql","md","txt","kt","swift","dart","xml","vue","jsx","tsx"];
var IMGEXT=["png","jpg","jpeg","gif","webp","bmp","svg"];
var state={pages:[],current:null,title:"",blocks:[],chat:[],chatId:null,memory:[],context:[]};
var editing=-1;var pending=[];var __sessions=[];
function rtP(rt){return (rt||[]).map(function(t){return t.plain_text||""}).join("")}
function rt(arr){return (arr||[]).map(function(t){var x=esc(t.plain_text||"");var a=t.annotations||{};if(a.code)x="<code>"+x+"</code>";if(a.bold)x="<b>"+x+"</b>";if(a.italic)x="<i>"+x+"</i>";if(a.strikethrough)x="<s>"+x+"</s>";if(t.href)x='<a href="'+esc(t.href)+'" target="_blank">'+x+"</a>";return x}).join("")}
function accParam(){var v=$("acc").value||"0";var tb=$("turbo")&&$("turbo").checked?"&turbo=1":"";return "&acc="+encodeURIComponent(v)+tb}
async function loadAccounts(){try{var r=await fetch("/api/accounts");var d=await r.json();var sel=$("acc");sel.innerHTML="";var a=d.accounts||[];if(a.length>1){var oa=el("option","","🔀 Auto (failover)");oa.value="auto";sel.appendChild(oa)}a.forEach(function(x){var o=el("option","",esc(x.name));o.value=x.index;sel.appendChild(o)});if(a.length>1){sel.value="auto";$("turbowrap").style.display="flex"}else{$("turbowrap").style.display="none"}}catch(e){toast("Gagal load akun",true)}}
async function loadModels(){try{var r=await fetch("/api/models");var d=await r.json();var dl=$("modellist");dl.innerHTML="";(d.models||[]).forEach(function(m){var o=el("option");o.value=m;dl.appendChild(o)})}catch(e){}}
async function doSearch(){var q=$("search").value;try{var r=await fetch("/api/search?q="+encodeURIComponent(q)+accParam());var d=await r.json();if(d.error){toast(d.error,true);state.pages=[]}else state.pages=d.results||[];renderList()}catch(e){toast("Gagal search",true)}}
function renderList(){var box=$("plist");box.innerHTML="";if(!state.pages.length){box.innerHTML='<p class="muted" style="font-size:12px">Nggak ada hasil.</p>';return}state.pages.forEach(function(p){var it=el("div","pitem"+(state.current===p.id?" active":""),esc(p.title));it.onclick=function(){openPage(p.id)};box.appendChild(it)})}
async function openPage(id){state.current=id;renderList();$("page").innerHTML='<p class="muted">Memuat...</p>';try{var r=await fetch("/api/page?id="+encodeURIComponent(id)+accParam());var d=await r.json();if(d.error){$("page").innerHTML='<p class="muted">'+esc(d.error)+"</p>";toast(d.error,true);return}state.title=d.title;state.blocks=d.blocks||[];renderPage();updatePinBtn();renderCtxInfo();if(window.innerWidth>900)document.body.classList.add("shownotion")}catch(e){toast("Gagal buka halaman",true)}}
function renderPage(){var box=$("page");box.innerHTML='<div class="title">'+esc(state.title)+"</div>";state.blocks.forEach(function(b){var h=renderBlock(b);if(h){var w=el("div");w.innerHTML=h;while(w.firstChild)box.appendChild(w.firstChild)}});try{box.querySelectorAll("pre code").forEach(function(c){hljs.highlightElement(c)})}catch(e){}}
function renderBlock(b){var t=b.type;var v=b[t]||{};var kids=b.children?b.children.map(renderBlock).join(""):"";if(t==="code")return codeCard(b);if(t==="image"){var src=v.type==="external"?v.external.url:(v.file?v.file.url:"");return '<div class="block"><img src="'+esc(src)+'" style="max-width:100%;border-radius:8px"/></div>'}if(t==="divider")return "<hr/>";var txt=rt(v.rich_text);if(t==="heading_1")return '<div class="block"><h2>'+txt+"</h2></div>"+kids;if(t==="heading_2"||t==="heading_3")return '<div class="block"><h3>'+txt+"</h3></div>"+kids;if(t==="bulleted_list_item"||t==="numbered_list_item")return '<div class="block">\u2022 '+txt+"</div>"+kids;if(t==="to_do")return '<div class="block">'+(v.checked?"\u2611":"\u2610")+" "+txt+"</div>"+kids;if(t==="quote")return "<blockquote>"+txt+"</blockquote>"+kids;if(t==="callout")return '<div class="callout"><div>'+((v.icon&&v.icon.emoji)||"\ud83d\udca1")+'</div><div>'+txt+"</div></div>"+kids;if(t==="toggle")return "<details><summary>"+txt+"</summary>"+kids+"</details>";if(t==="child_page")return '<div class="block">\ud83d\udcc4 '+esc(v.title||"")+"</div>";if(txt)return '<div class="block">'+txt+"</div>"+kids;return kids}
function codeCard(b){var v=b.code||{};var txt=rtP(v.rich_text);var lang=v.language||"plain text";var card=el("div","codecard");card.setAttribute("data-block",b.id);var head=el("div","codehead");var ls=el("select");LANGS.forEach(function(l){var o=el("option","",l);o.value=l;if(l===lang)o.selected=true;ls.appendChild(o)});head.appendChild(ls);var sp=el("span","sp");head.appendChild(sp);var eb=el("button","btn","\u270f\ufe0f");var cb=el("button","btn","\ud83d\udccb");head.appendChild(eb);head.appendChild(cb);var pre=el("pre");var code=el("code","language-"+lang);code.textContent=txt;pre.appendChild(code);card.appendChild(head);card.appendChild(pre);var editingNow=false;eb.onclick=function(){if(!editingNow){var ta=el("textarea");ta.value=code.textContent;card.replaceChild(ta,pre);eb.textContent="\ud83d\udcbe";editingNow=true}else{var ta=card.querySelector("textarea");var nt=ta.value;fetch("/api/block",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:b.id,text:nt,language:ls.value,acc:$("acc").value})}).then(function(r){return r.json()}).then(function(d){if(d.error)toast(d.error,true);else toast("Tersimpan ke Notion")}).catch(function(){toast("Gagal simpan",true)});var np=el("pre");var nc=el("code","language-"+ls.value);nc.textContent=nt;np.appendChild(nc);card.replaceChild(np,ta);pre=np;code=nc;try{hljs.highlightElement(nc)}catch(e){}eb.textContent="\u270f\ufe0f";editingNow=false}};cb.onclick=function(){navigator.clipboard.writeText(code.textContent);toast("Disalin")};try{hljs.highlightElement(code)}catch(e){}var tmp=el("div");tmp.appendChild(card);return tmp.innerHTML}
function collectCode(){var out=[];function walk(arr){(arr||[]).forEach(function(b){if(b.type==="code"){out.push({language:b.code.language||"plain text",text:rtP(b.code.rich_text),path:""})}if(b.children)walk(b.children)})}walk(state.blocks);return out}
function extOf(lang){return EXT[lang]||"txt"}
function zipName(c,i){if(c.path)return c.path.replace(/^\/+/,"");return "file_"+(i+1)+"."+extOf(c.language)}
function addToZip(zip,list){var seen={};list.forEach(function(c,i){var fn=zipName(c,i);seen[fn]=(seen[fn]||0)+1;if(seen[fn]>1)fn=(i+1)+"_"+fn;zip.file(fn,c.text)})}
function downloadFile(name,blob){var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(function(){URL.revokeObjectURL(a.href)},1000)}
async function exportZip(){var codes=collectCode();if(!codes.length){toast("Nggak ada kode di halaman ini",true);return}var zip=new JSZip();addToZip(zip,codes);var blob=await zip.generateAsync({type:"blob"});downloadFile((state.title||"notion").replace(/[^a-z0-9]/gi,"_")+".zip",blob)}
async function addCode(){if(!state.current){toast("Buka halaman dulu",true);return}var lang=prompt("Bahasa (mis. javascript):","javascript");if(lang==null)return;var text=prompt("Isi kode:","");if(text==null)return;try{var r=await fetch("/api/append",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pageId:state.current,text:text,language:lang,acc:$("acc").value})});var d=await r.json();if(d.error){toast(d.error,true)}else{toast("Code block ditambahkan");openPage(state.current)}}catch(e){toast("Gagal nambah",true)}}
function addContext(){if(!state.current){toast("Buka halaman dulu",true);return}if(state.context.some(function(x){return x.id===state.current})){toast("Sudah ada di konteks");return}state.context.push({id:state.current,title:state.title,codes:collectCode()});toast("Konteks + "+state.title);renderCtxInfo()}
function clearContext(){state.context=[];renderCtxInfo();toast("Konteks dikosongkan")}
function renderCtxInfo(){var n=state.context.length;var t=$("ctxinfo");if(n){t.textContent="("+n+" halaman \u00d7)";t.title="Klik buat kosongkan"}else{t.textContent=($("ctx").checked&&state.blocks.length)?"(halaman aktif)":"";t.title=""}}
function getPins(){try{return JSON.parse(localStorage.getItem("pins")||"[]")}catch(e){return[]}}
function setPins(p){localStorage.setItem("pins",JSON.stringify(p))}
function isPinned(id){return getPins().some(function(x){return x.id===id})}
function renderPins(){var box=$("pins");var pins=getPins();if(!pins.length){box.style.display="none";return}box.style.display="flex";box.innerHTML='<div class="muted" style="font-size:11px">📌 Pinned</div>';pins.forEach(function(p){var it=el("div","pitem",esc(p.title));it.onclick=function(){openPage(p.id)};box.appendChild(it)})}
function updatePinBtn(){$("pinbtn").textContent=isPinned(state.current)?"\ud83d\udccc Unpin":"\ud83d\udccc Pin"}
function togglePin(){if(!state.current)return;var pins=getPins();if(isPinned(state.current)){pins=pins.filter(function(x){return x.id!==state.current})}else{pins.push({id:state.current,title:state.title})}setPins(pins);renderPins();updatePinBtn()}
function findInPage(q){var box=$("page");box.querySelectorAll("mark.find").forEach(function(m){m.replaceWith(document.createTextNode(m.textContent))});box.normalize();if(!q)return;var walk=document.createTreeWalker(box,NodeFilter.SHOW_TEXT,null);var nodes=[];while(walk.nextNode())nodes.push(walk.currentNode);var ql=q.toLowerCase();nodes.forEach(function(n){if(n.parentNode&&n.parentNode.tagName==="CODE")return;var txt=n.nodeValue;var low=txt.toLowerCase();if(low.indexOf(ql)<0)return;var frag=document.createDocumentFragment();var i=0,idx;while((idx=low.indexOf(ql,i))>=0){frag.appendChild(document.createTextNode(txt.slice(i,idx)));var mk=el("mark","find",esc(txt.slice(idx,idx+q.length)));frag.appendChild(mk);i=idx+q.length}frag.appendChild(document.createTextNode(txt.slice(i)));n.parentNode.replaceChild(frag,n)})}
function applyTheme(){var t=localStorage.getItem("theme")||"dark";if(t==="light")document.body.classList.add("light");else document.body.classList.remove("light")}
function toggleTheme(){var light=document.body.classList.toggle("light");localStorage.setItem("theme",light?"light":"dark")}
function updateBackdrop(){var bd=$("backdrop");var mob=window.innerWidth<=900;var open=mob&&((!document.body.classList.contains("nohist"))||document.body.classList.contains("shownotion"));bd.style.display=open?"block":"none"}
function mdInline(s){s=s.replace(/\*\*([^*]+)\*\*/g,"<b>$1</b>").replace(/(^|[^*])\*([^*]+)\*/g,"$1<i>$2</i>").replace(/~~([^~]+)~~/g,"<s>$1</s>").replace(new RegExp(BT+"([^"+BT+"]+)"+BT,"g"),"<code>$1</code>").replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g,'<a href="$2" target="_blank">$1</a>');return s}
function mdRender(text){var lines=String(text).split("\n");var out="";var i=0;while(i<lines.length){var ln=lines[i];if(ln.indexOf(FENCE)===0){var info=ln.slice(3).trim();var lang=info.split(" ")[0];var buf=[];i++;while(i<lines.length&&lines[i].indexOf(FENCE)!==0){buf.push(lines[i]);i++}i++;out+='<pre><code'+(lang?' class="language-'+esc(lang)+'"':"")+">"+esc(buf.join("\n"))+"</code></pre>";continue}var h=ln.match(/^(#{1,4})\s+(.*)$/);if(h){var n=h[1].length;out+="<h"+n+">"+mdInline(esc(h[2]))+"</h"+n+">";i++;continue}var b=ln.match(/^[-*]\s+(.*)$/);if(b){var items=[];while(i<lines.length&&lines[i].match(/^[-*]\s+(.*)$/)){items.push(lines[i].replace(/^[-*]\s+/,""));i++}out+="<ul>"+items.map(function(x){return "<li>"+mdInline(esc(x))+"</li>"}).join("")+"</ul>";continue}var nm=ln.match(/^\d+\.\s+(.*)$/);if(nm){var its=[];while(i<lines.length&&lines[i].match(/^\d+\.\s+(.*)$/)){its.push(lines[i].replace(/^\d+\.\s+/,""));i++}out+="<ol>"+its.map(function(x){return "<li>"+mdInline(esc(x))+"</li>"}).join("")+"</ol>";continue}if(ln.trim()===""){out+="";i++;continue}out+="<p>"+mdInline(esc(ln))+"</p>";i++}return out}
function parseOpts(text){var lines=String(text).split("\n");var body=[];var opts=[];lines.forEach(function(l){if(l.indexOf("::OPTIONS::")===0){l.slice(11).split("|").forEach(function(o){var t=o.trim();if(t)opts.push(t)})}else body.push(l)});return{body:body.join("\n"),opts:opts}}
function stripMemory(text){var lines=String(text).split("\n");var body=[];lines.forEach(function(l){if(l.indexOf("::MEMORY::")!==0)body.push(l)});return{body:body.join("\n")}}
function collectMemoryFrom(text){var facts=[];String(text).split("\n").forEach(function(l){if(l.indexOf("::MEMORY::")===0){var f=l.slice(10).trim();if(f)facts.push(f)}});return facts}
async function loadMemory(){try{var r=await fetch("/api/memory");var d=await r.json();state.memory=d.facts||[]}catch(e){}}
async function saveMemory(){try{await fetch("/api/memory/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({facts:state.memory})})}catch(e){}}
function showMemory(){var nv=prompt("Memori AI (satu fakta per baris). Kosongkan buat hapus semua:",state.memory.join("\n"));if(nv==null)return;state.memory=nv.split("\n").map(function(x){return x.trim()}).filter(function(x){return x});saveMemory();toast("Memori disimpan")}
function extOfName(n){var p=n.split(".");return p.length>1?p.pop().toLowerCase():""}
function isImgType(ext){return IMGEXT.indexOf(ext)>=0}
function readFileObj(file){return new Promise(function(res){var ext=extOfName(file.name);var reader=new FileReader();if(isImgType(ext)){reader.onload=function(){res({name:file.name,kind:"image",dataUrl:reader.result})};reader.readAsDataURL(file)}else if(TEXTEXT.indexOf(ext)>=0||file.size<200000){reader.onload=function(){res({name:file.name,kind:"text",text:reader.result})};reader.readAsText(file)}else{res({name:file.name,kind:"other"})}})}
async function handleZip(file){var zip=await JSZip.loadAsync(file);var files=[];var names=Object.keys(zip.files);for(var i=0;i<names.length;i++){var zf=zip.files[names[i]];if(zf.dir)continue;var ext=extOfName(names[i]);if(TEXTEXT.indexOf(ext)>=0){var txt=await zf.async("string");files.push({name:names[i],kind:"text",text:txt})}else{files.push({name:names[i],kind:"other"})}}return files}
async function addFiles(fl){for(var i=0;i<fl.length;i++){var f=fl[i];if(extOfName(f.name)==="zip"){try{var inner=await handleZip(f);pending=pending.concat(inner);toast("ZIP: "+inner.length+" file dimuat")}catch(e){toast("Gagal baca zip",true)}}else{var obj=await readFileObj(f);pending.push(obj)}}renderAttbar()}
function renderAttbar(){var box=$("attbar");box.innerHTML="";pending.forEach(function(f,i){var a=el("div","att");a.innerHTML=(f.kind==="image"?"\ud83d\uddbc\ufe0f ":"\ud83d\udcc4 ")+esc(f.name);var x=el("span","x"," \u2715");x.onclick=function(){pending.splice(i,1);renderAttbar()};a.appendChild(x);box.appendChild(a)})}
function filesHtml(files){var h="";var imgs=files.filter(function(f){return f.kind==="image"});var others=files.filter(function(f){return f.kind!=="image"});if(imgs.length){h+='<div class="thumbs">'+imgs.map(function(f){return '<img src="'+esc(f.dataUrl)+'" title="'+esc(f.name)+'"/>'}).join("")+"</div>"}others.forEach(function(f){h+='<div class="filechip">\ud83d\udcc4 '+esc(f.name)+"</div>"});return h}
function parseFence(info){info=String(info).trim();var sp=info.indexOf(" ");if(sp<0)return{language:info||"plain text",path:""};return{language:info.slice(0,sp)||"plain text",path:info.slice(sp+1).trim()}}
function collectCodeFromText(text){var out=[];var lines=String(text).split("\n");var i=0;while(i<lines.length){if(lines[i].indexOf(FENCE)===0){var meta=parseFence(lines[i].slice(3));var buf=[];i++;while(i<lines.length&&lines[i].indexOf(FENCE)!==0){buf.push(lines[i]);i++}i++;out.push({language:meta.language,path:meta.path,text:buf.join("\n")})}else i++}return out}
async function zipFromText(text,base){var codes=collectCodeFromText(text);if(!codes.length){toast("Nggak ada kode",true);return}var zip=new JSZip();addToZip(zip,codes);var blob=await zip.generateAsync({type:"blob"});downloadFile((base||"output")+".zip",blob)}
function isZipCmd(t){t=t.toLowerCase();return (t.indexOf("zip")>=0)&&(t.indexOf("semua")>=0||t.indexOf("all")>=0||t.indexOf("jadikan")>=0||t.indexOf("jadiin")>=0||t.indexOf("satu")>=0)}
async function zipAll(){var codes=collectCode();var fromChat=[];state.chat.forEach(function(m){if(m.role==="assistant")fromChat=fromChat.concat(collectCodeFromText(m.content))});var all=codes.concat(fromChat);if(!all.length){toast("Nggak ada kode buat di-zip",true);return}var zip=new JSZip();addToZip(zip,all);var blob=await zip.generateAsync({type:"blob"});downloadFile("semua-kode.zip",blob);toast("ZIP berisi "+all.length+" file")}
function pushMsg(role,content,files){state.chat.push({role:role,content:content,files:files||[]})}
function renderChat(){var c=$("msgs");c.innerHTML="";if(!state.chat.length){var emp=el("div","empty");emp.innerHTML='<div class="hello">Mau ngoding apa hari ini?</div><div>Tanya apa aja, lampirin file/foto/zip, atau buka halaman Notion di kanan.</div>';c.appendChild(emp);return}var th=el("div","thread");state.chat.forEach(function(m,i){var d=el("div","msg "+m.role);d.appendChild(el("div","avatar",m.role==="user"?"\ud83e\uddd1":"\ud83e\udd16"));var body=el("div","mbody");if(editing===i){var ta=el("textarea");ta.className="set";ta.value=m.content;ta.rows=4;body.appendChild(ta);var rw=el("div","row");rw.style.marginTop="6px";var sv=el("button","btn accent","Simpan & generate");var cn=el("button","btn","Batal");rw.appendChild(sv);rw.appendChild(cn);body.appendChild(rw);sv.onclick=function(){saveEdit(i,ta.value)};cn.onclick=function(){editing=-1;renderChat()};d.appendChild(body);th.appendChild(d);return}var pr=m.role==="assistant"?parseOpts(stripMemory(m.content).body):{body:m.content,opts:[]};var bub=el("div","bubble",mdRender(pr.body));body.appendChild(bub);try{bub.querySelectorAll("pre code").forEach(function(cb){hljs.highlightElement(cb)})}catch(e){}if(m.files&&m.files.length){var fh=el("div");fh.innerHTML=filesHtml(m.files);body.appendChild(fh)}if(pr.opts.length){var ob=el("div","opts");pr.opts.forEach(function(op){var chip=el("button","chip",esc(op));chip.onclick=function(){$("chatin").value=op;sendChat()};ob.appendChild(chip)});body.appendChild(ob)}var act=el("div","msgact");if(m.role==="user"){var eb=el("button","mini","\u270f\ufe0f Edit");eb.onclick=function(){editing=i;renderChat()};act.appendChild(eb)}if(m.role==="assistant"){if(collectCodeFromText(m.content).length){var zb=el("button","mini","\ud83d\udce6 ZIP");zb.onclick=function(){zipFromText(m.content,"ai-output")};act.appendChild(zb)}if(i===state.chat.length-1){var rb=el("button","mini","\ud83d\udd04 Ulangi");rb.onclick=function(){regenerateFrom(i)};act.appendChild(rb)}}body.appendChild(act);d.appendChild(body);th.appendChild(d)});c.appendChild(th);c.scrollTop=c.scrollHeight}
function buildContext(){var sys="Kamu asisten coding yang membantu. Balas dalam bahasa Indonesia kecuali diminta lain. Untuk kode, selalu pakai blok kode markdown dengan nama bahasa. Kalau kode untuk file tertentu, tulis nama path setelah bahasa di pembuka blok (mis. js src/app.js) biar bisa di-ZIP rapi. Kalau mau kasih pilihan ke user, tulis di baris terpisah diawali ::OPTIONS:: lalu opsi dipisah tanda |. Kalau ada fakta penting jangka panjang tentang user/proyek, tulis di baris diawali ::MEMORY:: .";if(state.memory.length)sys+="\nMemori: "+state.memory.join("; ");var ctxPages=state.context.slice();if($("ctx").checked&&state.blocks.length&&!ctxPages.some(function(x){return x.id===state.current})){ctxPages.push({id:state.current,title:state.title,codes:collectCode()})}ctxPages.forEach(function(pg){if(pg.codes&&pg.codes.length){sys+="\n\nKode dari halaman '"+pg.title+"':\n";pg.codes.forEach(function(c){sys+=FENCE+c.language+"\n"+c.text+"\n"+FENCE+"\n"})}});return sys}
function msgsForApi(){var arr=[{role:"system",content:buildContext()}];state.chat.forEach(function(m){var txt=m.content;var imgs=(m.files||[]).filter(function(f){return f.kind==="image"});(m.files||[]).forEach(function(f){if(f.kind==="text")txt+="\n\n[File: "+f.name+"]\n"+f.text});if(imgs.length){var parts=[{type:"text",text:txt}];imgs.forEach(function(f){parts.push({type:"image_url",image_url:{url:f.dataUrl}})});arr.push({role:m.role,content:parts})}else{arr.push({role:m.role,content:txt})}});return arr}
async function streamReply(){var c=$("msgs");pushMsg("assistant","");var idx=state.chat.length-1;renderChat();var ctrl=new AbortController();window.__ctrl=ctrl;$("send").textContent="\u25a0";try{var res=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:msgsForApi(),model:($("model").value||"").trim()||undefined}),signal:ctrl.signal});if(!res.ok||!res.body){var er=await res.json().catch(function(){return{}});state.chat[idx].content="\u26a0\ufe0f "+(er.error||"Gagal konek ke AI");toast(er.error||"Gagal konek ke AI",true);renderChat();return}var reader=res.body.getReader();var dec=new TextDecoder();var buf="";var acc="";while(true){var rd=await reader.read();if(rd.done)break;buf+=dec.decode(rd.value,{stream:true});var parts=buf.split("\n");buf=parts.pop();for(var k=0;k<parts.length;k++){var line=parts[k].trim();if(!line||line.indexOf("data:")!==0)continue;var payload=line.slice(5).trim();if(payload==="[DONE]")continue;try{var j=JSON.parse(payload);var delta=(j.choices&&j.choices[0]&&(j.choices[0].delta&&j.choices[0].delta.content))||j.response||"";if(delta){acc+=delta;state.chat[idx].content=acc;var bub=document.querySelectorAll(".msg.assistant .bubble");if(bub.length){var last=bub[bub.length-1];last.innerHTML=mdRender(stripMemory(acc).body)}c.scrollTop=c.scrollHeight}}catch(e){}}}var facts=collectMemoryFrom(acc);if(facts.length){facts.forEach(function(f){if(state.memory.indexOf(f)<0)state.memory.push(f)});saveMemory()}renderChat()}catch(e){if(e.name!=="AbortError"){state.chat[idx].content="\u26a0\ufe0f "+e.message;toast("Error: "+e.message,true)}renderChat()}finally{window.__ctrl=null;$("send").textContent="\u2191";saveHistory()}}
async function sendChat(){var inp=$("chatin");var text=inp.value.trim();if(!text&&!pending.length)return;if(window.__ctrl){return}if(isZipCmd(text)){pushMsg("user",text);pushMsg("assistant","Oke, aku bungkus semua kode jadi satu ZIP \ud83d\udce6");renderChat();zipAll();inp.value="";return}var files=pending.slice();pending=[];renderAttbar();pushMsg("user",text,files);inp.value="";inp.style.height="auto";renderChat();await streamReply()}
async function saveEdit(i,nt){state.chat[i].content=nt;state.chat=state.chat.slice(0,i+1);editing=-1;renderChat();await streamReply()}
async function regenerateFrom(i){state.chat=state.chat.slice(0,i);renderChat();await streamReply()}
function newChat(){state.chat=[];state.chatId=null;history.pushState({},"","/");renderChat();loadHistory()}
async function openChat(id){if(!id){newChat();return}try{var r=await fetch("/api/history?id="+encodeURIComponent(id));var d=await r.json();if(d.error){toast(d.error,true);return}state.chatId=d.id;state.chat=d.messages||[];history.pushState({},"","/chat/"+encodeURIComponent(d.id));renderChat();renderHistory();if(window.innerWidth<=900){document.body.classList.add("nohist");updateBackdrop()}}catch(e){toast("Gagal buka chat",true)}}
async function saveHistory(){try{if(!state.chat.length)return;var payload={id:state.chatId,messages:state.chat};if(!state.chatId){var fu=state.chat.filter(function(m){return m.role==="user"})[0];payload.title=fu?fu.content.slice(0,60):"Chat baru"}var r=await fetch("/api/history/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});var d=await r.json();if(d.ok&&d.id){var isNew=state.chatId!==d.id;state.chatId=d.id;if(isNew)history.replaceState({},"","/chat/"+encodeURIComponent(d.id));loadHistory()}}catch(e){}}
async function loadHistory(){try{var r=await fetch("/api/history");var d=await r.json();__sessions=d.sessions||[];renderHistory()}catch(e){}}
function renderHistory(){var box=$("histlist");var f=($("histsearch").value||"").toLowerCase();box.innerHTML="";__sessions.filter(function(s){return !f||(s.title||"").toLowerCase().indexOf(f)>=0}).forEach(function(s){var it=el("div","hitem"+(state.chatId===s.id?" active":""));var t=el("div","t",esc(s.title));t.onclick=function(){openChat(s.id)};it.appendChild(t);var rn=el("button","a","\u270f\ufe0f");rn.onclick=function(ev){ev.stopPropagation();renameChat(s.id,s.title)};var dl=el("button","a","\ud83d\uddd1\ufe0f");dl.onclick=function(ev){ev.stopPropagation();delChatById(s.id)};it.appendChild(rn);it.appendChild(dl);box.appendChild(it)})}
async function renameChat(id,old){var t=prompt("Nama baru buat chat ini:",old||"");if(t==null)return;t=t.trim();if(!t)return;try{await fetch("/api/history/rename",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:id,title:t})});toast("Nama chat diubah")}catch(e){toast("Gagal ganti nama",true)}loadHistory()}
async function delChatById(id){if(!confirm("Hapus chat ini?"))return;try{await fetch("/api/history/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:id})})}catch(e){}if(state.chatId===id)newChat();else loadHistory()}
async function exportData(){toast("Menyiapkan export...");try{var r=await fetch("/api/history");var d=await r.json();var list=d.sessions||[];var sessions=[];for(var i=0;i<list.length;i++){var rs=await fetch("/api/history?id="+encodeURIComponent(list[i].id));var sj=await rs.json();if(!sj.error)sessions.push({id:sj.id,title:sj.title,messages:sj.messages})}var mem=[];try{mem=(await (await fetch("/api/memory")).json()).facts||[]}catch(e){}var blob=new Blob([JSON.stringify({version:1,exported:Date.now(),sessions:sessions,memory:mem},null,2)],{type:"application/json"});downloadFile("notionku-backup.json",blob);toast("Export selesai ("+sessions.length+" chat)")}catch(e){toast("Gagal export",true)}}
function importData(file){var reader=new FileReader();reader.onload=async function(){try{var d=JSON.parse(reader.result);var sessions=d.sessions||[];for(var i=0;i<sessions.length;i++){await fetch("/api/history/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:sessions[i].id,title:sessions[i].title,messages:sessions[i].messages})})}if(d.memory){await fetch("/api/memory/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({facts:d.memory})});state.memory=d.memory}toast("Import selesai ("+sessions.length+" chat)");loadHistory()}catch(e){toast("File backup nggak valid",true)}};reader.readAsText(file)}
function openSettings(){fetch("/api/settings").then(function(r){return r.json()}).then(function(d){if(d.error){toast(d.error,true);return}$("settokens").value="";$("settokinfo").textContent=(d.tokens&&d.tokens.length)?("Tersimpan: "+d.tokens.join(", ")+". Isi ulang buat ganti."):"Belum ada token.";$("setkey").value="";$("setkey").placeholder=d.openai_key_set?"(tersimpan) isi buat ganti":"sk-...";$("setbase").value=d.openai_base||"";$("setmodel").value=d.openai_model||"";$("setai").value=d.ai_model||"";$("setmodal").style.display="flex"}).catch(function(){toast("Gagal load pengaturan",true)})}
function closeSettings(){$("setmodal").style.display="none"}
async function saveSettings(){var body={openai_base:$("setbase").value,openai_model:$("setmodel").value,ai_model:$("setai").value};var tk=$("settokens").value.trim();if(tk)body.tokens=tk.split("\n").map(function(x){return x.trim()}).filter(function(x){return x});var key=$("setkey").value.trim();if(key)body.openai_key=key;$("setmsg").textContent="Menyimpan...";try{var r=await fetch("/api/settings/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});var d=await r.json();if(d.error){$("setmsg").textContent=d.error;return}$("setmsg").textContent="Tersimpan \u2713";toast("Pengaturan disimpan");loadAccounts().then(doSearch);loadModels();setTimeout(closeSettings,700)}catch(e){$("setmsg").textContent="Gagal simpan"}}
function routeFromUrl(){var m=location.pathname.match(/^\/chat\/(.+)$/);if(m){var id=decodeURIComponent(m[1]);fetch("/api/history?id="+encodeURIComponent(id)).then(function(r){return r.json()}).then(function(d){if(d&&!d.error){state.chatId=d.id;state.chat=d.messages||[];renderChat();renderHistory()}})}}
$("togghist").onclick=function(){document.body.classList.toggle("nohist");updateBackdrop()};
$("toggnotion").onclick=function(){document.body.classList.toggle("shownotion");updateBackdrop()};
$("closenotion").onclick=function(){document.body.classList.remove("shownotion");updateBackdrop()};
$("backdrop").onclick=function(){document.body.classList.add("nohist");document.body.classList.remove("shownotion");updateBackdrop()};
$("settings").onclick=openSettings;$("setclose").onclick=closeSettings;$("setsave").onclick=saveSettings;
$("setmodal").addEventListener("click",function(e){if(e.target===this)closeSettings()});
$("setexport").onclick=exportData;$("setimport").onclick=function(){$("impfile").click()};
$("impfile").addEventListener("change",function(){if(this.files&&this.files[0])importData(this.files[0]);this.value=""});
$("theme").onclick=toggleTheme;$("membtn").onclick=showMemory;$("newchat").onclick=newChat;
$("histsearch").addEventListener("input",renderHistory);
$("search").addEventListener("input",function(){clearTimeout(window.__st);window.__st=setTimeout(doSearch,300)});
$("acc").addEventListener("change",doSearch);
$("turbo").addEventListener("change",function(){if(state.current)openPage(state.current);else doSearch()});
$("refresh").onclick=function(){if(state.current)openPage(state.current);else doSearch()};
$("addctx").onclick=addContext;$("ctxinfo").onclick=function(){if(state.context.length)clearContext()};$("ctx").addEventListener("change",renderCtxInfo);
$("zip").onclick=exportZip;$("addcode").onclick=addCode;$("pinbtn").onclick=togglePin;
$("find").addEventListener("input",function(){var v=this.value.trim();clearTimeout(window.__ft);window.__ft=setTimeout(function(){findInPage(v)},250)});
$("send").onclick=function(){if(window.__ctrl){window.__ctrl.abort()}else{sendChat()}};
$("chatin").addEventListener("keydown",function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendChat()}});
$("chatin").addEventListener("input",function(){this.style.height="auto";this.style.height=Math.min(this.scrollHeight,200)+"px"});
$("attach").onclick=function(){$("fileinput").click()};
$("fileinput").addEventListener("change",function(){if(this.files&&this.files.length)addFiles(this.files);this.value=""});
$("chatin").addEventListener("paste",function(e){var items=(e.clipboardData||{}).items||[];var fs=[];for(var i=0;i<items.length;i++){if(items[i].kind==="file"){var f=items[i].getAsFile();if(f)fs.push(f)}}if(fs.length){e.preventDefault();addFiles(fs)}});
applyTheme();renderPins();renderCtxInfo();
if(window.innerWidth<=900)document.body.classList.add("nohist");
updateBackdrop();
loadAccounts().then(doSearch);
loadModels();loadHistory();loadMemory();renderChat();routeFromUrl();
window.addEventListener("resize",updateBackdrop);
window.addEventListener("popstate",routeFromUrl);
<\/script>
</body></html>`;
