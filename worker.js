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
      if (p === "/api/history") return apiHistory(request, env);
      if (p === "/api/history/save") return apiHistorySave(request, env);
      if (p === "/api/history/delete") return apiHistoryDelete(request, env);
      if (p === "/api/memory") return apiMemory(request, env);
      if (p === "/api/memory/save") return apiMemorySave(request, env);
      if (p === "/api/settings") return apiSettings(request, env);
      if (p === "/api/settings/save") return apiSettingsSave(request, env);
      if (p.startsWith("/api/")) return json({ error: "Not found" }, 404);
      return htmlResponse();
    } catch (e) {
      return json({ error: String((e && e.message) || e) }, 500);
    }
  },
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getConfig(env) {
  const cfg = { tokens: [], openai_key: "", openai_base: "", openai_model: "", ai_model: "" };
  if (env.CHAT) {
    const saved = await env.CHAT.get("config", "json");
    if (saved) {
      cfg.tokens = saved.tokens || [];
      cfg.openai_key = saved.openai_key || "";
      cfg.openai_base = saved.openai_base || "";
      cfg.openai_model = saved.openai_model || "";
      cfg.ai_model = saved.ai_model || "";
    }
  }
  return cfg;
}

async function getTokens(env) {
  const set = [];
  const cfg = await getConfig(env);
  cfg.tokens.forEach((t) => {
    const v = String(t).trim();
    if (v) set.push(v);
  });
  if (env.NOTION_TOKENS)
    env.NOTION_TOKENS.split(",").forEach((t) => {
      const v = t.trim();
      if (v) set.push(v);
    });
  for (let i = 1; i <= 9; i++) {
    const v = env["NOTION_TOKEN_" + i];
    if (v) set.push(String(v).trim());
  }
  if (env.NOTION_TOKEN) set.push(String(env.NOTION_TOKEN).trim());
  const uniq = [];
  set.forEach((t) => {
    if (uniq.indexOf(t) < 0) uniq.push(t);
  });
  if (!uniq.length)
    throw new Error("Belum ada token Notion. Buka Pengaturan di web buat nambahin, atau set NOTION_TOKENS.");
  return uniq;
}

async function pickToken(env, acc) {
  const tokens = await getTokens(env);
  const i = parseInt(acc || "0", 10) || 0;
  return tokens[i] || tokens[0];
}

function nextToken(tokens, ref) {
  const t = tokens[ref.i % tokens.length];
  ref.i++;
  return t;
}

