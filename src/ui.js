import { CLIENT_JS } from "./client.js";
import { FEATURES_JS } from "./features.js";

const SHELL_HEAD = `<!DOCTYPE html>
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
.msgact{display:flex;gap:14px;margin-top:6px;flex-wrap:wrap}
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
.codehead .sp{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.codecard pre{margin:0;padding:12px;overflow:auto;font-size:12.5px}
.codecard textarea{width:100%;border:none;background:none;color:var(--text);min-height:300px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;padding:12px;resize:vertical;outline:none}
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
<header class="topbar"><button class="iconbtn" id="togghist" title="Riwayat">☰</button><div class="ttl">Asisten Coding</div><span style="flex:1"></span><input id="model" list="modellist" placeholder="model (default)"/><datalist id="modellist"></datalist><button class="iconbtn" id="membtn" title="Memori">🧠</button><button class="iconbtn" id="toggnotion" title="Panel Notion / GitHub">📄</button><button class="iconbtn" id="settings" title="Pengaturan">⚙️</button><button class="iconbtn" id="theme" title="Tema">🌗</button></header>
<div id="msgs" class="msgs"></div>
<div class="composer"><div id="attbar" class="attbar"></div><div class="inputwrap"><textarea id="chatin" rows="1" placeholder="Tanya apa aja soal koding..."></textarea><button class="sendbtn" id="send" title="Kirim">↑</button></div><input type="file" id="fileinput" multiple style="display:none"/><div class="compfoot"><button class="iconbtn" id="attach">📎 Lampirkan</button><label class="row"><input type="checkbox" id="ctx" checked/> Pakai konteks Notion</label><span id="ctxinfo" class="muted"></span></div></div>
</main>
<aside id="notionbar"><div class="nhead"><b>📄 Notion / 💻 GitHub</b><span style="flex:1"></span><button class="iconbtn" id="closenotion">✕</button></div><div class="npad"><select id="acc"></select><label id="turbowrap" class="row muted" style="font-size:12px;margin-bottom:8px;display:none"><input type="checkbox" id="turbo"/> Turbo (paralel)</label><input id="search" class="search" placeholder="Cari halaman..."/><div id="pins" class="plist" style="display:none"></div><div id="plist" class="plist"></div><div class="ntoolbar"><button class="btn" id="refresh">↻</button><button class="btn" id="addctx">➕ Konteks</button><button class="btn" id="ghbtn">💻 GitHub</button><button class="btn" id="zip">ZIP</button><button class="btn" id="addcode">+ Code</button><button class="btn" id="pinbtn">📌 Pin</button></div><input id="find" class="search" placeholder="🔎 Cari di halaman..."/><div id="page"><p class="muted">Pilih halaman buat dibuka, atau klik 💻 GitHub.</p></div></div></aside>
<div id="setmodal"><div class="modalcard"><h2 style="margin:0 0 4px;font-size:18px">⚙️ Pengaturan</h2><p class="muted" style="margin:0 0 14px;font-size:12px">Semua disimpan di Cloudflare KV.</p><div class="field"><span class="lbl">Notion Tokens (satu per baris)</span><textarea id="settokens" class="set" rows="4" placeholder="ntn_xxx"></textarea><span id="settokinfo" class="muted" style="font-size:11px"></span></div><div class="field"><span class="lbl">OpenAI API Key</span><input id="setkey" class="search" type="password" placeholder="sk-..."/></div><div class="field"><span class="lbl">OpenAI Base URL (opsional)</span><input id="setbase" class="search" placeholder="https://api.openai.com/v1"/></div><div class="field"><span class="lbl">Default Model (opsional)</span><input id="setmodel" class="search" placeholder="gpt-4o-mini"/></div><div class="field"><span class="lbl">Workers AI Model (opsional)</span><input id="setai" class="search" placeholder="@cf/meta/llama-3.1-8b-instruct"/></div><div class="field"><span class="lbl">GitHub Token (scope: repo)</span><input id="setgh" class="search" type="password" placeholder="ghp_..."/></div><div class="field"><span class="lbl">GitHub owner / repo / branch</span><div class="row"><input id="setghowner" class="search" placeholder="owner" style="margin:0"/><input id="setghrepo" class="search" placeholder="repo" style="margin:0"/><input id="setghbranch" class="search" placeholder="main" style="margin:0;max-width:90px"/></div></div><div class="field"><span class="lbl">Backup data (chat + memori)</span><div class="row"><button class="btn" id="setexport">⬇️ Export JSON</button><button class="btn" id="setimport">⬆️ Import JSON</button><input type="file" id="impfile" accept="application/json" style="display:none"/></div></div><div id="setmsg" class="muted" style="font-size:12px;min-height:16px"></div><div class="row" style="margin-top:10px;justify-content:flex-end"><button class="btn" id="setclose">Tutup</button><button class="btn accent" id="setsave">Simpan</button></div></div></div>
<div id="toast"></div>
`;
const SCRIPT_OPEN = `<script>
`;
const TAIL = `
<\/script>
</body></html>`;

export const PAGE_HTML = SHELL_HEAD + SCRIPT_OPEN + CLIENT_JS + "\n</script>\n<script>\n" + FEATURES_JS + TAIL;
