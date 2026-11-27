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