async function notion(env, endpoint, init, token) {
  init = init || {};
  for (let a = 0; a < 4; a++) {
    const res = await fetch("https://api.notion.com/v1" + endpoint, {
      method: init.method || "GET",
      headers: {
        Authorization: "Bearer " + token,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: init.body,
    });
    if (res.status === 429) {
      const ra = parseFloat(res.headers.get("Retry-After") || "1");
      await sleep((ra || 1) * 1000);
      continue;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || ("Notion error " + res.status));
    return data;
  }
  throw new Error("Notion rate limited (429)");
}

function rtPlain(rt) {
  return (rt || []).map((t) => t.plain_text || "").join("");
}

function pageTitle(p) {
  const props = p.properties || {};
  for (const k in props) {
    if (props[k] && props[k].type === "title")
      return rtPlain(props[k].title) || "Untitled";
  }
  return "Untitled";
}

async function apiAccounts(env) {
  const tokens = await getTokens(env);
  const accounts = await Promise.all(
    tokens.map(async (tk, i) => {
      try {
        const me = await notion(env, "/users/me", {}, tk);
        const name =
          (me.bot && me.bot.workspace_name) || me.name || ("Akun " + (i + 1));
        return { index: i, name: name };
      } catch (e) {
        return { index: i, name: "Akun " + (i + 1) + " (token invalid)" };
      }
    })
  );
  return json({ accounts });
}

async function apiSearch(request, env) {
  const u = new URL(request.url);
  const q = u.searchParams.get("q") || "";
  const token = await pickToken(env, u.searchParams.get("acc"));
  const data = await notion(
    env,
    "/search",
    {
      method: "POST",
      body: JSON.stringify({
        query: q,
        page_size: 50,
        filter: { property: "object", value: "page" },
        sort: { direction: "descending", timestamp: "last_edited_time" },
      }),
    },
    token
  );
  const results = (data.results || []).map((p) => ({
    id: p.id,
    title: pageTitle(p),
    last_edited: p.last_edited_time,
  }));
  return json({ results });
}

async function fetchBlocks(env, blockId, tokens, ref) {
  let blocks = [];
  let cursor = null;
  do {
    const token = nextToken(tokens, ref);
    const qs = cursor
      ? "?start_cursor=" + cursor + "&page_size=100"
      : "?page_size=100";
    const data = await notion(env, "/blocks/" + blockId + "/children" + qs, {}, token);
    for (const b of data.results || []) blocks.push(b);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  const withKids = blocks.filter(
    (b) => b.has_children && b.type !== "child_page" && b.type !== "child_database"
  );
  await Promise.all(
    withKids.map((b) =>
      fetchBlocks(env, b.id, tokens, ref).then((c) => {
        b.children = c;
      })
    )
  );
  return blocks;
}

async function apiPage(request, env) {
  const u = new URL(request.url);
  const id = u.searchParams.get("id");
  if (!id) return json({ error: "id wajib" }, 400);
  const allTokens = await getTokens(env);
  const acc = parseInt(u.searchParams.get("acc") || "0", 10) || 0;
  const turbo = u.searchParams.get("turbo") === "1" && allTokens.length > 1;
  const tokens = turbo ? allTokens : [allTokens[acc] || allTokens[0]];
  const ref = { i: 0 };
  const page = await notion(env, "/pages/" + id, {}, tokens[0]);
  const blocks = await fetchBlocks(env, id, tokens, ref);
  return json({ id, title: pageTitle(page), blocks });
}

async function apiUpdateBlock(request, env) {
  const body = await request.json();
  const token = await pickToken(env, body.acc);
  const type = body.type || "code";
  const payload = {};
  payload[type] = { rich_text: [{ type: "text", text: { content: body.text || "" } }] };
  if (type === "code" && body.language) payload[type].language = body.language;
  const data = await notion(
    env,
    "/blocks/" + body.id,
    { method: "PATCH", body: JSON.stringify(payload) },
    token
  );
  return json({ ok: true, block: data });
}

async function apiAppend(request, env) {
  const body = await request.json();
  const token = await pickToken(env, body.acc);
  const data = await notion(
    env,
    "/blocks/" + body.pageId + "/children",
    {
      method: "PATCH",
      body: JSON.stringify({
        children: [
          {
            object: "block",
            type: "code",
            code: {
              rich_text: [{ type: "text", text: { content: body.text || "" } }],
              language: body.language || "plain text",
            },
          },
        ],
      }),
    },
    token
  );
  return json({ ok: true, result: data });
}

async function apiChat(request, env) {
  const body = await request.json();
  const messages = body.messages || [];
  const cfg = await getConfig(env);
  const key = cfg.openai_key || env.OPENAI_API_KEY;
  if (!key && env.AI) {
    const stream = await env.AI.run(body.model || cfg.ai_model || env.AI_MODEL || "@cf/meta/llama-3.1-8b-instruct", {
      messages,
      stream: true,
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    });
  }
  if (!key)
    return json({ error: "OpenAI API Key belum di-set. Buka Pengaturan di web atau aktifin binding AI." }, 400);
  const base = cfg.openai_base || env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = body.model || cfg.openai_model || env.OPENAI_MODEL || "gpt-4o-mini";
  const res = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, stream: true }),
  });
  if (!res.ok) {
    const t = await res.text();
    return json({ error: "LLM error: " + t }, 500);
  }
  return new Response(res.body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
  });
}

