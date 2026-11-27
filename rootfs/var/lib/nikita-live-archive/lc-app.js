// Telegram exports contain structured text entities, NOT executable HTML or implicit Markdown.
export function safeLink(value) {
  if (typeof value !== 'string' || !/^(https?:\/\/|mailto:|tel:)/i.test(value.trim())) return null;
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

const MOSCOW = new Intl.DateTimeFormat('ru-RU', {timeZone:'Europe/Moscow', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'});
const dayLabel = day => `${day.slice(8,10)}.${day.slice(5,7)}.${day.slice(0,4)}`;

export function messageDate(message) {
  const original = message.original ?? {};
  // Export dates are chat-local wall time; show them literally, never re-zoned.
  const literal = typeof original.date === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(original.date) : null;
  if (literal) {
    const day = `${literal[1]}-${literal[2]}-${literal[3]}`;
    return { day, label: `${dayLabel(day)}, ${literal[4]}:${literal[5]}` };
  }
  const seconds = Number(original.date_unixtime);
  if (String(original.date_unixtime ?? '').trim() !== '' && Number.isFinite(seconds) && seconds >= 0 && seconds < 253402300800) {
    const day = new Date(seconds * 1000).toISOString().slice(0, 10);
    return { day, label: MOSCOW.format(new Date(seconds * 1000)) };
  }
  return { day: '', label: 'Date unavailable' };
}

function messageTimestamp(message) {
  const original = message.original ?? {};
  const seconds = Number(original.date_unixtime);
  if (String(original.date_unixtime ?? '').trim() !== '' && Number.isFinite(seconds) && seconds >= 0 && seconds < 253402300800) return seconds * 1000;
  const parsed = typeof original.date === 'string' ? Date.parse(original.date) : NaN;
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

export function newestFirst(messages) {
  return messages.map((message, index) => ({ message, index })).sort((a, b) => {
    const left = messageTimestamp(a.message), right = messageTimestamp(b.message);
    if (left !== right) return left < right ? 1 : -1;
    const aid = Number(a.message.original?.id), bid = Number(b.message.original?.id);
    if (Number.isSafeInteger(aid) && Number.isSafeInteger(bid) && aid !== bid) return bid - aid;
    return a.index - b.index;
  }).map(item => item.message);
}

export function renderMessage(message, doc = document) {
  const article = doc.createElement('article');
  article.className = 'message';
  const body = doc.createElement('div'); body.className = 'message-body';
  const date = messageDate(message);
  const time = doc.createElement('time'); time.className = 'message-date'; time.textContent = date.label;
  if (date.day) time.dateTime = date.day;
  if (Number.isSafeInteger(message.original?.id)) article.dataset.messageId = String(message.original.id);
  article.append(body, time);
  const text = message.text ?? '';
  const entities = Array.isArray(message.entities) && message.entities.map(e => e.text ?? '').join('') === text
    ? message.entities : [{type: 'plain', text}];
  function appendEntities(parent, entries) {
  for (const entity of entries) {
    const value = entity.text ?? '';
    const tags = {bold: 'strong', italic: 'em', underline: 'u', strikethrough: 's', code: 'code', blockquote: 'blockquote'};
    let node;
    if (entity.type === 'pre') {
      node = doc.createElement('pre');
      const code = doc.createElement('code');
      code.textContent = value;
      if (typeof entity.language === 'string') code.dataset.language = entity.language;
      node.append(code);
    } else if (Object.hasOwn(tags, entity.type)) {
      node = doc.createElement(tags[entity.type]);
      node.textContent = value;
    } else if (['text_link', 'link', 'email', 'phone'].includes(entity.type)) {
      const href = safeLink(entity.href ?? (entity.type === 'email' ? `mailto:${value}` : entity.type === 'phone' ? `tel:${value}` : value));
      node = doc.createElement(href ? 'a' : 'span');
      node.textContent = value;
      if (href) { node.href = href; node.target = '_blank'; node.rel = 'noopener noreferrer'; }
    } else {
      node = Array.isArray(entity.children) ? doc.createElement('span') : doc.createTextNode(value);
    }
    if (Array.isArray(entity.children)) {
      node.replaceChildren();
      appendEntities(node, entity.children);
    }
    parent.append(node);
  }
  }
  const plain = entities.every((e) => (e.type ?? 'plain') === 'plain');
  if (plain && typeof window.PiRender !== 'undefined') {
    // Archive text carries Markdown and LaTeX; render it as a readable article.
    body.innerHTML = window.PiRender.html(text);
  } else {
    appendEntities(body, entities);
  }
  if (!text.trim()) {
    const empty = doc.createElement('span');
    empty.className = 'empty';
    empty.textContent = Object.keys(message.attachments ?? {}).length ? 'Attachment without text' : 'Message without text';
    body.append(empty);
  }
  return article;
}

const app = document.querySelector('#app');
const root = document.documentElement;
const readerStyle = document.createElement('style');
readerStyle.textContent = `
:root[data-theme]{--paper:#141414;--ink:#e2e0dc;--dim:#aaa8a3;--line:#383836;--chip:#20201f;--divider-ink:var(--line);background:var(--paper);color:var(--ink);color-scheme:dark}
:root[data-theme=light]{--paper:#faf9f6;--ink:#262623;--dim:#65645e;--line:#d8d7d0;--chip:#f0efea;color-scheme:light}
body,.salon-header{background:var(--paper)}
:root[data-theme]{--surface:var(--paper);--inactive-ink:var(--dim)}
html[data-theme] body,html[data-theme] body header,html[data-theme] #status{background:var(--paper);color:var(--ink)}
html[data-theme] :is(.feed-source,#publications small,.hint,.intro,.identity,.scope,.reply-hint){color:var(--dim)}
html[data-theme] :is(.profile-picker-trigger,select,textarea,input[type=number],.diagram button){background:var(--chip);color:var(--ink);border-color:var(--line)}
html[data-theme] .profile-picker-list,html[data-theme] button:not(.profile-picker-option):not(.reader-tools button):not(.reader-theme-icon){background-color:var(--chip);color:var(--ink);border-color:var(--line)}
html[data-theme] #profile-tabs a[aria-current=page],html[data-theme] .profile-picker-option[aria-selected=true]{color:var(--ink)}
html[data-theme=light] .error{color:#933328}
.salon-nav a,.message-date,.archive-summary,.count,.identity,.status,.empty,.back,.message blockquote{color:var(--dim)}
a:hover,.message strong,.salon-nav a:is(:hover,:focus-visible,[aria-current]){color:var(--ink)}
.message+.message{border-color:var(--line)}
.reader-tools{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 1.35rem}
.reader-tools button{appearance:none;cursor:pointer;border:0;background:transparent;color:var(--dim);font:500 13px/1.2 system-ui;min-height:44px;padding:0 12px;margin-inline-start:-12px}
.reader-tools button:hover,.reader-tools button:focus-visible{background:transparent;color:var(--ink)}
.reader-tools button:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.reader-tools button:disabled{opacity:.55;cursor:default}
`;
document.head.append(readerStyle);
let savedTheme;
try { savedTheme = document.cookie.match(/(?:^|; )reader_theme=(dark|light)(?:;|$)/)?.[1] || localStorage.getItem('lc.theme'); } catch {}
root.dataset.theme = ['light','dark'].includes(savedTheme) ? savedTheme : (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
// Keep the theme switch outside routed content, including loading/error screens.
const themeIcon = document.createElement('button');
themeIcon.type = 'button'; themeIcon.className = 'reader-theme-icon';
function syncThemeIcon() {
  const dark = root.dataset.theme === 'dark';
  themeIcon.textContent = dark ? '☼' : '☾';
  themeIcon.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
  themeIcon.setAttribute('aria-label', themeIcon.title);
}
themeIcon.onclick = () => {
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('lc.theme', root.dataset.theme); document.cookie=`reader_theme=${root.dataset.theme}; Domain=@@SITE_HOST@@; Path=/; Max-Age=31536000; SameSite=Lax; Secure`; } catch {}
  syncThemeIcon();
};
syncThemeIcon();
const themeHeader = document.querySelector('.salon-header');
(themeHeader || document.body).append(themeIcon);
readerStyle.textContent += `
html[data-theme] button.reader-theme-icon{position:fixed;z-index:15;top:2px;right:12px;display:grid;place-items:center;width:28px;height:28px;padding:0;margin:0;border:0;border-radius:0;color:var(--dim);background:transparent;box-shadow:none;appearance:none;cursor:pointer;font:18px/1 system-ui}
html[data-theme] .reader-theme-icon:hover{color:var(--ink)}
html[data-theme] .reader-theme-icon:focus-visible{outline:2px solid currentColor;outline-offset:1px}
.salon-header:has(.reader-theme-icon){padding-right:48px}
body:has(>.reader-theme-icon) main{padding-top:max(38px,2.5rem)}
`;
function readerTools(order) {
  if (!order) return document.createDocumentFragment();
  const tools = document.createElement('div'); tools.className = 'reader-tools'; tools.append(order); return tools;
}
let authorsPromise;
let generation = 0;
let controller;
history.scrollRestoration = 'manual';

async function getAuthors() {
  if (!authorsPromise) authorsPromise = fetch('authors.json').then(response => {
    if (!response.ok) throw new Error('Could not load authors.');
    return response.json();
  }).catch(error => { authorsPromise = null; throw error; });
  return authorsPromise;
}

function status(text) {
  const p = document.createElement('p');
  p.className = 'status'; p.setAttribute('role', 'status'); p.textContent = text;
  return p;
}

async function route() {
  const turn = ++generation;
  controller?.abort();
  controller = new AbortController();
  const {signal} = controller;
  app.replaceChildren(status('Loading…'));
  app.setAttribute('aria-busy', 'true');
  app.dataset.state = 'loading';
  delete app.dataset.author;
  delete app.dataset.messageCount;
  window.scrollTo(0, 0);
  try {
    const id = new URL(location.href).searchParams.get('author');
    if (!id) {
      const authors = await getAuthors();
      if (turn !== generation) return;
      document.title = 'LightCone · Authors';
      const heading = document.createElement('h1'); heading.textContent = 'Authors';
      const list = document.createElement('ul'); list.className = 'authors';
      const names = new Map();
      for (const author of authors) names.set(author.display_name, (names.get(author.display_name) ?? 0) + 1);
      for (const author of authors) {
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = `?author=${encodeURIComponent(author.id)}`; link.dataset.author = author.id;
        link.textContent = (author.display_name || 'Unnamed author') + (author.type === 'channel' ? ' · channel' : author.type === 'unknown' ? ' · unknown type' : '');
        const count = document.createElement('span'); count.className = 'count'; count.textContent = ` — ${author.message_count}`;
        li.append(link, count);
        if (!author.display_name || names.get(author.display_name) > 1) {
          const identity = document.createElement('span'); identity.className = 'identity'; identity.textContent = ` (${author.id})`;
          li.append(identity);
        }
        list.append(li);
      }
      const summary = document.createElement('p'); summary.className = 'archive-summary';
      const total = authors.reduce((n, a) => n + Number(a.message_count), 0);
      summary.textContent = `LightCone · ${authors.length.toLocaleString('en-US')} authors · ${total.toLocaleString('en-US')} archived messages`;
      app.replaceChildren(heading, readerTools(), summary, list);
      app.dataset.state = 'list'; app.setAttribute('aria-busy', 'false');
      window.scrollTo(0, history.state?.listScroll ?? 0);
      return;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Author not found.');
    const back = document.createElement('a'); back.className = 'back'; back.dataset.back = 'true'; back.href = './'; back.textContent = 'Back to authors';
    const loading = status('Loading…');
    app.replaceChildren(back, loading);
    const response = await fetch(`messages/${id}.json`, {signal});
    if (!response.ok) throw new Error('Could not load messages.');
    const data = await response.json();
    if (turn !== generation) return;
    if (!data || data.author?.id !== id || !Array.isArray(data.messages)) {
      throw new Error('Author data unavailable.');
    }
    const author = data.author;
    document.title = author.display_name || 'Messages';
    const usable = data.messages.filter(m => m && m.role === 'author');
    if (!usable.length) throw new Error('No messages.');
    const messages = newestFirst(usable);
    const feed = document.createElement('section'); feed.className = 'feed';
    const heading = document.createElement('h1'); heading.textContent = author.display_name || 'Messages';
    const order = document.createElement('button');
    order.type = 'button';
    order.textContent = '↑  Newest first';
    order.title = 'Reverse message order';
    order.disabled = true;
    let oldestFirst = false;
    order.addEventListener('click', () => {
      const reversed = document.createDocumentFragment();
      while (feed.lastElementChild) reversed.append(feed.lastElementChild);
      feed.append(reversed);
      oldestFirst = !oldestFirst;
      order.textContent = oldestFirst ? '↓  Oldest first' : '↑  Newest first';
    });
    app.replaceChildren(back, readerTools(order), heading, feed);
    // Newest first, full DOM in small batches. Stored chronological data stays untouched.
    for (let start = 0; start < messages.length; start += 256) {
      if (turn !== generation) return;
      const chunk = document.createDocumentFragment();
      for (const message of messages.slice(start, start + 256)) chunk.append(renderMessage(message));
      feed.append(chunk);
      if (start + 256 < messages.length) await new Promise(resolve => requestAnimationFrame(resolve));
    }
    if (turn !== generation) return;
    order.disabled = messages.length < 2;
    app.dataset.state = 'feed'; app.dataset.author = id; app.dataset.messageCount = String(messages.length);
    app.setAttribute('aria-busy', 'false');
  } catch (error) {
    if (turn !== generation || error.name === 'AbortError') return;
    const back = document.createElement('a'); back.href = './'; back.dataset.back = 'true'; back.className = 'back'; back.textContent = 'Back to authors';
    app.replaceChildren(back, status(error.message || 'Loading failed.'));
    app.dataset.state = 'error'; app.setAttribute('aria-busy', 'false');
  }
}

document.addEventListener('click', event => {
  const link = event.target.closest('a[data-author], a[data-back]');
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (link.dataset.author) {
    history.replaceState({listScroll: window.scrollY}, '', location.href);
    history.pushState({fromList: true}, '', link.href);
    route();
  } else if (history.state?.fromList) {
    history.back();
  } else {
    history.pushState({listScroll: 0}, '', link.href);
    route();
  }
});
window.addEventListener('popstate', route);
route();
