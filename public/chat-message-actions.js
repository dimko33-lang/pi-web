/* Message actions own only controls and deletion anchoring, never streamed content. */
window.PiWebMessageActions = {
  create({ feed, busy }) {
    const style = document.createElement('style');
    style.textContent = `.chat-msgs .cm{position:relative;padding-right:42px!important}.cm-delete{position:absolute;right:0;top:0;width:40px;height:40px;padding:0;border:0;background:none;color:currentColor;opacity:.16;font:200 17px system-ui;cursor:pointer;touch-action:manipulation;user-select:none;-webkit-user-select:none}.cm-delete:hover,.cm-delete:focus-visible{opacity:.65}.cm-delete:active{opacity:.8}.cm-delete:disabled{opacity:.07;cursor:default}.cm-undo{position:fixed;bottom:75px;left:50%;transform:translateX(-50%);z-index:9999;background:#252932;color:#ddd;border:1px solid #454b55;border-radius:9px;padding:8px 14px;font:13px system-ui;cursor:pointer}.cm-undo[hidden]{display:none}`;
    document.head.append(style);
    const undoButton = document.createElement('button');
    undoButton.className = 'cm-undo'; undoButton.textContent = 'Undo delete'; undoButton.hidden = true;
    document.body.append(undoButton);
    const stack = [];
    let timer, active = false;
    const api = { get pending() { return active; } };
    const showUndo = () => {
      clearTimeout(timer); undoButton.hidden = !stack.length;
      timer = setTimeout(() => { undoButton.hidden = true; }, 10000);
    };
    const request = async (path, body) => {
      const response = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw Error(data.error || 'Message action failed.');
      return data;
    };
    function decorate() {
      for (const row of feed.querySelectorAll('.cm')) {
        if (!['me', 'agent'].includes(row.dataset.role)) continue;
        let button = row.querySelector(':scope > .cm-delete');
        if (!button) {
          button = document.createElement('button'); button.className = 'cm-delete';
          button.textContent = '×'; button.title = 'Delete message'; button.setAttribute('aria-label', 'Delete message');
          row.append(button);
        }
        const disabled = busy() || active;
        if (button.disabled !== disabled) button.disabled = disabled;
      }
    }
    new MutationObserver(decorate).observe(feed, { childList: true, subtree: true });
    new MutationObserver(decorate).observe(document.body, { attributes: true, attributeFilter: ['data-sending'] });
    feed.addEventListener('click', async event => {
      const button = event.target.closest?.('.cm-delete');
      if (!button || !feed.contains(button) || active || busy()) return;
      event.preventDefault(); event.stopPropagation();
      const row = button.closest('.cm');
      active = true; decorate();
      try {
        const capability = await fetch('/api/chat/msg/deletion-capability', { cache: 'no-store', credentials: 'same-origin' });
        if (!capability.ok || !(await capability.json()).contextUndo) throw Error('Restart pi-web to enable message actions.');
        const data = await request('/api/chat/msg/delete', { at: Number(row.dataset.at), role: row.dataset.role });
        // Measure after the request, in case the user scrolled while it was in flight.
        const y = button.getBoundingClientRect().top;
        const next = row.nextElementSibling;
        const nextButton = next?.querySelector(':scope > .cm-delete');
        const scroll = feed.scrollTop;
        stack.push({ row, next, token: data.undoToken, scroll, padding: feed.style.paddingBottom });
        // Near the bottom, temporary padding prevents scroll clamping from moving the target.
        const gap = nextButton ? Math.max(0, nextButton.getBoundingClientRect().top - y) : 0;
        const oldPadding = parseFloat(getComputedStyle(feed).paddingBottom) || 0;
        const needed = Math.max(0, scroll - (feed.scrollHeight - feed.clientHeight - gap));
        if (needed) feed.style.paddingBottom = (oldPadding + needed) + 'px';
        row.remove();
        if (nextButton) feed.scrollTop += nextButton.getBoundingClientRect().top - y;
        showUndo();
      } catch (error) { window.PiWebNotice.show(error.message); }
      finally { active = false; decorate(); }
    });
    async function undo() {
      if (active || busy() || !stack.length) return;
      active = true; decorate();
      const item = stack.at(-1);
      try {
        await request('/api/chat/msg/restore', { token: item.token });
        stack.pop();
        feed.insertBefore(item.row, item.next?.parentNode === feed ? item.next : null);
        feed.style.paddingBottom = item.padding;
        feed.scrollTop = item.scroll;
        showUndo();
      } catch (error) { window.PiWebNotice.show(error.message); }
      finally { active = false; decorate(); }
    }
    undoButton.onclick = undo;
    document.addEventListener('keydown', event => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== 'z' || !stack.length) return;
      if (event.target.closest?.('input, textarea, [contenteditable], iframe')) return;
      if (busy() || active) return;
      event.preventDefault(); undo();
    });
    // Replacing the transcript means a session switch or a reload: old DOM anchors are invalid.
    api.reset = () => { stack.length = 0; undoButton.hidden = true; feed.style.paddingBottom = ''; };
    decorate();
    return api;
  }
};
