// Single-file dashboard. No build step, no external assets.
export const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>aliasflare</title>
<style>
:root{--bg:#0f1115;--card:#171a21;--line:#262a33;--fg:#e8eaed;--mut:#9aa0a6;--acc:#f6821f;--ok:#34c759;--bad:#ff453a}
@media (prefers-color-scheme:light){:root{--bg:#f6f7f9;--card:#fff;--line:#e3e5e8;--fg:#1d1f23;--mut:#6b7078}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:920px;margin:0 auto;padding:20px 16px 60px}
header{display:flex;align-items:center;gap:10px;margin-bottom:16px}header h1{font-size:20px;margin:0}header .sp{flex:1}
.logo{width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,#f6821f,#fbad41)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:14px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
input,select,button,textarea{font:inherit;color:inherit;background:transparent;border:1px solid var(--line);border-radius:8px;padding:8px 10px}
input,textarea{flex:1;min-width:140px}button{cursor:pointer;background:var(--acc);border-color:var(--acc);color:#fff;font-weight:600}
button.ghost{background:transparent;color:var(--fg);border-color:var(--line);font-weight:500}
.stats{display:flex;gap:18px;flex-wrap:wrap;color:var(--mut)}.stats b{color:var(--fg);font-size:18px;display:block}
table{width:100%;border-collapse:collapse}td,th{padding:9px 6px;border-top:1px solid var(--line);text-align:left;vertical-align:middle}th{color:var(--mut);font-weight:500;border-top:0}
.addr{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer}.mut{color:var(--mut)}.small{font-size:12px}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;border:1px solid var(--line)}
.on{color:var(--ok)}.off{color:var(--bad)}.code{font-family:ui-monospace,monospace;font-weight:700;color:var(--acc);cursor:pointer}
.sw{position:relative;width:38px;height:22px;border-radius:99px;background:var(--line);border:0;padding:0}.sw.on{background:var(--ok)}
.sw::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.15s}.sw.on::after{left:19px}
#toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#000c;color:#fff;padding:8px 14px;border-radius:8px;display:none}
.hide{display:none}.warn{border-color:#f6821f88}
@media (max-width:640px){.hm{display:none}}
</style>
</head>
<body>
<div class="wrap">
<header><div class="logo"></div><h1>aliasflare</h1><span class="sp"></span>
<button class="ghost" id="lang">中文</button><button class="ghost hide" id="logout" data-t="logout">Log out</button></header>

<div id="login" class="card">
  <p data-t="loginHint">Enter your ADMIN_TOKEN.</p>
  <div class="row"><input id="token" type="password" placeholder="ADMIN_TOKEN" autocomplete="current-password"><button id="go" data-t="login">Log in</button></div>
</div>

<div id="app" class="hide">
  <div id="setup" class="card warn hide"></div>
  <div class="card stats" id="stats"></div>
  <div class="card">
    <div class="row">
      <input id="note" data-tp="notePh" placeholder="What is it for? e.g. taobao, github (optional)">
      <select id="domain"></select>
      <button id="create" data-t="create">New alias</button>
    </div>
    <p class="mut small" data-t="autoHint">Tip: any address at your domain works instantly — just make one up when signing up (auto-create).</p>
  </div>
  <div class="card">
    <div class="row" style="margin-bottom:6px"><input id="q" data-tp="searchPh" placeholder="Search"></div>
    <table><thead><tr><th data-t="alias">Alias</th><th class="hm" data-t="note">Note</th><th data-t="stats">Mail</th><th data-t="on">On</th><th></th></tr></thead><tbody id="list"></tbody></table>
  </div>
  <div class="card">
    <h3 style="margin:0 0 8px" data-t="recent">Recent mail</h3>
    <table><thead><tr><th data-t="time">Time</th><th data-t="alias">Alias</th><th class="hm" data-t="peer">From / to</th><th data-t="subject">Subject</th><th data-t="code">Code</th></tr></thead><tbody id="log"></tbody></table>
  </div>
  <div class="card" id="sendCard">
    <h3 style="margin:0 0 8px" data-t="send">Send from an alias</h3>
    <div class="row"><select id="sFrom"></select><input id="sTo" placeholder="to@example.com"></div>
    <div class="row" style="margin-top:8px"><input id="sSubj" data-tp="subjectPh" placeholder="Subject"></div>
    <div class="row" style="margin-top:8px"><textarea id="sText" rows="4" data-tp="bodyPh" placeholder="Message"></textarea></div>
    <div class="row" style="margin-top:8px"><button id="sGo" data-t="sendBtn">Send</button><span class="mut small" id="sMode"></span></div>
  </div>
  <div class="card mut small" id="mcpCard"></div>
</div>
</div>
<div id="toast"></div>
<script>
const T={en:{logout:"Log out",loginHint:"Enter your ADMIN_TOKEN.",login:"Log in",notePh:"What is it for? e.g. taobao, github (optional)",create:"New alias",
autoHint:"Tip: any address at your domain works instantly — just make one up when signing up (auto-create).",searchPh:"Search aliases or notes",alias:"Alias",note:"Note",stats:"Mail",on:"On",
recent:"Recent mail",time:"Time",peer:"From / to",subject:"Subject",code:"Code",send:"Send from an alias",subjectPh:"Subject",bodyPh:"Message",sendBtn:"Send",copied:"Copied",
del:"Delete",confirmDel:"Delete this alias and its history?",aliases:"aliases",active:"active",fwd:"forwarded",blk:"blocked",rep:"sent",
mcp:"MCP endpoint for AI agents (Claude, Cursor…): ",mcpTok:"Header: Authorization: Bearer <ADMIN_TOKEN>",modeResend:"via Resend",modeCf:"via Cloudflare Email Sending",modeNone:"No outbound transport — set RESEND_API_KEY to send and reply",
setupDomain:"DOMAIN is not set.",setupDest:"DESTINATION is not set.",setupRoute:"Last step: Cloudflare Dashboard → your domain → Email → Email Routing → Routing rules → Catch-all → Send to a Worker → this Worker."},
zh:{logout:"退出",loginHint:"输入 ADMIN_TOKEN 登录。",login:"登录",notePh:"用途，如 taobao、github（可选）",create:"新建别名",
autoHint:"提示：域名下任意地址都能直接收信，注册时随手编一个即可（自动创建）。",searchPh:"搜索别名或备注",alias:"别名",note:"备注",stats:"邮件",on:"启用",
recent:"最近邮件",time:"时间",peer:"发件/收件人",subject:"主题",code:"验证码",send:"用别名发信",subjectPh:"主题",bodyPh:"正文",sendBtn:"发送",copied:"已复制",
del:"删除",confirmDel:"删除这个别名及其记录？",aliases:"别名",active:"启用中",fwd:"已转发",blk:"已拦截",rep:"已发出",
mcp:"给 AI 用的 MCP 地址（Claude、Cursor 等）：",mcpTok:"请求头：Authorization: Bearer <ADMIN_TOKEN>",modeResend:"通过 Resend 发送",modeCf:"通过 Cloudflare Email Sending 发送",modeNone:"未配置发信通道：设置 RESEND_API_KEY 后才能回信和发信",
setupDomain:"尚未设置 DOMAIN。",setupDest:"尚未设置 DESTINATION。",setupRoute:"最后一步：Cloudflare 控制台 → 你的域名 → 电子邮件 → 电子邮件路由 → 路由规则 → Catch-all → 发送到 Worker → 选本 Worker。"}};
let L=localStorage.lang||((navigator.language||"").toLowerCase().startsWith("zh")?"zh":"en");
const t=k=>T[L][k]||T.en[k]||k;const $=s=>document.querySelector(s);
function applyLang(){document.documentElement.lang=L==="zh"?"zh-CN":"en";$("#lang").textContent=L==="zh"?"EN":"中文";
document.querySelectorAll("[data-t]").forEach(e=>e.textContent=t(e.dataset.t));document.querySelectorAll("[data-tp]").forEach(e=>e.placeholder=t(e.dataset.tp));}
$("#lang").onclick=()=>{L=L==="zh"?"en":"zh";localStorage.lang=L;applyLang();if(tok())load();};
const tok=()=>localStorage.aliasflareToken||"";
function toast(m){const e=$("#toast");e.textContent=m;e.style.display="block";clearTimeout(e._t);e._t=setTimeout(()=>e.style.display="none",1800);}
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
async function api(path,opt={}){const r=await fetch(path,{...opt,headers:{"content-type":"application/json",authorization:"Bearer "+tok(),...(opt.headers||{})}});
const d=await r.json().catch(()=>({}));if(r.status===401){localStorage.removeItem("aliasflareToken");show(false);throw new Error("unauthorized");}if(!r.ok)throw new Error(d.error||r.statusText);return d;}
function copy(s){navigator.clipboard.writeText(s).then(()=>toast(t("copied")+": "+s));}
function show(on){$("#login").classList.toggle("hide",on);$("#app").classList.toggle("hide",!on);$("#logout").classList.toggle("hide",!on);}
let cfg={};
async function load(){
  cfg=await api("/api/config");
  const s=cfg.stats||{};$("#stats").innerHTML=[["aliases",s.aliases],["active",s.enabled],["fwd",s.forwarded],["blk",s.blocked],["rep",s.replied]].map(([k,v])=>"<div><b>"+(v||0)+"</b>"+t(k)+"</div>").join("");
  const warn=[];if(!cfg.domains.length)warn.push(t("setupDomain"));if(!cfg.destination)warn.push(t("setupDest"));if(!s.forwarded)warn.push(t("setupRoute"));
  $("#setup").innerHTML=warn.map(esc).join("<br>");$("#setup").classList.toggle("hide",!warn.length);
  $("#domain").innerHTML=cfg.domains.map(d=>"<option>"+esc(d)+"</option>").join("");$("#domain").classList.toggle("hide",cfg.domains.length<2);
  $("#sMode").textContent=t(cfg.outbound==="resend"?"modeResend":cfg.outbound==="cloudflare"?"modeCf":"modeNone");
  $("#mcpCard").innerHTML=esc(t("mcp"))+"<span class='addr'>"+esc(location.origin+"/mcp")+"</span><br>"+esc(t("mcpTok"));
  await Promise.all([list(),logs()]);
}
async function list(){
  const d=await api("/api/aliases?q="+encodeURIComponent($("#q").value));
  $("#list").innerHTML=d.aliases.map(a=>"<tr><td><span class='addr' data-copy='"+esc(a.address)+"'>"+esc(a.address)+"</span>"+(a.auto?" <span class='pill mut'>auto</span>":"")+"</td>"+
  "<td class='hm'><input value='"+esc(a.note)+"' data-note='"+a.id+"' style='min-width:90px;padding:4px 6px'></td>"+
  "<td class='small mut'>↓"+a.forwarded+" ⊘"+a.blocked+" ↑"+a.replied+"</td>"+
  "<td><button class='sw "+(a.enabled?"on":"")+"' data-tog='"+a.id+"' data-en='"+(a.enabled?1:0)+"' aria-label='toggle'></button></td>"+
  "<td><button class='ghost small' data-del='"+a.id+"'>"+t("del")+"</button></td></tr>").join("");
  $("#sFrom").innerHTML=d.aliases.filter(a=>a.enabled).map(a=>"<option>"+esc(a.address)+"</option>").join("");
}
async function logs(){
  const d=await api("/api/messages?limit=30");
  $("#log").innerHTML=d.messages.map(m=>"<tr><td class='small mut'>"+esc(new Date(m.created_at+"Z").toLocaleString())+"</td><td class='small addr'>"+esc(m.alias||"")+"</td>"+
  "<td class='hm small'>"+(m.direction==="out"?"→ ":m.direction==="blocked"?"⊘ ":m.direction==="error"?"⚠ ":"")+esc(m.peer)+"</td><td class='small'>"+esc(m.subject)+(m.detail&&m.direction==="error"?" <span class='off'>"+esc(m.detail)+"</span>":"")+"</td>"+
  "<td>"+(m.code?"<span class='code' data-copy='"+esc(m.code)+"'>"+esc(m.code)+"</span>":"")+"</td></tr>").join("");
}
document.addEventListener("click",async e=>{const el=e.target;
  if(el.dataset.copy)return copy(el.dataset.copy);
  try{
  if(el.dataset.tog){await api("/api/aliases/"+el.dataset.tog,{method:"PATCH",body:JSON.stringify({enabled:el.dataset.en!=="1"})});return load();}
  if(el.dataset.del){if(!confirm(t("confirmDel")))return;await api("/api/aliases/"+el.dataset.del,{method:"DELETE"});return load();}
  }catch(err){toast(err.message)}
});
document.addEventListener("change",async e=>{if(e.target.dataset.note){try{await api("/api/aliases/"+e.target.dataset.note,{method:"PATCH",body:JSON.stringify({note:e.target.value})});toast("✓")}catch(err){toast(err.message)}}});
$("#create").onclick=async()=>{try{const a=await api("/api/aliases",{method:"POST",body:JSON.stringify({note:$("#note").value,domain:$("#domain").value})});$("#note").value="";copy(a.alias.address);load();}catch(err){toast(err.message)}};
$("#q").oninput=()=>{clearTimeout(window._q);window._q=setTimeout(list,250)};
$("#sGo").onclick=async()=>{try{await api("/api/send",{method:"POST",body:JSON.stringify({alias:$("#sFrom").value,to:$("#sTo").value,subject:$("#sSubj").value,text:$("#sText").value})});toast("✓");$("#sText").value="";logs();}catch(err){toast(err.message)}};
$("#go").onclick=async()=>{localStorage.aliasflareToken=$("#token").value.trim();try{await load();show(true)}catch(err){toast(err.message)}};
$("#token").onkeydown=e=>{if(e.key==="Enter")$("#go").click()};
$("#logout").onclick=()=>{localStorage.removeItem("aliasflareToken");show(false)};
applyLang();if(tok())load().then(()=>show(true)).catch(()=>{});
</script>
</body>
</html>`;
