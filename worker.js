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

function getTokens(env) {
  const set = [];
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
    throw new Error("Belum ada NOTION_TOKENS / NOTION_TOKEN_1 / NOTION_TOKEN");
  return uniq;
}

function pickToken(env, acc) {
  const tokens = getTokens(env);
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
  const tokens = getTokens(env);
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
  const token = pickToken(env, u.searchParams.get("acc"));
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
  const allTokens = getTokens(env);
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
  const token = pickToken(env, body.acc);
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
  const token = pickToken(env, body.acc);
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
  if (!env.OPENAI_API_KEY && env.AI) {
    const stream = await env.AI.run(body.model || env.AI_MODEL || "@cf/meta/llama-3.1-8b-instruct", {
      messages,
      stream: true,
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    });
  }
  if (!env.OPENAI_API_KEY)
    return json({ error: "OPENAI_API_KEY / binding AI belum di-set" }, 400);
  const base = env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = body.model || env.OPENAI_MODEL || "gpt-4o-mini";
  const res = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.OPENAI_API_KEY,
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
    <h1 class="brand">🧑‍💻 Notion Coding<span style="flex:1"></span><button class="btn" id="theme" title="Tema">🌗</button></h1>
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
  copy.onclick=function(){navigator.clipboard.writeText(ta.value);copy.textContent="Tersalin!";setTimeout(function(){copy.textContent="Copy"},1200)};
  edit.onclick=function(){pre.style.display="none";ta.style.display="block";save.style.display="inline-flex";edit.style.display="none"};
  dl.onclick=function(){var ext=EXT[sel.value]||"txt";downloadFile("snippet."+ext,ta.value)};
  save.onclick=async function(){save.textContent="...";var r=await fetch("/api/block",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:b.id,type:"code",text:ta.value,language:sel.value,acc:$("acc").value})});var d=await r.json();save.textContent="Simpan";if(d.ok){b.code.rich_text=[{plain_text:ta.value}];b.code.language=sel.value;code.textContent=ta.value;code.className="language-"+sel.value;code.removeAttribute("data-highlighted");try{hljs.highlightElement(code)}catch(e){}pre.style.display="block";ta.style.display="none";save.style.display="none";edit.style.display="inline-flex"}else{alert(d.error||"Gagal simpan")}};
  return card}

function collectCode(){var out=[];function walk(arr){(arr||[]).forEach(function(b){if(b.type==="code")out.push({language:(b.code&&b.code.language)||"plain text",text:rtP(b.code&&b.code.rich_text)});if(b.children)walk(b.children)})}walk(state.blocks);return out}
function downloadFile(name,content){var blob=new Blob([content],{type:"text/plain"});var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(function(){URL.revokeObjectURL(a.href)},2000)}
async function exportZip(){var codes=collectCode();if(!codes.length){alert("Nggak ada code block di halaman ini");return}var zip=new JSZip();var n={};codes.forEach(function(c){var ext=EXT[c.language]||"txt";var base="snippet";n[ext]=(n[ext]||0)+1;zip.file(base+"-"+n[ext]+"."+ext,c.text)});var blob=await zip.generateAsync({type:"blob"});var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=(state.title||"notion-code")+".zip";a.click()}
async function addCode(){if(!state.current){alert("Buka halaman dulu");return}var r=await fetch("/api/append",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pageId:state.current,language:"javascript",text:"// kode baru",acc:$("acc").value})});var d=await r.json();if(d.ok)openPage(state.current);else alert(d.error||"Gagal")}