async function readIndex(env) {
  if (!env.CHAT) return [];
  return (await env.CHAT.get("index", "json")) || [];
}

async function apiHistory(request, env) {
  if (!env.CHAT) return json({ error: "KV binding CHAT belum di-set" }, 400);
  const u = new URL(request.url);
  const id = u.searchParams.get("id");
  if (id) {
    const sess = await env.CHAT.get("session:" + id, "json");
    if (!sess) return json({ error: "Sesi nggak ketemu" }, 404);
    return json(sess);
  }
  const index = await readIndex(env);
  index.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  return json({ sessions: index });
}

async function apiHistorySave(request, env) {
  if (!env.CHAT) return json({ error: "KV binding CHAT belum di-set" }, 400);
  const body = await request.json();
  const id =
    body.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
  const title = (body.title || "Chat baru").slice(0, 80);
  const updated = Date.now();
  const sess = { id, title, updated, messages: body.messages || [] };
  await env.CHAT.put("session:" + id, JSON.stringify(sess));
  let index = await readIndex(env);
  index = index.filter((s) => s.id !== id);
  index.push({ id, title, updated });
  await env.CHAT.put("index", JSON.stringify(index));
  return json({ ok: true, id, title, updated });
}

async function apiHistoryDelete(request, env) {
  if (!env.CHAT) return json({ error: "KV binding CHAT belum di-set" }, 400);
  const body = await request.json();
  await env.CHAT.delete("session:" + body.id);
  let index = await readIndex(env);
  index = index.filter((s) => s.id !== body.id);
  await env.CHAT.put("index", JSON.stringify(index));
  return json({ ok: true });
}

async function apiMemory(request, env) {
  if (!env.CHAT) return json({ facts: [] });
  const facts = (await env.CHAT.get("memory:facts", "json")) || [];
  return json({ facts });
}

async function apiMemorySave(request, env) {
  if (!env.CHAT) return json({ error: "KV binding CHAT belum di-set" }, 400);
  const body = await request.json();
  const facts = (body.facts || []).slice(0, 100);
  await env.CHAT.put("memory:facts", JSON.stringify(facts));
  return json({ ok: true, facts });
}

function maskTok(t) {
  t = String(t);
  return t.length <= 10 ? "****" : t.slice(0, 6) + "..." + t.slice(-4);
}

async function apiSettings(request, env) {
  if (!env.CHAT)
    return json({ error: "KV binding CHAT belum di-set. Deploy dengan KV namespace dulu." }, 400);
  const cfg = await getConfig(env);
  return json({
    tokens: cfg.tokens.map(maskTok),
    openai_key_set: !!cfg.openai_key,
    openai_base: cfg.openai_base,
    openai_model: cfg.openai_model,
    ai_model: cfg.ai_model,
  });
}

async function apiSettingsSave(request, env) {
  if (!env.CHAT) return json({ error: "KV binding CHAT belum di-set" }, 400);
  const body = await request.json();
  const cur = await getConfig(env);
  let tokens = cur.tokens;
  if (Array.isArray(body.tokens))
    tokens = body.tokens.map((t) => String(t).trim()).filter((t) => t);
  let key = cur.openai_key;
  if (typeof body.openai_key === "string" && body.openai_key.trim())
    key = body.openai_key.trim();
  if (body.clear_openai_key) key = "";
  const next = {
    tokens: tokens,
    openai_key: key,
    openai_base: (body.openai_base || "").trim(),
    openai_model: (body.openai_model || "").trim(),
    ai_model: (body.ai_model || "").trim(),
  };
  await env.CHAT.put("config", JSON.stringify(next));
  return json({ ok: true, tokenCount: tokens.length });
}

