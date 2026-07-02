// Fitur tambahan (client-side). Diserialisasi via toString() supaya escape aman.
function __featuresMain(){
  var LS = window.localStorage;
  function gv(k,d){ try{ var v=LS.getItem(k); return v==null?d:v; }catch(e){ return d; } }
  function sv(k,v){ try{ LS.setItem(k,v); }catch(e){} }
  function $id(i){ return document.getElementById(i); }
  function mkEl(t,c,h){ var e=document.createElement(t); if(c)e.className=c; if(h!=null)e.innerHTML=h; return e; }
  function fmt(n){ n=Math.round(n||0); return String(n).replace(/\B(?=(\d{3})+(?!\d))/g,"."); }
  function money(x){ x=x||0; return "$"+(x<1?x.toFixed(4):x.toFixed(2)); }
  function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  // ---------- styles ----------
  var css = ""
    + "#fx-dash{display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:60;align-items:center;justify-content:center}"
    + "#fx-dash .modalcard{width:min(680px,94vw)}"
    + ".fx-cards{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}"
    + ".fx-card{flex:1;min-width:110px;background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:10px}"
    + ".fx-card .n{font-size:20px;font-weight:700}"
    + ".fx-card .l{font-size:11px;color:var(--muted)}"
    + ".fx-bars{display:flex;align-items:flex-end;gap:3px;height:84px;margin:6px 0 14px}"
    + ".fx-bar{flex:1;background:var(--accent);border-radius:3px 3px 0 0;min-height:2px;opacity:.85}"
    + "table.fx-t{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:6px}"
    + "table.fx-t th,table.fx-t td{text-align:left;padding:4px 6px;border-bottom:1px solid var(--border);white-space:nowrap}"
    + ".fx-foot{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px}"
    + "#fx-drop{display:none;position:fixed;inset:14px;z-index:80;background:rgba(16,163,127,.12);border:3px dashed var(--accent);border-radius:16px;align-items:center;justify-content:center;font-size:20px;color:var(--text);pointer-events:none}"
    + "#fx-drop.show{display:flex}";
  var stEl = document.createElement("style"); stEl.textContent = css; document.head.appendChild(stEl);

  var tempBtn;

  // ---------- custom instructions ----------
  try{
    var card = document.querySelector("#setmodal .modalcard");
    if(card){
      var rows = card.querySelectorAll(".row");
      var btnRow = rows[rows.length-1];
      var f = mkEl("div","field");
      f.innerHTML = '<span class="lbl">\uD83E\uDDE0 Instruksi khusus (custom instructions)</span>';
      var cta = document.createElement("textarea");
      cta.className="set"; cta.rows=3;
      cta.placeholder="mis. Selalu jawab ringkas dalam bahasa Indonesia, pakai TypeScript, sertakan komentar.";
      cta.value = gv("custom_instructions","");
      cta.addEventListener("input", function(){ sv("custom_instructions", cta.value); });
      f.appendChild(cta);
      card.insertBefore(f, btnRow);
    }
  }catch(e){}
  if(typeof buildContext==="function"){
    var _bc = buildContext;
    buildContext = function(){
      var base = _bc();
      var ci = gv("custom_instructions","");
      if(ci && ci.trim()) base = base + "\n\nInstruksi khusus dari pengguna (prioritaskan ini):\n" + ci.trim();
      return base;
    };
  }

  // ---------- temporary chat ----------
  if(typeof saveHistory==="function"){
    var _sh = saveHistory;
    saveHistory = async function(){ if(window.__temp) return; return _sh.apply(this, arguments); };
  }
  function toggleTemp(){
    window.__temp = !window.__temp;
    if(tempBtn){ tempBtn.style.opacity = window.__temp ? "1" : ".55"; tempBtn.title = window.__temp ? "Chat sementara: ON (tidak disimpan)" : "Chat sementara: OFF"; }
    if(typeof newChat==="function") newChat();
    toast(window.__temp ? "\uD83D\uDC7B Chat sementara aktif \u2014 tidak akan disimpan" : "Chat sementara dimatikan");
  }

  // ---------- continue ----------
  function continueResp(){
    if(window.__ctrl){ toast("Masih mengetik, tunggu dulu ya", true); return; }
    if(!state.chat.length){ toast("Belum ada percakapan", true); return; }
    var last = state.chat[state.chat.length-1];
    if(!last || last.role!=="assistant"){ toast("Belum ada jawaban untuk dilanjutkan", true); return; }
    pushMsg("user","Lanjutkan jawaban sebelumnya persis dari tempat terakhir berhenti, tanpa mengulang bagian yang sudah ditulis.");
    renderChat(); streamReply();
  }

  // ---------- branch ----------
  function branchChat(){
    if(!state.chat.length){ toast("Belum ada yang bisa dicabang", true); return; }
    state.chatId = null;
    toast("\uD83C\uDF3F Cabang baru dibuat \u2014 chat lama tetap tersimpan.");
    saveHistory();
    if(typeof renderHistory==="function") renderHistory();
  }

  // ---------- drag & drop ----------
  var drop = mkEl("div"); drop.id="fx-drop"; drop.textContent="\uD83D\uDCE5 Lepas file di sini untuk dilampirkan"; document.body.appendChild(drop);
  var dragDepth = 0;
  window.addEventListener("dragover", function(e){ e.preventDefault(); });
  window.addEventListener("dragenter", function(e){ e.preventDefault(); dragDepth++; drop.classList.add("show"); });
  window.addEventListener("dragleave", function(e){ dragDepth--; if(dragDepth<=0){ dragDepth=0; drop.classList.remove("show"); } });
  window.addEventListener("drop", function(e){ e.preventDefault(); dragDepth=0; drop.classList.remove("show"); var fl=e.dataTransfer&&e.dataTransfer.files; if(fl&&fl.length&&typeof addFiles==="function") addFiles(fl); });

  // ---------- image compression ----------
  if(typeof readFileObj==="function"){
    var _rfo = readFileObj;
    readFileObj = function(file){
      return Promise.resolve(_rfo(file)).then(function(obj){
        if(obj && obj.kind==="image" && obj.dataUrl && obj.dataUrl.indexOf("image/svg")<0) return compressImg(obj);
        return obj;
      });
    };
  }
  function compressImg(obj){
    return new Promise(function(res){
      try{
        var img = new Image();
        img.onload = function(){
          try{
            var max=1280, w=img.width, h=img.height, s=Math.min(1, max/Math.max(w,h));
            var nw=Math.max(1,Math.round(w*s)), nh=Math.max(1,Math.round(h*s));
            var cv=document.createElement("canvas"); cv.width=nw; cv.height=nh;
            cv.getContext("2d").drawImage(img,0,0,nw,nh);
            var out=cv.toDataURL("image/jpeg",0.82);
            if(out && out.length < obj.dataUrl.length){ obj.dataUrl=out; obj.name=String(obj.name).replace(/\.(png|bmp|webp|gif)$/i,".jpg"); }
          }catch(e){}
          res(obj);
        };
        img.onerror = function(){ res(obj); };
        img.src = obj.dataUrl;
      }catch(e){ res(obj); }
    });
  }

  // ---------- usage logging + dashboard ----------
  function getLog(){ try{ return JSON.parse(gv("usage_log","[]"))||[]; }catch(e){ return []; } }
  function rates(m){
    m=(m||"").toLowerCase();
    if(m.indexOf("mini")>=0) return [0.15,0.60];
    if(m.indexOf("gpt-4o")>=0||m.indexOf("gpt-4.1")>=0||m.indexOf("gpt-4-")>=0) return [2.5,10];
    if(m.indexOf("o1")>=0||m.indexOf("o3")>=0) return [15,60];
    if(m.indexOf("haiku")>=0) return [0.8,4];
    if(m.indexOf("opus")>=0) return [15,75];
    if(m.indexOf("claude")>=0) return [3,15];
    if(m.indexOf("flash")>=0) return [0.075,0.30];
    if(m.indexOf("gemini")>=0) return [1.25,5];
    if(m.indexOf("@cf")>=0||m.indexOf("llama")>=0||m.indexOf("qwen")>=0||m.indexOf("deepseek")>=0) return [0,0];
    return [0.5,1.5];
  }
  function estCost(m,pt,ct){ var r=rates(m); return (pt/1e6)*r[0]+(ct/1e6)*r[1]; }
  function logUsage(model,promptChars,compChars){
    var pt=Math.round(promptChars/4), ct=Math.round(compChars/4);
    var log=getLog(); log.push({t:Date.now(),m:model,pt:pt,ct:ct,c:estCost(model,pt,ct)});
    if(log.length>800) log=log.slice(-800);
    sv("usage_log", JSON.stringify(log));
  }
  if(typeof streamReply==="function"){
    var _sr = streamReply;
    streamReply = async function(){
      var model = (($id("model")&&$id("model").value)||"").trim() || "default";
      var promptChars = 0; try{ promptChars = JSON.stringify(msgsForApi()).length; }catch(e){}
      var r = await _sr.apply(this, arguments);
      try{
        var last = state.chat[state.chat.length-1];
        var comp = (last && last.role==="assistant" && typeof last.content==="string") ? last.content.length : 0;
        if(comp>0) logUsage(model, promptChars, comp);
      }catch(e){}
      return r;
    };
  }

  var dash = mkEl("div"); dash.id="fx-dash";
  dash.innerHTML = '<div class="modalcard">'
    + '<div class="row" style="justify-content:space-between"><h2 style="margin:0;font-size:18px">\uD83D\uDCCA Dashboard</h2><button class="btn" id="fx-dash-x">Tutup</button></div>'
    + '<p class="muted" style="font-size:12px;margin:4px 0 12px">Statistik lokal (disimpan di browser ini). Token &amp; biaya adalah estimasi berdasarkan tarif publik.</p>'
    + '<div id="fx-dash-body"></div>'
    + '<div class="fx-foot"><button class="btn" id="fx-dash-clear">\uD83D\uDDD1\uFE0F Bersihkan data</button></div>'
    + '</div>';
  document.body.appendChild(dash);
  var dashBody = dash.querySelector("#fx-dash-body");
  dash.querySelector("#fx-dash-x").onclick = function(){ dash.style.display="none"; };
  dash.addEventListener("click", function(e){ if(e.target===dash) dash.style.display="none"; });
  dash.querySelector("#fx-dash-clear").onclick = function(){ if(confirm("Hapus semua data statistik?")){ sv("usage_log","[]"); renderDash(); toast("Data statistik dibersihkan"); } };

  function renderDash(){
    var log=getLog(), totPt=0, totCt=0, totCost=0, byModel={};
    log.forEach(function(e){
      totPt+=e.pt||0; totCt+=e.ct||0; totCost+=e.c||0;
      var k=e.m||"default"; if(!byModel[k]) byModel[k]={n:0,pt:0,ct:0,c:0};
      byModel[k].n++; byModel[k].pt+=e.pt||0; byModel[k].ct+=e.ct||0; byModel[k].c+=e.c||0;
    });
    var days={}, order=[], now=new Date();
    for(var i=13;i>=0;i--){ var d=new Date(now.getTime()-i*86400000); var key=("0"+(d.getMonth()+1)).slice(-2)+"/"+("0"+d.getDate()).slice(-2); days[key]=0; order.push(key); }
    log.forEach(function(e){ var d2=new Date(e.t); var key2=("0"+(d2.getMonth()+1)).slice(-2)+"/"+("0"+d2.getDate()).slice(-2); if(key2 in days) days[key2]++; });
    var maxd=1; order.forEach(function(k){ if(days[k]>maxd) maxd=days[k]; });
    var cards='<div class="fx-cards">'
      + '<div class="fx-card"><div class="n">'+fmt(log.length)+'</div><div class="l">Permintaan</div></div>'
      + '<div class="fx-card"><div class="n">'+fmt(totPt+totCt)+'</div><div class="l">Token (est.)</div></div>'
      + '<div class="fx-card"><div class="n">'+fmt(totPt)+'</div><div class="l">Token masuk</div></div>'
      + '<div class="fx-card"><div class="n">'+fmt(totCt)+'</div><div class="l">Token keluar</div></div>'
      + '<div class="fx-card"><div class="n">'+money(totCost)+'</div><div class="l">Biaya (est.)</div></div>'
      + '</div>';
    var bars = order.map(function(k){ var hpx=Math.round((days[k]/maxd)*78)+2; return '<div class="fx-bar" title="'+k+": "+days[k]+' permintaan" style="height:'+hpx+'px"></div>'; }).join("");
    var mkeys = Object.keys(byModel).sort(function(a,b){ return byModel[b].n-byModel[a].n; });
    var mrows = mkeys.map(function(m){ var v=byModel[m]; return '<tr><td>'+esc(m)+'</td><td>'+fmt(v.n)+'</td><td>'+fmt(v.pt+v.ct)+'</td><td>'+money(v.c)+'</td></tr>'; }).join("") || '<tr><td colspan="4" class="muted">Belum ada data</td></tr>';
    var recent = log.slice(-8).reverse().map(function(e){ return '<tr><td>'+new Date(e.t).toLocaleString()+'</td><td>'+esc(e.m||"")+'</td><td>'+fmt((e.pt||0)+(e.ct||0))+'</td><td>'+money(e.c||0)+'</td></tr>'; }).join("") || '<tr><td colspan="4" class="muted">Belum ada data</td></tr>';
    dashBody.innerHTML = cards
      + '<div class="lbl">Permintaan 14 hari terakhir</div><div class="fx-bars">'+bars+'</div>'
      + '<div class="lbl">Per model</div><table class="fx-t"><thead><tr><th>Model</th><th>Permintaan</th><th>Token</th><th>Biaya</th></tr></thead><tbody>'+mrows+'</tbody></table>'
      + '<div class="lbl" style="margin-top:10px">\u26A1 Pilih model cepat</div><div class="fx-foot" id="fx-presets"></div>'
      + '<div class="lbl" style="margin-top:12px">Permintaan terakhir</div><table class="fx-t"><thead><tr><th>Waktu</th><th>Model</th><th>Token</th><th>Biaya</th></tr></thead><tbody>'+recent+'</tbody></table>';
    var presets=["gpt-4o","gpt-4o-mini","claude-3-5-sonnet-20241022","claude-3-5-haiku-20241022","gemini-1.5-pro","gemini-1.5-flash"];
    var pf=dashBody.querySelector("#fx-presets");
    presets.forEach(function(p){ var c=mkEl("button","chip",esc(p)); c.style.cursor="pointer"; c.onclick=function(){ if($id("model")){ $id("model").value=p; toast("Model di-set: "+p); } }; pf.appendChild(c); });
  }
  function openDash(){ renderDash(); dash.style.display="flex"; }

  // ---------- topbar + composer buttons ----------
  try{
    var tb=document.querySelector(".topbar"); var setBtn=$id("settings");
    var dashBtn=mkEl("button","iconbtn"); dashBtn.textContent="\uD83D\uDCCA"; dashBtn.title="Dashboard"; dashBtn.onclick=openDash;
    tempBtn=mkEl("button","iconbtn"); tempBtn.textContent="\uD83D\uDC7B"; tempBtn.title="Chat sementara: OFF"; tempBtn.style.opacity=".55"; tempBtn.onclick=toggleTemp;
    if(tb&&setBtn){ tb.insertBefore(dashBtn,setBtn); tb.insertBefore(tempBtn,setBtn); }
  }catch(e){}
  try{
    var cf=document.querySelector(".compfoot");
    if(cf){
      var contBtn=mkEl("button","iconbtn"); contBtn.textContent="\u25B6\uFE0F Lanjutkan"; contBtn.title="Lanjutkan jawaban terakhir"; contBtn.onclick=continueResp;
      var brBtn=mkEl("button","iconbtn"); brBtn.textContent="\uD83C\uDF3F Branch"; brBtn.title="Cabang percakapan baru"; brBtn.onclick=branchChat;
      cf.appendChild(contBtn); cf.appendChild(brBtn);
    }
  }catch(e){}

  // ===== deferred features: OCR, request queue, lazy history, resume-on-disconnect =====
  // ---------- OCR (Tesseract.js, lazy load) ----------
  function loadTesseract(){ if(window.Tesseract) return Promise.resolve(); if(window.__tessP) return window.__tessP; window.__tessP=new Promise(function(res,rej){ var s=document.createElement("script"); s.src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"; s.onload=function(){res()}; s.onerror=function(){window.__tessP=null;rej(new Error("Gagal memuat OCR"))}; document.head.appendChild(s); }); return window.__tessP; }
  function ocrImage(dataUrl){ return loadTesseract().then(function(){ return window.Tesseract.recognize(dataUrl,"ind+eng"); }).then(function(r){ return (((r&&r.data&&r.data.text)||"").replace(/\n{3,}/g,"\n\n")).trim(); }); }
  if(typeof renderAttbar==="function"){
    var _renderAttbarOcr=renderAttbar;
    renderAttbar=function(){
      _renderAttbarOcr.apply(this,arguments);
      try{
        var box=$id("attbar"); if(!box) return; var atts=box.querySelectorAll(".att");
        for(var i=0;i<atts.length;i++){ (function(idx,node){ var f=pending[idx]; if(f&&f.kind==="image"&&!f.__ocr){ var b=mkEl("span","x"," \uD83D\uDD0D OCR"); b.style.cursor="pointer"; b.title="Ekstrak teks dari gambar (OCR)"; b.onclick=function(ev){ ev.stopPropagation(); b.textContent=" \u23F3"; ocrImage(f.dataUrl).then(function(txt){ f.__ocr=true; if(txt){ pending.push({name:f.name+".ocr.txt",kind:"text",text:txt}); toast("OCR selesai: "+txt.length+" karakter"); } else { toast("Nggak ada teks yang kebaca",true); } renderAttbar(); }).catch(function(e){ toast(String((e&&e.message)||e),true); b.textContent=" \uD83D\uDD0D OCR"; }); }; node.appendChild(b); } })(i, atts[i]); }
      }catch(e){}
    };
  }

  // ---------- request queue (kirim beruntun tanpa nunggu) ----------
  window.__queue = window.__queue || [];
  var qbar=null;
  try{ var comp=document.querySelector(".composer"); if(comp){ qbar=mkEl("div"); qbar.id="fx-queue"; qbar.style.cssText="display:none;flex-wrap:wrap;gap:6px;margin-bottom:6px"; comp.insertBefore(qbar, comp.firstChild); } }catch(e){}
  function renderQueue(){ if(!qbar) return; var q=window.__queue; if(!q.length){ qbar.style.display="none"; qbar.innerHTML=""; return; } qbar.style.display="flex"; qbar.innerHTML=""; q.forEach(function(item,i){ var chip=mkEl("div","att"); chip.textContent="\u23F3 "+(item.t?item.t.slice(0,32):("("+item.files.length+" file)")); var x=mkEl("span","x"," \u2715"); x.style.cursor="pointer"; x.onclick=function(){ q.splice(i,1); renderQueue(); }; chip.appendChild(x); qbar.appendChild(chip); }); }
  if(typeof sendChat==="function"){
    var _sendChatQ=sendChat;
    sendChat=function(){
      if(window.__ctrl){ var inp=$id("chatin"); var t=(inp&&inp.value.trim())||""; var f=(typeof pending!=="undefined")?pending.slice():[]; if(!t&&!f.length) return; window.__queue.push({t:t,files:f}); if(typeof pending!=="undefined"){ pending.length=0; if(typeof renderAttbar==="function") renderAttbar(); } if(inp){ inp.value=""; inp.style.height="auto"; } renderQueue(); toast("Masuk antrean ("+window.__queue.length+") \u2014 dikirim setelah jawaban ini selesai"); return; }
      return _sendChatQ.apply(this, arguments);
    };
  }
  function drainQueue(){ if(window.__ctrl) return; if(!window.__queue.length) return; var item=window.__queue.shift(); renderQueue(); if(typeof pushMsg==="function"){ pushMsg("user", item.t, item.files); if(typeof renderChat==="function") renderChat(); if(typeof streamReply==="function") streamReply(); } }
  if(typeof streamReply==="function"){ var _srDrain=streamReply; streamReply=function(){ var r=_srDrain.apply(this,arguments); Promise.resolve(r).then(function(){ try{ drainQueue(); }catch(e){} }); return r; }; }

  // ---------- lazy-load history (render bertahap + infinite scroll) ----------
  window.__histLimit = window.__histLimit || 40;
  if(typeof renderHistory==="function"){
    renderHistory=function(){
      var box=$id("histlist"); if(!box) return;
      var f=(($id("histsearch")&&$id("histsearch").value)||"").toLowerCase();
      var all=(window.__sessions||[]).filter(function(s){ return !f||(s.title||"").toLowerCase().indexOf(f)>=0; });
      var lim=window.__histLimit||40; var shown=all.slice(0,lim);
      box.innerHTML="";
      shown.forEach(function(s){ var it=mkEl("div","hitem"+((typeof state!=="undefined"&&state.chatId===s.id)?" active":"")); var t=mkEl("div","t",esc(s.title)); t.onclick=function(){ openChat(s.id); }; it.appendChild(t); var rn=mkEl("button","a","\u270F\uFE0F"); rn.onclick=function(ev){ ev.stopPropagation(); renameChat(s.id,s.title); }; var dl=mkEl("button","a","\uD83D\uDDD1\uFE0F"); dl.onclick=function(ev){ ev.stopPropagation(); delChatById(s.id); }; it.appendChild(rn); it.appendChild(dl); box.appendChild(it); });
      if(all.length>shown.length){ var rem=all.length-shown.length; var more=mkEl("div","hitem"); more.style.justifyContent="center"; more.style.color="var(--muted)"; more.style.cursor="pointer"; more.textContent="\u2B07\uFE0F Muat "+Math.min(40,rem)+" lagi ("+rem+" tersisa)"; more.onclick=function(){ window.__histLimit=lim+40; renderHistory(); }; box.appendChild(more); }
    };
    try{ var _hl=$id("histlist"); if(_hl){ _hl.addEventListener("scroll",function(){ if(_hl.scrollTop+_hl.clientHeight>=_hl.scrollHeight-48){ var all=(window.__sessions||[]); if((window.__histLimit||40)<all.length){ window.__histLimit=(window.__histLimit||40)+40; renderHistory(); } } }); } }catch(e){}
    try{ var _hs=$id("histsearch"); if(_hs){ _hs.addEventListener("input",function(){ window.__histLimit=40; renderHistory(); }); } }catch(e){}
    try{ renderHistory(); }catch(e){}
  }

  // ---------- resume-on-disconnect: pulihkan jawaban terputus saat load ----------
  try{
    var _rkey="resume:"+((typeof state!=="undefined"&&state.chatId)||"new");
    var _saved=LS.getItem(_rkey);
    if(_saved){ var _obj=JSON.parse(_saved); if(_obj&&_obj.acc&&(Date.now()-(_obj.t||0)<86400000)){ if(typeof state!=="undefined"&&state.chat&&state.chat.length){ var _lm=state.chat[state.chat.length-1]; if(_lm&&_lm.role==="assistant"&&(!_lm.content||_lm.content.length<_obj.acc.length)){ _lm.content=_obj.acc; if(typeof renderChat==="function") renderChat(); toast("\uD83D\uDD0C Jawaban yang terputus dipulihkan \u2014 klik \u25B6\uFE0F Lanjutkan untuk menyambung"); } } } }
  }catch(e){}
}
export const FEATURES_JS = "(" + __featuresMain.toString() + ")();";
