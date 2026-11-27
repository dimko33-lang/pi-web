// Telegram exports contain structured text entities, NOT executable HTML or implicit Markdown.
export function safeLink(value) {
  if (typeof value !== 'string' || !/^(https?:\/\/|mailto:|tel:)/i.test(value.trim())) return null;
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function renderMessage(message, doc = document) {
  const article = doc.createElement('article');
  article.className = 'message';
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
  appendEntities(article, entities);
  if (!text.trim()) {
    const empty = doc.createElement('span');
    empty.className = 'empty';
    empty.textContent = Object.keys(message.attachments ?? {}).length ? 'Сообщение без текста · вложение' : 'Сообщение без текста';
    article.append(empty);
  }
  return article;
}

const app = document.querySelector('#app');
let authorsPromise;
let generation = 0;
let controller;
history.scrollRestoration = 'manual';

async function getAuthors() {
  if (!authorsPromise) authorsPromise = fetch('authors.json').then(response => {
    if (!response.ok) throw new Error('Не удалось загрузить список авторов.');
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
  app.replaceChildren(status('Загрузка…'));
  app.setAttribute('aria-busy', 'true');
  app.dataset.state = 'loading';
  delete app.dataset.author;
  delete app.dataset.messageCount;
  window.scrollTo(0, 0);
  try {
    const authors = await getAuthors();
    if (turn !== generation) return;
    const id = new URL(location.href).searchParams.get('author');
    if (!id) {
      document.title = 'Авторы';
      const heading = document.createElement('h1'); heading.textContent = 'Авторы';
      const list = document.createElement('ul'); list.className = 'authors';
      const names = new Map();
      for (const author of authors) names.set(author.display_name, (names.get(author.display_name) ?? 0) + 1);
      for (const author of authors) {
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = `?author=${encodeURIComponent(author.id)}`; link.dataset.author = author.id;
        link.textContent = (author.display_name || 'Имя отсутствует') + (author.type === 'channel' ? ' · канал' : author.type === 'unknown' ? ' · неизвестный тип' : '');
        const count = document.createElement('span'); count.className = 'count'; count.textContent = ` — ${author.message_count}`;
        li.append(link, count);
        if (!author.display_name || names.get(author.display_name) > 1) {
          const identity = document.createElement('span'); identity.className = 'identity'; identity.textContent = ` (${author.id})`;
          li.append(identity);
        }
        list.append(li);
      }
      app.replaceChildren(heading, list);
      app.dataset.state = 'list'; app.setAttribute('aria-busy', 'false');
      window.scrollTo(0, history.state?.listScroll ?? 0);
      return;
    }
    const author = authors.find(a => a.id === id);
    if (!author || !/^messages\/[A-Za-z0-9_-]+\.json$/.test(author.file)) throw new Error('Автор не найден.');
    document.title = author.display_name || 'Сообщения';
    const back = document.createElement('a'); back.className = 'back'; back.dataset.back = 'true'; back.href = './'; back.textContent = 'К списку';
    const loading = status('Загрузка…');
    app.replaceChildren(back, loading);
    const response = await fetch(author.file, {signal});
    if (!response.ok) throw new Error('Не удалось загрузить сообщения.');
    const data = await response.json();
    if (turn !== generation) return;
    if (data.author.id !== id || data.messages.length !== author.message_count || data.messages.some(m => m.author_id !== author.author_id || m.role !== 'author')) {
      throw new Error('Данные автора не прошли проверку.');
    }
    const feed = document.createElement('section'); feed.className = 'feed';
    app.replaceChildren(back, feed);
    // Append all messages in small frame-sized batches. No virtualization, fixed heights or scroll replacement.
    for (let start = 0; start < data.messages.length; start += 256) {
      if (turn !== generation) return;
      const chunk = document.createDocumentFragment();
      for (const message of data.messages.slice(start, start + 256)) chunk.append(renderMessage(message));
      feed.append(chunk);
      if (start + 256 < data.messages.length) await new Promise(resolve => requestAnimationFrame(resolve));
    }
    if (turn !== generation) return;
    app.dataset.state = 'feed'; app.dataset.author = id; app.dataset.messageCount = String(data.messages.length);
    app.setAttribute('aria-busy', 'false');
  } catch (error) {
    if (turn !== generation || error.name === 'AbortError') return;
    const back = document.createElement('a'); back.href = './'; back.dataset.back = 'true'; back.className = 'back'; back.textContent = 'К списку';
    app.replaceChildren(back, status(error.message || 'Ошибка загрузки.'));
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
