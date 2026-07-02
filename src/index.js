import { PAGE_HTML } from "./ui.js";
const NOTION_VERSION = "2022-06-28";
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    try {
      if (p === "/") return htmlResponse();
      if (p === "/api/accounts") return apiAccounts(env);
      if (p === "/api/search") return apiSearch(request, env);
      if (p === "/api/page") return apiPage(request, env);
      if (p === "/api/block") return apiUpdateBlock(request, env);
      if (p === "/api/append") return apiAppend(request, env);
      if (p === "/api/chat") return apiChat(request, env, ctx);
      if (p === "/api/models") return apiModels(request, env);
      if (p === "/api/history") return apiHistory(request, env);
      if (p === "/api/history/save") return apiHistorySave(request, env);
      if (p === "/api/history/rename") return apiHistoryRename(request, env);
      if (p === "/api/history/delete") return apiHistoryDelete(request, env);
      if (p === "/api/memory") return apiMemory(request, env);
      if (p === "/api/memory/save") return apiMemorySave(request, env);
      if (p === "/api/settings") return apiSettings(request, env);
      if (p === "/api/settings/save") return apiSettingsSave(request, env);
      if (p === "/api/gh/tree") return apiGhTree(request, env);
      if (p === "/api/gh/file") return apiGhFile(request, env);
      if (p === "/api/gh/commit") return apiGhCommit(request, env);
      if (p === "/api/gh/oauth/start") return apiGhOauthStart(request, env);
      if (p === "/api/gh/oauth/poll") return apiGhOauthPoll(request, env);
      if (p === "/api/gh/repos") return apiGhRepos(request, env);
      if (p.startsWith("/api/")) return json({ error: "Not found" }, 404);
      return htmlResponse();
    } catch (e) { return json({ error: String((e && e.message) || e) }, 500); }
  },
};
function json(o, s) { return new Response(JSON.stringify(o), { status: s || 200, headers: { "content-type": "application/json; charset=utf-8" } }); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function getConfig(env) {
  const cfg = { tokens: [], openai_key: "", openai_base: "", openai_model: "", ai_model: "", gh_token: "", gh_owner: "", gh_repo: "", gh_branch: "", gh_client_id: "" };
  if (env.CHAT) { const s = await env.CHAT.get("config", "json"); if (s) { cfg.tokens = s.tokens || []; cfg.openai_key = s.openai_key || ""; cfg.openai_base = s.openai_base || ""; cfg.openai_model = s.openai_model || ""; cfg.ai_model = s.ai_model || ""; cfg.gh_token = s.gh_token || ""; cfg.gh_owner = s.gh_owner || ""; cfg.gh_repo = s.gh_repo || ""; cfg.gh_branch = s.gh_branch || ""; cfg.gh_client_id = s.gh_client_id || ""; } }
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
  let tokens; try { tokens = await getTokens(env); } catch (e) { return json({ accounts: [] }); }
  const accounts = await Promise.all(tokens.map(async (tk, i) => { try { const me = await notion(env, "/users/me", {}, tk); const name = (me.bot && me.bot.workspace_name) || me.name || ("Akun " + (i + 1)); return { index: i, name }; } catch (e) { return { index: i, name: "Akun " + (i + 1) + " (token invalid)" }; } }));
  return json({ accounts });
}
async function apiSearch(request, env) {
  const u = new URL(request.url); const q = u.searchParams.get("q") || ""; const acc = u.searchParams.get("acc"); let all; try { all = await getTokens(env); } catch (e) { return json({ results: [], needsToken: true }); }
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
function hashKey(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; } return ("00000000" + h.toString(16)).slice(-8) + str.length.toString(36); }
function sseFromText(text) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({ start(c) { const size = 90; for (let i = 0; i < text.length; i += size) { c.enqueue(enc.encode("data: " + JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + size) } }] }) + "\n\n")); } c.enqueue(enc.encode("data: [DONE]\n\n")); c.close(); } });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "x-cache": "HIT" } });
}
function cacheTee(source, env, ck, ctx) {
  let acc = ""; let buf = ""; const dec = new TextDecoder();
  const ts = new TransformStream({
    transform(chunk, controller) { controller.enqueue(chunk); try { buf += dec.decode(chunk, { stream: true }); const parts = buf.split("\n"); buf = parts.pop(); for (const line of parts) { const l = line.trim(); if (!l || l.indexOf("data:") !== 0) continue; const pl = l.slice(5).trim(); if (pl === "[DONE]") continue; try { const j = JSON.parse(pl); const d = (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) || j.response || ""; if (d) acc += d; } catch (e) {} } } catch (e) {} },
    flush() { if (ck && acc && ctx && ctx.waitUntil) { try { ctx.waitUntil(env.CHAT.put(ck, acc, { expirationTtl: 86400 })); } catch (e) {} } },
  });
  return source.pipeThrough(ts);
}
async function apiChat(request, env, ctx) {
  const body = await request.json(); const messages = body.messages || []; const cfg = await getConfig(env); const key = cfg.openai_key || env.OPENAI_API_KEY;
  const model0 = body.model || cfg.openai_model || cfg.ai_model || "";
  const cacheOn = !!env.CHAT && body.cache !== false && messages.length > 0;
  const ck = cacheOn ? ("cache:" + hashKey(model0 + "\u0000" + JSON.stringify(messages))) : null;
  if (ck) { try { const hit = await env.CHAT.get(ck); if (hit) return sseFromText(hit); } catch (e) {} }
  if (!key && env.AI) { const stream = await env.AI.run(body.model || cfg.ai_model || env.AI_MODEL || "@cf/meta/llama-3.1-8b-instruct", { messages, stream: true }); return new Response(cacheTee(stream, env, ck, ctx), { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "x-cache": "MISS" } }); }
  if (!key) return json({ error: "OpenAI API Key belum di-set. Buka Pengaturan di web." }, 400);
  const base = cfg.openai_base || env.OPENAI_BASE_URL || "https://api.openai.com/v1"; const model = body.model || cfg.openai_model || env.OPENAI_MODEL || "gpt-4o-mini";
  const res = await fetch(base + "/chat/completions", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ model, messages, stream: true }) });
  if (!res.ok) { const t = await res.text(); return json({ error: "LLM error: " + t }, 500); }
  return new Response(cacheTee(res.body, env, ck, ctx), { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "x-cache": "MISS" } });
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
  const index = await readIndex(env); index.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const off = parseInt(u.searchParams.get("offset") || "0", 10) || 0; const lim = parseInt(u.searchParams.get("limit") || "0", 10) || 0;
  if (lim > 0) return json({ sessions: index.slice(off, off + lim), total: index.length, hasMore: off + lim < index.length });
  return json({ sessions: index, total: index.length });
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
async function apiSettings(request, env) { if (!env.CHAT) return json({ error: "KV binding CHAT belum di-set. Deploy dengan KV namespace dulu." }, 400); const cfg = await getConfig(env); return json({ tokens: cfg.tokens.map(maskTok), openai_key_set: !!cfg.openai_key, openai_base: cfg.openai_base, openai_model: cfg.openai_model, ai_model: cfg.ai_model, gh_token_set: !!cfg.gh_token, gh_owner: cfg.gh_owner, gh_repo: cfg.gh_repo, gh_branch: cfg.gh_branch, gh_client_id: cfg.gh_client_id }); }
async function apiSettingsSave(request, env) {
  if (!env.CHAT) return json({ error: "KV binding CHAT belum di-set" }, 400);
  const body = await request.json(); const cur = await getConfig(env); let tokens = cur.tokens;
  if (Array.isArray(body.tokens)) tokens = body.tokens.map((t) => String(t).trim()).filter((t) => t);
  if (body.clear_tokens) tokens = [];
  let key = cur.openai_key; if (typeof body.openai_key === "string" && body.openai_key.trim()) key = body.openai_key.trim(); if (body.clear_openai_key) key = "";
  let gh = cur.gh_token; if (typeof body.gh_token === "string" && body.gh_token.trim()) gh = body.gh_token.trim(); if (body.clear_gh_token) gh = "";
  const gho = typeof body.gh_owner === "string" ? body.gh_owner.trim() : (cur.gh_owner || "");
  const ghr = typeof body.gh_repo === "string" ? body.gh_repo.trim() : (cur.gh_repo || "");
  const ghb = typeof body.gh_branch === "string" ? body.gh_branch.trim() : (cur.gh_branch || "");
  const obase = typeof body.openai_base === "string" ? body.openai_base.trim() : (cur.openai_base || "");
  const omodel = typeof body.openai_model === "string" ? body.openai_model.trim() : (cur.openai_model || "");
  const aimodel = typeof body.ai_model === "string" ? body.ai_model.trim() : (cur.ai_model || "");
  const gci = typeof body.gh_client_id === "string" ? body.gh_client_id.trim() : (cur.gh_client_id || "");
  await env.CHAT.put("config", JSON.stringify({ tokens, openai_key: key, openai_base: obase, openai_model: omodel, ai_model: aimodel, gh_token: gh, gh_owner: gho, gh_repo: ghr, gh_branch: ghb, gh_client_id: gci }));
  return json({ ok: true, tokenCount: tokens.length });
}
function b64encode(str) { const bytes = new TextEncoder().encode(str); let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]); return btoa(bin); }
function b64decode(b64) { const bin = atob(String(b64).replace(/\n/g, "")); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }
async function ghApi(env, path, init) {
  const cfg = await getConfig(env); if (!cfg.gh_token) throw new Error("GitHub token belum di-set. Buka Pengaturan.");
  init = init || {};
  const res = await fetch("https://api.github.com" + path, { method: init.method || "GET", headers: { Authorization: "Bearer " + cfg.gh_token, Accept: "application/vnd.github+json", "User-Agent": "notionku-worker", "Content-Type": "application/json" }, body: init.body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data && data.message) || ("GitHub error " + res.status));
  return data;
}
function ghPath(p) { return String(p).split("/").map(encodeURIComponent).join("/"); }
async function ghRepo(env) { const cfg = await getConfig(env); if (!cfg.gh_owner || !cfg.gh_repo) throw new Error("Owner/repo GitHub belum di-set di Pengaturan."); return { owner: cfg.gh_owner, repo: cfg.gh_repo, branch: cfg.gh_branch || "main" }; }
async function apiGhTree(request, env) {
  const r = await ghRepo(env);
  const data = await ghApi(env, "/repos/" + r.owner + "/" + r.repo + "/git/trees/" + encodeURIComponent(r.branch) + "?recursive=1");
  const files = (data.tree || []).filter((t) => t.type === "blob").map((t) => ({ path: t.path, sha: t.sha }));
  return json({ files, repo: r.owner + "/" + r.repo, branch: r.branch });
}
async function apiGhFile(request, env) {
  const u = new URL(request.url); const path = u.searchParams.get("path"); if (!path) return json({ error: "path wajib" }, 400);
  const r = await ghRepo(env);
  const data = await ghApi(env, "/repos/" + r.owner + "/" + r.repo + "/contents/" + ghPath(path) + "?ref=" + encodeURIComponent(r.branch));
  let content = ""; if (data.content) { try { content = b64decode(data.content); } catch (e) { content = ""; } }
  return json({ path, sha: data.sha, content });
}
async function apiGhCommit(request, env) {
  const body = await request.json(); const files = body.files || []; if (!files.length) return json({ error: "Nggak ada file buat di-commit" }, 400);
  const r = await ghRepo(env); const base = "/repos/" + r.owner + "/" + r.repo;
  try {
    const ref = await ghApi(env, base + "/git/ref/heads/" + encodeURIComponent(r.branch));
    const baseSha = ref.object.sha;
    const baseCommit = await ghApi(env, base + "/git/commits/" + baseSha);
    const treeItems = [];
    for (const f of files) {
      const blob = await ghApi(env, base + "/git/blobs", { method: "POST", body: JSON.stringify({ content: b64encode(f.content || ""), encoding: "base64" }) });
      treeItems.push({ path: String(f.path).replace(/^\/+/, ""), mode: "100644", type: "blob", sha: blob.sha });
    }
    const tree = await ghApi(env, base + "/git/trees", { method: "POST", body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: treeItems }) });
    const commit = await ghApi(env, base + "/git/commits", { method: "POST", body: JSON.stringify({ message: body.message || ("Update " + files.length + " file via notionku"), tree: tree.sha, parents: [baseSha] }) });
    await ghApi(env, base + "/git/refs/heads/" + encodeURIComponent(r.branch), { method: "PATCH", body: JSON.stringify({ sha: commit.sha }) });
    return json({ results: files.map((f) => ({ path: f.path, ok: true, url: commit.html_url || "" })), commit: commit.sha, commit_url: commit.html_url || "", count: files.length });
  } catch (e) {
    const msg = String((e && e.message) || e);
    return json({ results: files.map((f) => ({ path: f.path, ok: false, error: msg })), error: msg });
  }
}