function htmlResponse() {
  return new Response(PAGE_HTML, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const PAGE_HTML = `<!DOCTYPE html>
<html lang="id"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Notion Coding Web</title>
<script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github-dark.min.css">
<script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js"></script>
<style>
:root{--bg:#191919;--panel:#202020;--panel2:#252525;--border:#333;--text:#e6e6e6;--muted:#888;--accent:#2e9bff}
*{box-sizing:border-box}
body{margin:0;font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);height:100vh;overflow:hidden}
.app{display:grid;grid-template-columns:270px 1fr 380px;height:100vh}
.col{height:100vh;overflow:auto;border-right:1px solid var(--border)}
.side{background:var(--panel);padding:12px}
.main{padding:20px 28px}
.chat{background:var(--panel);display:flex;flex-direction:column;border-right:none}
h1.brand{font-size:15px;margin:4px 0 12px;display:flex;gap:8px;align-items:center}
input.search,textarea,select{width:100%;background:var(--panel2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:9px 11px;font-size:13px;outline:none}
input.search:focus,textarea:focus{border-color:var(--accent)}
.plist{margin-top:10px;display:flex;flex-direction:column;gap:2px}
.pitem{padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pitem:hover{background:var(--panel2)}
.pitem.active{background:#2b3b50}
.toolbar{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;gap:6px;background:var(--panel2);border:1px solid var(--border);color:var(--text);padding:7px 12px;border-radius:7px;font-size:12px;cursor:pointer}
.btn:hover{border-color:var(--accent)}
.btn.accent{background:var(--accent);border-color:var(--accent);color:#fff}
.title{font-size:24px;font-weight:700;margin:0 0 18px}
.block{margin:6px 0;line-height:1.6}
.block h2{font-size:20px;margin:18px 0 6px}.block h3{font-size:17px}.block h4{font-size:15px}
.li{margin:2px 0 2px 6px}
.callout{background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;display:flex;gap:8px}
blockquote{border-left:3px solid var(--accent);margin:8px 0;padding:2px 0 2px 12px;color:#cfcfcf}
.codecard{background:#0f0f0f;border:1px solid var(--border);border-radius:10px;margin:12px 0;overflow:hidden}
.codehead{display:flex;align-items:center;gap:8px;padding:7px 10px;background:#161616;border-bottom:1px solid var(--border);font-size:11px}
.codehead .sp{flex:1}
.codecard pre{margin:0;padding:14px;overflow:auto;font-size:13px}
.codecard textarea{border:none;border-radius:0;min-height:220px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;resize:vertical}
.codehead select{width:auto;padding:3px 6px;font-size:11px;border-radius:6px}
.chathead{padding:12px;border-bottom:1px solid var(--border);font-size:14px;font-weight:600}
.msgs{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:12px}
.msg{font-size:13px;line-height:1.55}
.msg .role{font-size:11px;color:var(--muted);margin-bottom:3px}
.msg.user .bubble{background:#2b3b50}
.msg .bubble{background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:9px 11px;white-space:pre-wrap;word-break:break-word}
.msg .bubble pre{background:#0f0f0f;padding:10px;border-radius:8px;overflow:auto;white-space:pre}
.chatfoot{padding:12px;border-top:1px solid var(--border)}
.muted{color:var(--muted)}
.row{display:flex;gap:8px;align-items:center}
.field{margin-bottom:8px}
.lbl{font-size:11px;color:var(--muted);margin-bottom:3px;display:block}
.spin{color:var(--muted);font-size:12px;padding:6px 10px}
.opts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.chip{background:#2b3b50;border:1px solid var(--accent);color:#dfeaff;padding:6px 11px;border-radius:16px;font-size:12px;cursor:pointer}
.chip:hover{background:var(--accent);color:#fff}
body.light{--bg:#ffffff;--panel:#f7f7f5;--panel2:#ececec;--border:#dcdcdc;--text:#1f1f1f;--muted:#777}
mark.find{background:#e7b94e;color:#000;border-radius:2px}
.msg .bubble ul,.msg .bubble ol{margin:6px 0;padding-left:20px}
.msg .bubble h2,.msg .bubble h3,.msg .bubble h4{margin:8px 0 4px}
.msg .bubble code{background:rgba(127,127,127,.2);padding:1px 4px;border-radius:4px}
.msg .bubble a{color:var(--accent)}
.msgact{display:flex;gap:8px;margin-top:5px}
.mini{background:none;border:none;color:var(--muted);font-size:11px;cursor:pointer;padding:0}
.mini:hover{color:var(--accent)}
.attbar{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}
.att{display:flex;align-items:center;gap:5px;background:var(--panel2);border:1px solid var(--border);border-radius:6px;padding:3px 7px;font-size:11px}
.att .x{cursor:pointer;color:var(--muted)}
.thumbs{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.thumbs img{max-width:120px;max-height:120px;border-radius:6px;border:1px solid var(--border)}
.filechip{display:inline-flex;align-items:center;gap:4px;background:var(--panel2);border:1px solid var(--border);border-radius:6px;padding:3px 7px;font-size:11px;margin-top:4px}
@media(max-width:980px){.app{grid-template-columns:1fr}.col{height:auto;border-right:none;border-bottom:1px solid var(--border)}body{overflow:auto;height:auto}}
</style></head>
<body>
<div class="app">
  <div class="col side">
    <h1 class="brand">🧑‍💻 Notion Coding<span style="flex:1"></span><button class="btn" id="settings" title="Pengaturan">⚙️</button><button class="btn" id="theme" title="Tema">🌗</button></h1>
    <div class="field"><span class="lbl">Akun</span><select id="acc"></select></div>
    <label id="turbowrap" class="row muted" style="font-size:12px;margin-bottom:8px"><input type="checkbox" id="turbo"/> Turbo (paralel multi-token)</label>
    <div id="pins" class="plist" style="display:none;margin-bottom:8px"></div>
    <input id="search" class="search" placeholder="Cari halaman..."/>
    <div id="plist" class="plist"></div>
  </div>
  <div class="col main">
    <div class="toolbar">
      <button class="btn" id="refresh">Refresh</button>
      <button class="btn" id="zip">Export ZIP</button>
      <button class="btn" id="addcode">+ Code block</button>
      <button class="btn" id="pinbtn">📌 Pin</button>
      <input id="find" class="search" style="max-width:220px" placeholder="🔎 Cari di halaman..."/>
    </div>
    <div id="page"><p class="muted">Pilih halaman di kiri buat mulai.</p></div>
  </div>
  <div class="col chat">
    <div class="chathead">
      <div class="row" style="margin-bottom:8px">💬 Asisten AI</div>
      <div class="row"><select id="histsel" style="flex:1"></select><button class="btn" id="newchat">Baru</button><button class="btn" id="delchat">Hapus</button><button class="btn" id="membtn" title="Memori AI">🧠</button></div>
    </div>
    <div id="msgs" class="msgs"></div>
    <div class="chatfoot">
      <div class="field"><span class="lbl">Model AI</span><input id="model" class="search" list="modellist" placeholder="default (dari server)"/><datalist id="modellist"><option value="gpt-4o-mini"></option><option value="gpt-4o"></option><option value="o4-mini"></option><option value="llama-3.3-70b-versatile"></option><option value="@cf/meta/llama-3.1-8b-instruct"></option></datalist></div>
      <label class="row muted" style="font-size:12px;margin-bottom:8px"><input type="checkbox" id="ctx" checked/> Sertakan kode halaman ini sbg konteks</label>
      <div id="attbar" class="attbar"></div>
      <textarea id="chatin" rows="2" placeholder="Tanya apa aja soal koding... (bisa lampirin file/zip/foto)"></textarea>
      <input type="file" id="fileinput" multiple style="display:none"/>
      <div class="row" style="margin-top:8px"><button class="btn accent" id="send">Kirim</button><button class="btn" id="attach">📎 Lampirkan</button><button class="btn" id="clear">Bersihkan</button></div>
    </div>
  </div>
</div>
<div id="setmodal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:50;align-items:center;justify-content:center">
  <div style="background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:20px;width:min(520px,92vw);max-height:88vh;overflow:auto">
    <h2 style="margin:0 0 4px;font-size:18px">⚙️ Pengaturan</h2>
    <p class="muted" style="margin:0 0 14px;font-size:12px">Semua disimpan di Cloudflare KV. Deploy worker sekali via CMD, sisanya atur di sini.</p>
    <div class="field"><span class="lbl">Notion Integration Tokens (satu per baris)</span><textarea id="settokens" rows="4" placeholder="ntn_xxx&#10;ntn_yyy"></textarea><span id="settokinfo" class="muted" style="font-size:11px"></span></div>
    <div class="field"><span class="lbl">OpenAI API Key</span><input id="setkey" class="search" type="password" placeholder="sk-..."/></div>
    <div class="field"><span class="lbl">OpenAI Base URL (opsional)</span><input id="setbase" class="search" placeholder="https://api.openai.com/v1"/></div>
    <div class="field"><span class="lbl">Default Model (opsional)</span><input id="setmodel" class="search" placeholder="gpt-4o-mini"/></div>
    <div class="field"><span class="lbl">Workers AI Model (opsional)</span><input id="setai" class="search" placeholder="@cf/meta/llama-3.1-8b-instruct"/></div>
    <div id="setmsg" class="muted" style="font-size:12px;min-height:16px"></div>
    <div class="row" style="margin-top:10px;justify-content:flex-end"><button class="btn" id="setclose">Tutup</button><button class="btn accent" id="setsave">Simpan</button></div>
  </div>
</div>
<script>
var BT=String.fromCharCode(96);
var FENCE=BT+BT+BT;
var state={pages:[],current:null,title:"",blocks:[],chat:[],chatId:null,memory:[]};var editing=-1;var pending=[];
var EXT={javascript:"js",typescript:"ts",python:"py",bash:"sh",shell:"sh",html:"html",css:"css",json:"json",java:"java",go:"go",rust:"rs",cpp:"cpp",c:"c",ruby:"rb",php:"php",sql:"sql",yaml:"yaml",markdown:"md","plain text":"txt"};
var LANGS=["plain text","javascript","typescript","python","bash","shell","html","css","json","java","go","rust","c","cpp","ruby","php","sql","yaml","markdown"];
function $(id){return document.getElementById(id)}
function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
function el(tag,cls,html){var e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e}
function rtP(arr){return (arr||[]).map(function(t){return t.plain_text||""}).join("")}
function rt(arr){return (arr||[]).map(function(t){var s=esc(t.plain_text||"");var a=t.annotations||{};if(a.code)s="<code>"+s+"</code>";if(a.bold)s="<b>"+s+"</b>";if(a.italic)s="<i>"+s+"</i>";if(a.strikethrough)s="<s>"+s+"</s>";if(t.href)s='<a href="'+esc(t.href)+'" target="_blank" style="color:var(--accent)">'+s+"</a>";return s}).join("")}
function accParam(){return "&acc="+($("acc").value||0)+($("turbo").checked?"&turbo=1":"")}

async function loadAccounts(){try{var r=await fetch("/api/accounts");var d=await r.json();var sel=$("acc");sel.innerHTML="";(d.accounts||[]).forEach(function(a){var o=el("option","",esc(a.name));o.value=a.index;sel.appendChild(o)});if(!d.accounts||d.accounts.length<2){$("turbowrap").style.display="none"}}catch(e){}}

async function doSearch(){var q=$("search").value;var r=await fetch("/api/search?q="+encodeURIComponent(q)+accParam());var d=await r.json();state.pages=d.results||[];renderList()}
function renderList(){var c=$("plist");c.innerHTML="";state.pages.forEach(function(p){var it=el("div","pitem"+(state.current===p.id?" active":""),esc(p.title));it.onclick=function(){openPage(p.id)};c.appendChild(it)})}

async function openPage(id){state.current=id;renderList();$("page").innerHTML='<p class="spin">Memuat...</p>';var r=await fetch("/api/page?id="+id+accParam());var d=await r.json();if(d.error){$("page").innerHTML='<p class="muted">'+esc(d.error)+"</p>";return}state.title=d.title;state.blocks=d.blocks||[];renderPage();updatePinBtn();renderPins()}

function renderPage(){var c=$("page");c.innerHTML="";c.appendChild(el("div","title",esc(state.title)));state.blocks.forEach(function(b){c.appendChild(renderBlock(b))})}

function renderBlock(b){var t=b.type;var data=b[t]||{};
  if(t==="code")return codeCard(b);
  var wrap=el("div","block");
  if(t==="paragraph")wrap.innerHTML="<p>"+rt(data.rich_text)+"</p>";
  else if(t==="heading_1")wrap.innerHTML="<h2>"+rt(data.rich_text)+"</h2>";
  else if(t==="heading_2")wrap.innerHTML="<h3>"+rt(data.rich_text)+"</h3>";
  else if(t==="heading_3")wrap.innerHTML="<h4>"+rt(data.rich_text)+"</h4>";
  else if(t==="bulleted_list_item")wrap.innerHTML='<div class="li">• '+rt(data.rich_text)+"</div>";
  else if(t==="numbered_list_item")wrap.innerHTML='<div class="li">– '+rt(data.rich_text)+"</div>";
  else if(t==="to_do")wrap.innerHTML='<div class="li"><input type=checkbox '+(data.checked?"checked":"")+" disabled> "+rt(data.rich_text)+"</div>";
  else if(t==="quote")wrap.innerHTML="<blockquote>"+rt(data.rich_text)+"</blockquote>";
  else if(t==="callout")wrap.innerHTML='<div class=callout><span>'+((data.icon&&data.icon.emoji)||"💡")+"</span><span>"+rt(data.rich_text)+"</span></div>";
  else if(t==="divider")wrap.innerHTML="<hr style='border-color:var(--border)'>";
  else if(t==="image"){var src=(data.file&&data.file.url)||(data.external&&data.external.url)||"";wrap.innerHTML='<img src="'+esc(src)+'" style="max-width:100%;border-radius:8px">'}
  else if(t==="child_page"){var btn=el("button","btn","📄 "+esc(data.title||"Sub-page"));btn.onclick=function(){openPage(b.id)};wrap.appendChild(btn)}
  else wrap.innerHTML='<span class=muted>['+t+"]</span>";
  if(b.children&&b.children.length){var box=el("div");box.style.marginLeft="16px";b.children.forEach(function(ch){box.appendChild(renderBlock(ch))});wrap.appendChild(box)}
  return wrap}

function codeCard(b){var lang=(b.code&&b.code.language)||"plain text";var text=rtP(b.code&&b.code.rich_text);
  var card=el("div","codecard");var head=el("div","codehead");
  var sel=el("select");LANGS.forEach(function(l){var o=el("option","",l);o.value=l;if(l===lang)o.selected=true;sel.appendChild(o)});
  head.appendChild(sel);head.appendChild(el("span","sp"));
  var copy=el("button","btn","Copy");var edit=el("button","btn","Edit");var save=el("button","btn accent","Simpan");save.style.display="none";var dl=el("button","btn","Download");
  head.appendChild(copy);head.appendChild(edit);head.appendChild(save);head.appendChild(dl);card.appendChild(head);
  var pre=el("pre");var code=el("code");code.textContent=text;pre.appendChild(code);card.appendChild(pre);
  var ta=el("textarea");ta.value=text;ta.style.display="none";card.appendChild(ta);
  try{code.className="language-"+lang;hljs.highlightElement(code)}catch(e){}
  copy.onclick=function(){navigator.clipboard