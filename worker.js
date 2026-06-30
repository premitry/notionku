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
    throw new Error("Belum ada token Notion. Buka Pengaturan (gear) di web buat nambahin, atau set NOTION_TOKENS.");
  return uniq;
}

async function resolveTokens(env, acc, turbo) {
  const all = await getTokens(env);
  if (turbo || acc === "auto") return all;
  const i = parseInt(acc || "0", 10) || 0;
  return [all[i] || all[0]];
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

async function notionMulti(env, endpoint, init, tokens) {
  let lastErr;
  for (let t = 0; t < tokens.length; t++) {
    try {
      return await notion(env, endpoint, init, tokens[t]);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Semua token gagal");
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
  const acc = u.searchParams.get("acc");
  const all = await getTokens(env);
  const body = JSON.stringify({
    query: q,
    page_size: 50,
    filter: { property: "object", value: "page" },
    sort: { direction: "descending", timestamp: "last_edited_time" },
  });
  let raw = [];
  if (acc === "auto" && all.length > 1) {
    const lists = await Promise.all(
      all.map((t) =>
        notion(env, "/search", { method: "POST", body }, t)
          .then((d) => d.results || [])
          .catch(() => [])
      )
    );
    const seen = {};
    lists.forEach((arr) =>
      arr.forEach((p) => {
        if (!seen[p.id]) {
          seen[p.id] = 1;
          raw.push(p);
        }
      })
    );
    raw.sort((a, b) => new Date(b.last_edited_time) - new Date(a.last_edited_time));
  } else {
    const i = parseInt(acc || "0", 10) || 0;
    const d = await notionMulti(env, "/search", { method: "POST", body }, [all[i] || all[0]]);
    raw = d.results || [];
  }
  const results = raw.slice(0, 80).map((p) => ({
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
    const start = ref.i % tokens.length;
    ref.i++;
    const order = tokens.slice(start).concat(tokens.slice(0, start));
    const qs = cursor
      ? "?start_cursor=" + cursor + "&page_size=100"
      : "?page_size=100";
    const data = await notionMulti(env, "/blocks/" + blockId + "/children" + qs, {}, order);
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
  const turbo = u.searchParams.get("turbo") === "1";
  const tokens = await resolveTokens(env, u.searchParams.get("acc"), turbo);
  const ref = { i: 0 };
  const page = await notionMulti(env, "/pages/" + id, {}, tokens);
  const blocks = await fetchBlocks(env, id, tokens, ref);
  return json({ id, title: pageTitle(page), blocks });
}

async function apiUpdateBlock(request, env) {
  const body = await request.json();
  const tokens = await resolveTokens(env, body.acc, false);
  const type = body.type || "code";
  const payload = {};
  payload[type] = { rich_text: [{ type: "text", text: { content: body.text || "" } }] };
  if (type === "code" && body.language) payload[type].language = body.language;
  const data = await notionMulti(
    env,
    "/blocks/" + body.id,
    { method: "PATCH", body: JSON.stringify(payload) },
    tokens
  );
  return json({ ok: true, block: data });
}

async function apiAppend(request, env) {
  const body = await request.json();
  const tokens = await resolveTokens(env, body.acc, false);
  const data = await notionMulti(
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
    tokens
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

async function apiModels(request, env) {
  const cfg = await getConfig(env);
  const key = cfg.openai_key || env.OPENAI_API_KEY;
  if (!key) {
    return json({
      models: [
        "@cf/meta/llama-3.1-8b-instruct",
        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        "@cf/qwen/qwen2.5-coder-32b-instruct",
        "@cf/deepseek-ai/deepseek-coder-6.7b-instruct-awq",
      ],
      source: "workers-ai",
    });
  }
  const base = cfg.openai_base || env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  try {
    const res = await fetch(base + "/models", { headers: { Authorization: "Bearer " + key } });
    if (!res.ok) return json({ models: [], error: "HTTP " + res.status });
    const d = await res.json();
    const arr = d.data || d.models || [];
    const models = arr
      .map((m) => (typeof m === "string" ? m : m.id || m.name))
      .filter(Boolean)
      .sort();
    return json({ models });
  } catch (e) {
    return json({ models: [], error: String((e && e.message) || e) });
  }
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
  let title = (body.title || "").slice(0, 80);
  if (!title && body.id) {
    const prev = await env.CHAT.get("session:" + body.id, "json");
    if (prev && prev.title) title = prev.title;
  }
  if (!title) title = "Chat baru";
  const updated = Date.now();
  const sess = { id, title, updated, messages: body.messages || [] };
  await env.CHAT.put("session:" + id, JSON.stringify(sess));
  let index = await readIndex(env);
  index = index.filter((s) => s.id !== id);
  index.push({ id, title, updated });
  await env.CHAT.put("index", JSON.stringify(index));
  return json({ ok: true, id, title, updated });
}

async function apiHistoryRename(request, env) {
  if (!env.CHAT) return json({ error: "KV binding CHAT belum di-set" }, 400);
  const body = await request.json();
  const title = (body.title || "Chat").slice(0, 80);
  const sess = await env.CHAT.get("session:" + body.id, "json");
  if (sess) {
    sess.title = title;
    await env.CHAT.put("session:" + body.id, JSON.stringify(sess));
  }
  let index = await readIndex(env);
  index = index.map((s) => (s.id === body.id ? { id: s.id, title: title, updated: s.updated } : s));
  await env.CHAT.put("index", JSON.stringify(index));
  return json({ ok: true });
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
<title>Notion Coding</title>
<script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github-dark.min.css">
<script src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js"></script>
<style>
:root{--bg:#212121;--side:#171717;--panel2:#2a2a2a;--border:#3a3a3a;--text:#ececec;--muted:#9b9b9b;--accent:#10a37f;--userbub:#2f2f2f}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);display:flex;overflow:hidden}
body.light{--bg:#ffffff;--side:#f9f9f9;--panel2:#f0f0f0;--border:#e3e3e3;--text:#1f1f1f;--muted:#6b6b6b;--userbub:#eef0f2}
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
.msg .body{min-width:0;max-width:100%}
.msg.user .body{background:var(--userbub);border-radius:16px;padding:8px 14px}
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
.codehead select{width:auto;margin:0;padding:3px 6px;font-size:11px}
mark.find{background:#e7b94e;color:#000;border-radius:2px}
#backdrop{display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:30}
#setmodal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:50;align-items:center;justify-content:center}
.modalcard{background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:20px;width:min(520px,92vw);max-height:88vh;overflow:auto}
.field{margin-bottom:8px}
.lbl{font-size:11px;color:var(--muted);margin-bottom:3px;display:block}
.muted{color:var(--muted)}
.row{display:flex;gap:8px;align-items:center}
#toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#000;color:#fff;padding:10px 16px;border-radius:10px;font-size:13px;z-index:90;opacity:0;pointer-events:none;transition:opacity .2s;max-width:90vw;border:1px solid var(--border)}
#toast.show{opacity:1}
#toast.err{background:#3a1212;border-color:#7a2a2a;color:#ffd5d5}
@media(max-width:900px){.center{width:100%}#histbar{position:fixed;z-index:40;left:0;top:0}#notionbar{position:fixed;z-index:40;right:0;top:0;width:88vw;flex-basis:88vw}}
</style></head>
<body>
<div id="backdrop"></div>
<aside id="histbar">
  <div class="histtop"><span class="brand">🧑‍💻 Notion Coding</span></div>
  <button class="newbtn" id="newchat">＋  Chat baru</button>
  <div id="histlist"></div>
</aside>
<main class="center">
  <header class="topbar">
    <button class="iconbtn" id="togghist" title="Riwayat">☰</button>
    <div class="ttl">Asisten Coding</div>
    <span style="flex:1"></span>
    <input id="model" list="modellist" placeholder="model (default)" title="Model AI"/>
    <datalist id="modellist"></datalist>
    <button class="iconbtn" id="membtn" title="Memori AI">🧠</button>
    <button class="iconbtn" id="toggnotion" title="Panel Notion">📄</button>
    <button class="iconbtn" id="settings" title="Pengaturan">⚙️</button>
    <button class="iconbtn" id="theme" title="Tema">🌗</button>
  </header>
  <div id="msgs" class="msgs"></div>
  <div class="composer">
    <div id="attbar" class="attbar"></div>
    <div class="inputwrap">
      <textarea id="chatin" rows="1" placeholder="Tanya apa aja soal koding... (bisa lampirin file/zip/foto)"></textarea>
      <button class="sendbtn" id="send" title="Kirim">↑</button>
    </div>
    <input type="file" id="fileinput" multiple style="display:none"/>
    <div class="compfoot">
      <button class="iconbtn" id="attach">📎 Lampirkan</button>
      <label class="row"><input type="checkbox" id="ctx" checked/> Sertakan kode halaman aktif</label>
    </div>
  </div>
</main>
<aside id="notionbar">
  <div class="nhead"><b>📄 Notion</b><span style="flex:1"></span><button class="iconbtn" id="closenotion" title="Tutup">✕</button></div>
  <div class="npad">
    <select id="acc"></select>
    <label id="turbowrap" class="row muted" style="font-size:12px;margin-bottom:8px;display:none"><input type="checkbox" id="turbo"/> Turbo (paralel multi-token)</label>
    <input id="search" class="search" placeholder="Cari halaman..."/>
    <div id="pins" class="plist" style="display:none"></div>
    <div id="plist" class="plist"></div>
    <div class="ntoolbar">
      <button class="btn" id="refresh">↻</button>
      <button class="btn" id="zip">Export ZIP</button>
      <button class="btn" id="addcode">+ Code</button>
      <button class="btn" id="pinbtn">📌 Pin</button>
    </div>
    <input id="find" class="search" placeholder="🔎 Cari di halaman..."/>
    <div id="page"><p class="muted">Pilih halaman buat dibuka.</p></div>
  </div>
</aside>
<div id="setmodal">
  <div class="modalcard">
    <h2 style="margin:0 0 4px;font-size:18px">⚙️ Pengaturan</h2>
    <p class="muted" style="margin:0 0 14px;font-size:12px">Semua disimpan di Cloudflare KV. Deploy worker sekali via CMD, sisanya atur di sini.</p>
    <div class="field"><span class="lbl">Notion Integration Tokens (satu per baris)</span><textarea id="settokens" class="set" rows="4" placeholder="ntn_xxx&#10;ntn_yyy"></textarea><span id="settokinfo" class="muted" style="font-size:11px"></span></div>
    <div class="field"><span class="lbl">OpenAI API Key</span><input id="setkey" class="search" type="password" placeholder="sk-..."/></div>
    <div class="field"><span class="lbl">OpenAI Base URL (opsional)</span><input id="setbase" class="search" placeholder="https://api.openai.com/v1"/></div>
    <div class="field"><span class="lbl">Default Model (opsional)</span><input id="setmodel" class="search" placeholder="gpt-4o-mini"/></div>
    <div class="field"><span class="lbl">Workers AI Model (opsional)</span><input id="setai" class="search" placeholder="@cf/meta/llama-3.1-8b-instruct"/></div>
    <div id="setmsg" class="muted" style="font-size:12px;min-height: