/* Deployment-owned tab identity; no application UI or runtime state changes. */
(() => {
  if (/^\/profiles\/?$/.test(location.pathname)) document.addEventListener('DOMContentLoaded',()=>{
    const root = document.documentElement;
const readerStyle = document.createElement('style');
readerStyle.textContent = `
:root[data-theme]{--paper:#141414;--ink:#e2e0dc;--dim:#aaa8a3;--line:#383836;--chip:#20201f;--divider-ink:var(--line);background:var(--paper);color:var(--ink);color-scheme:dark}
:root[data-theme=light]{--paper:#faf9f6;--ink:#262623;--dim:#65645e;--line:#d8d7d0;--chip:#f0efea;color-scheme:light}
body,.salon-header{background:var(--paper)}
:root[data-theme]{--surface:var(--paper);--inactive-ink:var(--dim)}
html[data-theme] body,html[data-theme] body header,html[data-theme] #status{background:var(--paper);color:var(--ink)}
html[data-theme] :is(.feed-source,#publications small,.hint,.intro,.identity,.scope,.reply-hint){color:var(--dim)}
html[data-theme] :is(select,textarea){background:var(--paper);color:var(--ink);border-color:var(--line)}
html[data-theme] .profile-picker-list{background:var(--paper);color:var(--ink)}
html[data-theme] .instruction-show,html[data-theme] .profile-toolbar :is(button,input[type=number]){background:transparent;border-color:transparent;box-shadow:none}
html[data-theme] header .reader-tools{flex:none;align-self:flex-start;margin:2px 0 0 auto}
html[data-theme] header .reader-tools button{width:28px;height:28px;padding:0;border:0;border-radius:0;background:transparent;font:18px/1 system-ui}
html[data-theme] #profile-tabs a[aria-current=page],html[data-theme] .profile-picker-option[aria-selected=true]{color:var(--ink)}
html[data-theme=light] .error{color:#933328}
.salon-nav a,.message-date,.archive-summary,.count,.identity,.status,.empty,.back,.message blockquote{color:var(--dim)}
a:hover,.message strong,.salon-nav a:is(:hover,:focus-visible,[aria-current]){color:var(--ink)}
.message+.message{border-color:var(--line)}
.reader-tools{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 1.35rem}
.reader-tools button{appearance:none;cursor:pointer;border:1px solid var(--line);border-radius:2rem;background:transparent;color:var(--dim);font:500 13px/1.2 system-ui;padding:8px 13px}
.reader-tools button:hover,.reader-tools button:focus-visible{background:var(--chip);color:var(--ink)}
.reader-tools button:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.reader-tools button:disabled{opacity:.55;cursor:default}
`;
document.head.append(readerStyle);
let savedTheme;
try { savedTheme = document.cookie.match(/(?:^|; )reader_theme=(dark|light)(?:;|$)/)?.[1] || localStorage.getItem('lc.theme'); } catch {}
root.dataset.theme = ['light','dark'].includes(savedTheme) ? savedTheme : (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
function readerTools(order) {
  const tools = document.createElement('div'); tools.className = 'reader-tools';
  const theme = document.createElement('button'); theme.type = 'button';
  const label = () => { const dark=root.dataset.theme==='dark'; theme.textContent=dark?'☼':'☾'; theme.title=dark?'Switch to light theme':'Switch to dark theme'; theme.setAttribute('aria-label',theme.title); };
  theme.onclick = () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('lc.theme', root.dataset.theme); document.cookie=`reader_theme=${root.dataset.theme}; Domain=@@SITE_HOST@@; Path=/; Max-Age=31536000; SameSite=Lax; Secure`; } catch {}
    label();
  };
  label(); if (order) tools.append(order); tools.append(theme); return tools;
}

    const host=document.querySelector('header')||document.body;
    host.append(readerTools());
  },{once:true});
  const label = "Nikita";
  const apply = () => { if (document.title !== label) document.title = label; };
  apply();
  new MutationObserver(apply).observe(document.head, { childList: true, subtree: true, characterData: true });
})();