async function loadHistory(){try{var r=await fetch("/api/history");var d=await r.json();var sel=$("histsel");if(!sel)return;sel.innerHTML="";var o0=el("option","","— Riwayat chat —");o0.value="";sel.appendChild(o0);(d.sessions||[]).forEach(function(s){var o=el("option","",esc(s.title));o.value=s.id;sel.appendChild(o)});if(state.chatId)sel.value=state.chatId}catch(e){}}
async function openChat(id){if(!id){newChat();return}try{var r=await fetch("/api/history?id="+encodeURIComponent(id));var d=await r.json();if(d.error){alert(d.error);return}state.chatId=d.id;state.chat=d.messages||[];if($("histsel"))$("histsel").value=d.id;history.pushState({},"","/chat/"+encodeURIComponent(d.id));renderChat()}catch(e){}}
function newChat(){state.chat=[];state.chatId=null;if($("histsel"))$("histsel").value="";history.pushState({},"","/");renderChat()}
async function saveHistory(){try{if(!state.chat.length)return;var fu=state.chat.filter(function(m){return m.role==="user"})[0];var title=fu?fu.content.slice(0,60):"Chat baru";var r=await fetch("/api/history/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:state.chatId,title:title,messages:state.chat})});var d=await r.json();if(d.ok&&d.id){var isNew=state.chatId!==d.id;state.chatId=d.id;if(isNew)history.replaceState({},"","/chat/"+encodeURIComponent(d.id));loadHistory()}}catch(e){}}
async function delChat(){if(!state.chatId){newChat();return}if(!confirm("Hapus chat ini?"))return;try{await fetch("/api/history/delete",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:state.chatId})})}catch(e){}newChat();loadHistory()}
function extOf(n){var p=String(n).split(".");return p.length>1?p.pop().toLowerCase():""}
function isImgType(t){return String(t).indexOf("image/")===0}
var TEXTEXT=["js","ts","jsx","tsx","py","java","go","rs","c","cpp","h","css","html","md","txt","json","yml","yaml","sh","sql","rb","php","xml","csv"];
var IMGEXT={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",svg:"image/svg+xml"};
function readFileObj(file){return new Promise(function(res){var ext=extOf(file.name);var img=isImgType(file.type)||IMGEXT[ext];var isText=String(file.type).indexOf("text/")===0||TEXTEXT.indexOf(ext)>=0;var fr=new FileReader();if(img){fr.onload=function(){res({name:file.name,type:file.type||IMGEXT[ext]||"image/png",size:file.size,dataUrl:fr.result})};fr.readAsDataURL(file)}else if(isText){fr.onload=function(){res({name:file.name,type:"text/plain",size:file.size,text:String(fr.result).slice(0,20000)})};fr.readAsText(file)}else{res({name:file.name,type:file.type,size:file.size})}})}
async function handleZip(file){var out=[];try{var zip=await JSZip.loadAsync(file);var names=Object.keys(zip.files);for(var i=0;i<names.length;i++){var entry=zip.files[names[i]];if(entry.dir)continue;var ext=extOf(entry.name);if(IMGEXT[ext]){var b64=await entry.async("base64");out.push({name:entry.name,type:IMGEXT[ext],dataUrl:"data:"+IMGEXT[ext]+";base64,"+b64})}else{var txt=await entry.async("string");out.push({name:entry.name,type:"text/plain",text:String(txt).slice(0,20000)})}}}catch(e){out.push({name:file.name,type:file.type,size:file.size})}return out}
async function addFiles(list){for(var i=0;i<list.length;i++){var f=list[i];if(extOf(f.name)==="zip"||String(f.type).indexOf("zip")>=0){var items=await handleZip(f);items.forEach(function(it){pending.push(it)})}else{var obj=await readFileObj(f);pending.push(obj)}}renderAttbar()}
function renderAttbar(){var bar=$("attbar");if(!bar)return;bar.innerHTML="";pending.forEach(function(f,idx){var chip=el("div","att");var ic=(f.dataUrl&&isImgType(f.type))?"🖼️":((f.type&&f.type.indexOf("zip")>=0)?"🗜️":"📄");chip.appendChild(el("span","",ic+" "+esc(f.name)));var x=el("span","x","✕");x.onclick=function(){pending.splice(idx,1);renderAttbar()};chip.appendChild(x);bar.appendChild(chip)})}
function filesHtml(files){var h="";var imgs=(files||[]).filter(function(f){return f.dataUrl&&isImgType(f.type)});var others=(files||[]).filter(function(f){return !(f.dataUrl&&isImgType(f.type))});if(imgs.length){h+='<div class="thumbs">';imgs.forEach(function(f){h+='<img src="'+esc(f.dataUrl)+'" title="'+esc(f.name)+'"/>'});h+="</div>"}others.forEach(function(f){h+='<div class="filechip">📄 '+esc(f.name)+"</div>"});return h}
function collectCodeFromText(text){var parts=String(text).split(FENCE);var out=[];for(var i=1;i<parts.length;i+=2){var seg=parts[i];var nl=seg.indexOf("\n");var lang="plain text";var body=seg;if(nl>=0){var first=seg.slice(0,nl).trim();if(first)lang=first;body=seg.slice(nl+1)}out.push({language:lang,text:body})}return out}
async function zipFromText(text,name){var codes=collectCodeFromText(text);if(!codes.length){alert("Nggak ada code block di jawaban ini");return}var zip=new JSZip();var n={};codes.forEach(function(c){var ext=EXT[c.language]||"txt";n[ext]=(n[ext]||0)+1;zip.file("file-"+n[ext]+"."+ext,c.text)});var blob=await zip.generateAsync({type:"blob"});var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=(name||"ai-output")+".zip";a.click();setTimeout(function(){URL.revokeObjectURL(a.href)},2000)}
function isZipCmd(t){t=String(t).toLowerCase();return t.indexOf("zip")>=0&&(t.indexOf("semua")>=0||t.indexOf("satu")>=0||t.indexOf("gabung")>=0||t.indexOf("jadiin")>=0||t.indexOf("jadikan")>=0||t.indexOf("download")>=0||t.indexOf("unduh")>=0)}
async function zipAll(name){var codes=collectCode();state.chat.forEach(function(m){if(m.role==="assistant")collectCodeFromText(m.content).forEach(function(c){codes.push(c)})});if(!codes.length)return 0;var zip=new JSZip();var n={};codes.forEach(function(c){var ext=EXT[c.language]||"txt";n[ext]=(n[ext]||0)+1;zip.file("file-"+n[ext]+"."+ext,c.text)});var blob=await zip.generateAsync({type:"blob"});var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=(name||"semua-code")+".zip";a.click();setTimeout(function(){URL.revokeObjectURL(a.href)},2000);return codes.length}
function stripMemory(text){var idx=String(text).indexOf("::MEMORY::");if(idx<0)return {body:text,facts:[]};var rest=text.slice(idx+10).split("\n")[0];var facts=rest.split("||").map(function(s){return s.trim()}).filter(function(s){return s});return {body:text.slice(0,idx),facts:facts}}
async function loadMemory(){try{var r=await fetch("/api/memory");var d=await r.json();state.memory=d.facts||[]}catch(e){state.memory=[]}}
function saveMemory(facts){var cur=state.memory||[];facts.forEach(function(f){if(cur.indexOf(f)<0)cur.push(f)});cur=cur.slice(-50);state.memory=cur;try{fetch("/api/memory/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({facts:cur})})}catch(e){}}
function showMemory(){var facts=state.memory||[];if(!facts.length){alert("Belum ada memori. AI bakal otomatis nyatet fakta penting pas ngobrol.");return}if(confirm("Memori AI saat ini:\n\n- "+facts.join("\n- ")+"\n\nKlik OK buat HAPUS semua memori, Cancel buat tutup.")){state.memory=[];try{fetch("/api/memory/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({facts:[]})})}catch(e){}alert("Memori dihapus.")}}
function pushMsg(role,content,files){var m={role:role,content:content,files:files||[]};state.chat.push(m);renderChat();return m}
function mdInline(s){s=esc(s);s=s.replace(new RegExp(BT+"([^"+BT+"]+)"+BT,"g"),"<code>$1</code>");s=s.replace(/\*\*([^*]+)\*\*/g,"<b>$1</b>");s=s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g,'<a href="$2" target="_blank">$1</a>');return s}
function mdBlock(text){var lines=text.split("\n");var html="";var inUl=false,inOl=false;function cl(){if(inUl){html+="</ul>";inUl=false}if(inOl){html+="</ol>";inOl=false}}for(var i=0;i<lines.length;i++){var t=lines[i].trim();if(!t){cl();continue}var h=t.match(/^(#{1,4})\s+(.*)$/);if(h){cl();var lv=h[1].length+1;if(lv>4)lv=4;html+="<h"+lv+">"+mdInline(h[2])+"</h"+lv+">";continue}var ul=t.match(/^[-*]\s+(.*)$/);if(ul){if(!inUl){cl();html+="<ul>";inUl=true}html+="<li>"+mdInline(ul[1])+"</li>";continue}var ol=t.match(/^\d+\.\s+(.*)$/);if(ol){if(!inOl){cl();html+="<ol>";inOl=true}html+="<li>"+mdInline(ol[1])+"</li>";continue}cl();html+="<div>"+mdInline(t)+"</div>"}cl();return html}
function mdRender(text){var parts=String(text).split(FENCE);var out="";for(var i=0;i<parts.length;i++){if(i%2===1){var seg=parts[i];var nl=seg.indexOf("\n");var lang="";if(nl>=0){lang=seg.slice(0,nl).trim();seg=seg.slice(nl+1)}out+='<pre><code'+(lang?' class="language-'+lang+'"':"")+'>'+esc(seg)+"</code></pre>"}else{out+=mdBlock(parts[i])}}return out}
function parseOpts(text){var idx=String(text).indexOf("::OPTIONS::");if(idx<0)return {body:text,opts:[]};var body=text.slice(0,idx);var line=text.slice(idx+11).split("\n")[0];var opts=line.split("||").map(function(s){return s.trim()}).filter(function(s){return s}).slice(0,4);return {body:body,opts:opts}}
function renderChat(){var c=$("msgs");c.innerHTML="";state.chat.forEach(function(m,i){var d=el("div","msg "+m.role);d.appendChild(el("div","role",m.role==="user"?"Kamu":"AI"));if(editing===i){var ta=el("textarea");ta.value=m.content;ta.rows=3;d.appendChild(ta);var br=el("div","row");br.style.marginTop="6px";var sv=el("button","btn accent","Simpan & generate");var cn=el("button","btn","Batal");br.appendChild(sv);br.appendChild(cn);d.appendChild(br);sv.onclick=function(){saveEdit(i,ta.value)};cn.onclick=function(){editing=-1;renderChat()};c.appendChild(d);return}var pr=m.role==="assistant"?parseOpts(stripMemory(m.content).body):{body:m.content,opts:[]};if(pr.body.trim()||m.role==="assistant"){var bub=el("div","bubble",mdRender(pr.body));d.appendChild(bub);try{bub.querySelectorAll("pre code").forEach(function(cb){hljs.highlightElement(cb)})}catch(e){}}if(m.files&&m.files.length){var fh=el("div");fh.innerHTML=filesHtml(m.files);d.appendChild(fh)}if(pr.opts.length){var ob=el("div","opts");pr.opts.forEach(function(op){var chip=el("button","chip",esc(op));chip.onclick=function(){$("chatin").value=op;sendChat()};ob.appendChild(chip)});d.appendChild(ob)}var act=el("div","msgact");if(m.role==="user"){var eb=el("button","mini","✏️ Edit");eb.onclick=function(){editing=i;renderChat()};act.appendChild(eb)}if(m.role==="assistant"){if(collectCodeFromText(m.content).length){var zb=el("button","mini","📦 ZIP");zb.onclick=function(){zipFromText(m.content,"ai-output")};act.appendChild(zb)}if(i===state.chat.length-1){var rb=el("button","mini","🔄 Ulangi");rb.onclick=function(){regenerateFrom(i)};act.appendChild(rb)}}d.appendChild(act);c.appendChild(d)});c.scrollTop=c.scrollHeight}
async function sendChat(){var inp=$("chatin");var text=inp.value.trim();if(!text&&!pending.length)return;inp.value="";if(text&&!pending.length&&isZipCmd(text)){pushMsg("user",text);var cnt=await zipAll(state.title||"semua-code");pushMsg("assistant",cnt?("📦 Oke! "+cnt+" code block aku gabung jadi satu file ZIP dan udah ke-download ya."):"Hmm, aku nggak nemu code block di halaman ini atau di chat buat di-zip.");saveHistory();return}var files=pending;pending=[];renderAttbar();pushMsg("user",text,files);streamReply()}
function saveEdit(i,txt){txt=(txt||"").trim();if(!txt){editing=-1;renderChat();return}state.chat[i].content=txt;state.chat=state.chat.slice(0,i+1);editing=-1;renderChat();streamReply()}
function regenerateFrom(i){if(i<=0)return;state.chat=state.chat.slice(0,i);renderChat();streamReply()}
async function streamReply(){var msgs=state.chat.map(function(m){var txt=m.content;(m.files||[]).forEach(function(f){if(f.text)txt+="\n\n[File: "+f.name+"]\n"+f.text});var imgs=(m.files||[]).filter(function(f){return f.dataUrl&&isImgType(f.type)});if(imgs.length){var arr=[{type:"text",text:txt}];imgs.forEach(function(f){arr.push({type:"image_url",image_url:{url:f.dataUrl}})});return {role:m.role,content:arr}}return {role:m.role,content:txt}});if($("ctx").checked&&state.current){var code=collectCode().map(function(c){return "// "+c.language+"\n"+c.text}).join("\n\n");if(code)msgs.unshift({role:"system",content:"Kamu asisten coding berbahasa Indonesia. Konteks kode dari halaman Notion aktif:\n"+code.slice(0,8000)})}if(state.memory&&state.memory.length)msgs.unshift({role:"system",content:"Memori jangka panjang tentang user (selalu pertimbangkan):\n- "+state.memory.join("\n- ")});msgs.unshift({role:"system",content:"Kamu asisten coding berbahasa Indonesia. Kalau relevan, akhiri jawaban dengan SATU baris opsi pilihan biar user gampang milih, format persis: ::OPTIONS:: Pilihan A || Pilihan B || Pilihan C (maksimal 4 opsi, masing-masing singkat). Jangan pakai format ini kalau nggak perlu. Kalau kamu menangkap fakta/preferensi penting & tahan lama soal user (mis. bahasa/framework favorit, nama project, gaya koding), tambahin di baris TERPISAH paling akhir, format persis: ::MEMORY:: fakta1 || fakta2 (cuma fakta baru yang penting; jangan ulang yang udah diketahui; jangan tampilin kalau nggak ada)."});var asst=pushMsg("assistant","");var ctrl=new AbortController();window.__ctrl=ctrl;$("send").textContent="Stop";try{var res=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:msgs,model:($("model").value||"").trim()||undefined}),signal:ctrl.signal});if(!res.ok||!res.body){var er=await res.json().catch(function(){return{}});asst.content="[Error] "+(er.error||res.status);renderChat();return}var reader=res.body.getReader();var dec=new TextDecoder();var buf="";var acc="";while(true){var rr=await reader.read();if(rr.done)break;buf+=dec.decode(rr.value,{stream:true});var lines=buf.split("\n");buf=lines.pop();for(var i=0;i<lines.length;i++){var line=lines[i].trim();if(!line||line.indexOf("data:")!==0)continue;var payload=line.slice(5).trim();if(payload==="[DONE]")continue;try{var j=JSON.parse(payload);var delta=(j.choices&&j.choices[0]&&j.choices[0].delta&&j.choices[0].delta.content)||j.response||"";if(delta){acc+=delta;asst.content=acc;renderChat()}}catch(e){}}}}catch(e){if(e.name!=="AbortError"){asst.content="[Error] "+e.message;renderChat()}}finally{window.__ctrl=null;$("send").textContent="Kirim";var sm=stripMemory(asst.content);asst.content=sm.body;if(sm.facts.length)saveMemory(sm.facts);renderChat();saveHistory()}}

function getPins(){try{return JSON.parse(localStorage.getItem("pins")||"[]")}catch(e){return[]}}
function setPins(p){localStorage.setItem("pins",JSON.stringify(p))}
function isPinned(id){return getPins().some(function(p){return p.id===id})}
function renderPins(){var box=$("pins");if(!box)return;var pins=getPins();box.innerHTML="";if(!pins.length){box.style.display="none";return}box.style.display="block";pins.forEach(function(p){var it=el("div","pitem"+(state.current===p.id?" active":""),"📌 "+esc(p.title));it.onclick=function(){openPage(p.id)};box.appendChild(it)})}
function updatePinBtn(){var b=$("pinbtn");if(b)b.textContent=isPinned(state.current)?"📌 Unpin":"📌 Pin"}
function togglePin(){if(!state.current)return;var pins=getPins();if(isPinned(state.current)){pins=pins.filter(function(p){return p.id!==state.current})}else{pins.push({id:state.current,title:state.title})}setPins(pins);renderPins();updatePinBtn()}
function applyTheme(){if((localStorage.getItem("theme")||"dark")==="light")document.body.classList.add("light");else document.body.classList.remove("light")}
function toggleTheme(){localStorage.setItem("theme",(localStorage.getItem("theme")==="light")?"dark":"light");applyTheme()}
function hiText(text,term){var lo=text.toLowerCase(),t=term.toLowerCase(),out="",i=0,idx;while((idx=lo.indexOf(t,i))>=0){out+=esc(text.slice(i,idx))+'<mark class="find">'+esc(text.slice(idx,idx+term.length))+"</mark>";i=idx+term.length}out+=esc(text.slice(i));return out}
function findInPage(term){if(!state.blocks.length)return;renderPage();if(!term)return;var page=$("page");var walker=document.createTreeWalker(page,NodeFilter.SHOW_TEXT,null);var nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);var t=term.toLowerCase(),first=null;nodes.forEach(function(n){var v=n.nodeValue;if(v&&v.toLowerCase().indexOf(t)>=0){var span=document.createElement("span");span.innerHTML=hiText(v,term);n.parentNode.replaceChild(span,n);if(!first)first=span.querySelector("mark")}});if(first)first.scrollIntoView({block:"center"})}
$("search").addEventListener("input",function(){clearTimeout(window.__st);window.__st=setTimeout(doSearch,300)});
$("acc").addEventListener("change",doSearch);
$("refresh").onclick=function(){if(state.current)openPage(state.current);else doSearch()};
$("zip").onclick=exportZip;
$("addcode").onclick=addCode;
$("send").onclick=function(){if(window.__ctrl){window.__ctrl.abort()}else{sendChat()}};
$("clear").onclick=function(){state.chat=[];pending=[];renderAttbar();renderChat()};
$("histsel").addEventListener("change",function(){openChat(this.value)});
$("newchat").onclick=newChat;
$("delchat").onclick=delChat;
$("membtn").onclick=showMemory;
$("pinbtn").onclick=togglePin;
$("theme").onclick=toggleTheme;
$("find").addEventListener("input",function(){var v=this.value.trim();clearTimeout(window.__ft);window.__ft=setTimeout(function(){findInPage(v)},250)});
applyTheme();renderPins();
$("chatin").addEventListener("keydown",function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendChat()}});
$("attach").onclick=function(){$("fileinput").click()};
$("fileinput").addEventListener("change",function(){if(this.files&&this.files.length)addFiles(this.files);this.value=""});
$("chatin").addEventListener("paste",function(e){var items=(e.clipboardData&&e.clipboardData.items)||[];var fs=[];for(var i=0;i<items.length;i++){if(items[i].kind==="file"){var f=items[i].getAsFile();if(f)fs.push(f)}}if(fs.length){e.preventDefault();addFiles(fs)}});
loadAccounts().then(doSearch);
loadHistory();
loadMemory();
function routeFromUrl(){var m=location.pathname.match(/^\/chat\/(.+)$/);if(m){var id=decodeURIComponent(m[1]);fetch("/api/history?id="+encodeURIComponent(id)).then(function(r){return r.json()}).then(function(d){if(d&&!d.error){state.chatId=d.id;state.chat=d.messages||[];if($("histsel"))$("histsel").value=d.id;renderChat()}})}}
window.addEventListener("popstate",routeFromUrl);
routeFromUrl();
</script>
</body></html>`;