async function apiGhOauthStart(request, env) {
  const cfg = await getConfig(env); if (!cfg.gh_client_id) return json({ error: "GitHub Client ID belum di-set. Isi dulu di Pengaturan." }, 400);
  const res = await fetch("https://github.com/login/device/code", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ client_id: cfg.gh_client_id, scope: "repo" }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.error) return json({ error: d.error_description || d.error || ("GitHub error " + res.status) }, 400);
  return json({ device_code: d.device_code, user_code: d.user_code, verification_uri: d.verification_uri, interval: d.interval || 5, expires_in: d.expires_in || 900 });
}
async function apiGhOauthPoll(request, env) {
  const body = await request.json(); const cfg = await getConfig(env);
  if (!cfg.gh_client_id) return json({ error: "GitHub Client ID belum di-set." }, 400);
  if (!body.device_code) return json({ error: "device_code wajib" }, 400);
  const res = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ client_id: cfg.gh_client_id, device_code: body.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }) });
  const d = await res.json().catch(() => ({}));
  if (d.access_token) { const c = await getConfig(env); c.gh_token = d.access_token; await env.CHAT.put("config", JSON.stringify(c)); return json({ ok: true }); }
  return json({ error: d.error || "authorization_pending" });
}
async function apiGhRepos(request, env) {
  const cfg = await getConfig(env);
  const data = await ghApi(env, "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member");
  const repos = (data || []).map((x) => ({ full_name: x.full_name, default_branch: x.default_branch || "main" }));
  const current = cfg.gh_owner && cfg.gh_repo ? (cfg.gh_owner + "/" + cfg.gh_repo) : "";
  return json({ repos, current });
}
function htmlResponse() { return new Response(PAGE_HTML, { headers: { "content-type": "text/html; charset=utf-8" } }); }