;(() => {
 const mount=()=>{
  const q=s=>document.querySelector(s), panel='https://@@PANEL_HOST@@', chat=!!q('#chatMsgs'), profiles=q('#profile-tabs'), salon=q('.salon-nav');
  if((!chat&&!profiles&&!salon)||q('#nika-global'))return;
  const items=[['nikita',''],['Pi Web','piwep'],['CurveLab','curvelab'],['ARRI','arri'],['LightCone','lightcone'],['Soul Lake','lake'],['My Simeiz','moisimeiz'],['Salon Niki','salon_nikita'],['My DM','owner_dm'],['Other DMs','guest_dm'],['Alexey Belykh','individual'],['Notes','notes'],['LC','lc'],['DB','db']];
  const root=document.documentElement,bar=document.createElement('div'),nav=document.createElement('nav'),actions=document.createElement('div'),toggle=document.createElement('a'),sun=document.createElement('button');
  bar.id='nika-global'; nav.ariaLabel='Navigation'; actions.className='nika-actions';if(!chat)bar.append(nav);bar.append(actions);bar.classList.toggle('corner-only',chat);actions.append(toggle,sun);document.body.prepend(bar);
  const style=document.createElement('style');style.textContent=`
  #nika-global{--off:#55534f;--on:#e2e0dc;--bg:#141414;--line:#383836;position:fixed;inset:0 0 auto;z-index:10000;box-sizing:border-box;min-height:32px;--corner-width:58px;--corner-right:2.4px;padding:0 0 0 12px;background:var(--bg);color:var(--on);font:400 14px/32px system-ui,sans-serif}
  html[data-theme=light] #nika-global{--off:#a4a19b;--on:#262623;--bg:#faf9f6;--line:#d8d7d0}
  #nika-global.corner-only{inset:2px var(--corner-right) auto auto;width:var(--corner-width);min-height:0;padding:0;background:transparent}#nika-global nav{display:block;padding:0;margin:0;font-size:0;line-height:32px;word-spacing:10.5px}#nika-global nav::before{content:'';float:right;height:30px;width:calc(var(--corner-width) + var(--corner-right) + 2px)}#nika-global nav a{display:inline-block;vertical-align:top;font-size:14px;word-spacing:normal}
  #nika-global a,#nika-global button{box-sizing:border-box;position:relative;display:block;flex:none;margin:0;padding:0;border:0;border-radius:0;background:transparent;color:var(--off);font:inherit;text-decoration:none;letter-spacing:normal;white-space:nowrap;cursor:pointer}
  #nika-global nav a+a:before{content:'';position:absolute;top:9px;left:-5px;height:14px;border-left:1px solid var(--line)}#nika-global [aria-current=page]{color:var(--on)}#nika-global [aria-current=page]{-webkit-text-stroke:.35px currentColor}
  #nika-global .nika-actions{position:fixed;top:2px;right:var(--corner-right);width:var(--corner-width);font-size:12px;display:grid;grid-template-columns:minmax(0,1fr) 26px;gap:1px;text-align:center;align-items:center}#nika-global .nika-actions>*{height:28px;line-height:28px}#nika-global button{font-size:18px}#nika-global :focus-visible{outline:1px solid currentColor;outline-offset:-2px}
  body:has(#nika-global) :is(#profile-tabs,.salon-nav,.reader-theme-icon,.app-brand,.reader-nav,header>.reader-tools){display:none!important}body:has(#nika-global) :is(header:has(#profile-tabs),.salon-header){box-sizing:border-box;height:var(--nika-nav-height,32px)!important;min-height:var(--nika-nav-height,32px)!important;padding:0!important;margin:0!important}body:has(#nika-global) #profile-fullscreen{top:var(--nika-nav-height,32px)!important}
  html[data-theme=light]:has(.corner-only){color-scheme:light;--chat-surface:#eeedea;--chat-surface-hover:#dfdedb;--chat-surface-border:#cccac5;--chat-paper:#faf9f6;--chat-text:#262623;--chat-muted:#66645f}
  html[data-theme=light] body:has(.corner-only) :is(.app,.workspace,#drawerChat,.chat-inner,#chatMsgs,.chat-in,#chatUsage){background:var(--chat-paper)!important;color:var(--chat-text)}
  html[data-theme=light] body:has(.corner-only) :is(.cm,.cm h1,.cm h2,.cm h3,.cm h4,.cm strong,.cm li,.cm p,.cm th,.cm td,.mpop,.mpop-name,.pmpt-sheet,.pmpt-sheet textarea,.reasoning-card,.pi-web-notice,#filesWin,#chatInput){color:var(--chat-text)!important}
  html[data-theme=light] body:has(.corner-only) :is(.mpop-hint,.mpop-foot,.cm small,.thinking-thought,.think-fold,.chat-usage button,.mpop button,.pmpt-btn,#chatPlus,#chatFilesX,#chatMic:not(.recording)){color:var(--chat-muted)!important}
  html[data-theme=light] body:has(.corner-only) :is(.cm pre,.cm code,.cm blockquote,.cm th,.cm-undo,.pmpt-btn,.mpop-item:hover){background:var(--chat-surface)!important;border-color:var(--chat-surface-border);color:var(--chat-text)}html[data-theme=light] body:has(.corner-only) .cm a{color:#28558e}html[data-theme=light] body:has(.corner-only) #chatInput{background:transparent!important;caret-color:var(--chat-text)}html[data-theme=light] body:has(.corner-only) #chatInput::placeholder{color:var(--chat-muted)} `;document.head.append(style);
  const source=profiles||salon; const original=label=>Array.from(source?.querySelectorAll('a')||[]).find(a=>a.textContent.trim().toLowerCase()===label.toLowerCase());
  function fallback(id){if(!id)return panel+'/profiles';if(id==='notes')return panel+'/go/hub';if(id==='lc'||id==='db')return panel+'/go/'+(id==='lc'?'lightcone':'debri');return panel+'/go/hub?chat='+id;}
  // Only the Salon shell owns in-place history navigation. Profile tabs are settings controls.
  const historyLink=(label,id)=>salon&&location.pathname.startsWith('/nikita/')&&id?original(label):null;
  if(!chat)new ResizeObserver(()=>root.style.setProperty('--nika-nav-height',bar.offsetHeight+'px')).observe(bar);
  const links=(chat?[]:items).map(([label,id])=>{const a=document.createElement('a');a.textContent=label;a.referrerPolicy='no-referrer';a.href=fallback(id);if(nav.childElementCount)nav.append(' ');nav.append(a);a.onclick=e=>{const orig=historyLink(label,id);if(orig&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey&&!e.altKey){e.preventDefault();orig.click();}};return a;});
  function sync(){if(chat)return;items.forEach(([label,id],i)=>{const orig=historyLink(label,id),a=links[i];a.href=orig?.href||fallback(id);const active=profiles?!id:original(label)?.hasAttribute('aria-current');if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});}
  if(source)new MutationObserver(sync).observe(source,{subtree:true,childList:true,attributes:true,attributeFilter:['href','aria-current']});sync();toggle.textContent=chat?'nikita':'Chat';toggle.href=chat?panel+'/profiles':panel+'/';toggle.referrerPolicy='no-referrer';sun.type='button';
  function saved(){try{return document.cookie.match(/(?:^|; )reader_theme=(light|dark)(?:;|$)/)?.[1]||localStorage.getItem('lc.theme')||'dark';}catch{return 'dark';}}
  function theme(mode){const light=mode==='light';root.dataset.theme=light?'light':'dark';if(chat){root.classList.toggle('dark',!light);root.classList.toggle('pre-light',light);root.style.background=light?'#f0f2f5':'#16191e';try{localStorage.setItem('pi-web.theme',mode);}catch{}}sun.textContent=light?'☾':'☼';sun.title=light?'Switch to dark theme':'Switch to light theme';sun.setAttribute('aria-label',sun.title);}
  sun.onclick=()=>{const mode=root.dataset.theme==='light'?'dark':'light';document.cookie=`reader_theme=${mode}; Domain=@@SITE_HOST@@; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;try{localStorage.setItem('lc.theme',mode);}catch{}theme(mode);};theme(saved());window.addEventListener('pageshow',()=>theme(saved()));document.addEventListener('visibilitychange',()=>{if(!document.hidden)theme(saved());});
 };if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
