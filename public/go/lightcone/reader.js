// Only application-created links are navigable. Archived text is never parsed as HTML.
const reader = document.querySelector('#reader');
const element = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
async function load(key) {
  const response = await fetch(`/go/lightcone/data/${key}.json`, {cache:'no-store'});
  if (!response.ok) throw Error(response.status === 401 ? 'Sign in to read the archive.' : 'Archive unavailable.');
  return response.json();
}
async function show() {
  const index = await load('index'); const id = new URL(location.href).searchParams.get('author');
  if (!id) {
    const list = document.createElement('ul');
    for (const {id,name,count} of index) {
      const link = element('a', `${name} · ${count}`); link.href = `?author=${encodeURIComponent(id)}`;
      const li = document.createElement('li'); li.append(link); list.append(li);
    }
    reader.replaceChildren(element('h1','Authors'), index.length ? list : element('p','No archived messages yet.')); return;
  }
  const author = index.find(a => a.id === id);
  if (!author || !/^(user|channel)[0-9]+$/.test(id)) throw Error('Author not found.');
  const messages = await load(id); let oldest = false, offset = 0;
  const order = element('button','↑  Newest first'); order.className = 'reader-order'; order.type = 'button';
  const feed = document.createElement('section'); const more = element('button','Show more'); more.type = 'button';
  function append() {
    const limit = Math.min(offset+100,messages.length); const fragment = document.createDocumentFragment();
    for (; offset<limit; offset++) {
      const row = messages[oldest ? messages.length-1-offset : offset];
      const post = document.createElement('article'); post.className = 'message';
      const text = element('div',row.text); text.style.whiteSpace='pre-wrap';
      post.append(text,element('small',new Date(row.date*1000).toLocaleString())); fragment.append(post);
    }
    feed.append(fragment); more.hidden = offset>=messages.length;
  }
  order.onclick = () => { oldest=!oldest; order.textContent=oldest?'↓  Oldest first':'↑  Newest first'; offset=0; feed.replaceChildren(); append(); };
  more.onclick=append; reader.replaceChildren(order,element('h1',author.name),feed,more); append();
}
show().catch(error => {reader.textContent = error.message;});
