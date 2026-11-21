(() => {
  let revision = 0;
  let currentModel = null;
  let currentLevel = '';
  let levels = [];
  let control, button, menu;
  let saving = false;
  const style = document.createElement('style');
  style.textContent = '.chat-usage .thinking-control{display:inline-flex;align-items:center;flex:0 0 9ch;width:9ch;gap:4px;margin-left:-4px}.chat-usage .thinking-control[hidden]{display:inline-flex;visibility:hidden;pointer-events:none}.chat-usage .thinking-choice{appearance:none;background:none;border:0;box-shadow:none;color:inherit;font:inherit;padding:2px 0;cursor:pointer;flex:1;min-width:0;text-align:left}.thinking-choice:focus-visible{outline:1px solid currentColor;outline-offset:2px}.thinking-menu{position:fixed;z-index:10020;background:var(--chat-surface,#353536);color:#ddd;border:1px solid var(--chat-surface-border,#4b4b4c);border-radius:9px;padding:5px;min-width:120px;max-height:60dvh;overflow:auto;box-shadow:0 8px 30px #0006}.thinking-menu[hidden]{display:none}.thinking-menu button{display:block;width:100%;border:0;background:none;color:inherit;font:13px/1.5 system-ui;text-align:left;padding:6px 12px;border-radius:5px;cursor:pointer}.thinking-menu button:hover,.thinking-menu button:focus-visible,.thinking-menu button[aria-checked="true"]{background:var(--chat-surface-hover,#414142);outline:none}';
  document.head.append(style);

  function close(focus = false) {
    if (!menu) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (focus) button.focus();
  }
  function place() {
    if (!menu || menu.hidden) return;
    const bounds = button.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(bounds.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(8, bounds.top - menu.offsetHeight - 8) + 'px';
  }
  function open() {
    if (saving || control.hidden) return;
    menu.replaceChildren(...levels.map(level => {
      const item = document.createElement('button');
      item.type = 'button';
      item.textContent = level;
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(level === currentLevel));
      item.onclick = () => choose(level);
      return item;
    }));
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    place();
    (menu.querySelector('[aria-checked="true"]') || menu.firstElementChild)?.focus();
  }
  async function choose(level) {
    const model = currentModel;
    close(true);
    saving = true;
    button.disabled = true;
    revision++;
    try {
      const response = await fetch('/api/chat/thinking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, level }) });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not change reasoning level.');
    } catch (error) { window.PiWebNotice.show(error.message); }
    finally {
      saving = false;
      button.disabled = false;
      window.__paintThinking(currentModel);
    }
  }
  function mount() {
    if (control) return;
    const model = document.querySelector('#chatUsage .us-model');
    if (!model) return;
    control = document.createElement('span');
    control.className = 'thinking-control';
    control.hidden = true;
    const separator = document.createElement('span');
    separator.textContent = '•';
    separator.setAttribute('aria-hidden', 'true');
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'thinking-choice';
    button.setAttribute('aria-label', 'Reasoning level');
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'thinkingMenu');
    menu = document.createElement('div');
    menu.id = 'thinkingMenu';
    menu.className = 'thinking-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Reasoning level');
    menu.hidden = true;
    document.body.append(menu);
    button.onclick = event => { event.stopPropagation(); if (menu.hidden) open(); else close(); };
    button.onkeydown = event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(); } };
    menu.onkeydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
      if (event.key === 'Tab') { close(); return; }
      const items = [...menu.querySelectorAll('button')];
      let index = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown') index = (index + 1) % items.length;
      else if (event.key === 'ArrowUp') index = (index - 1 + items.length) % items.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = items.length - 1;
      else return;
      event.preventDefault(); items[index]?.focus();
    };
    document.addEventListener('click', event => { if (!menu.contains(event.target) && !button.contains(event.target)) close(); });
    addEventListener('resize', place);
    control.append(separator, button);
    model.after(control);
  }
  window.__paintThinking = async model => {
    mount();
    if (!control) return;
    if (currentModel !== model) { currentModel = model; control.hidden = true; close(); }
    const version = ++revision;
    if (!model || saving) return;
    try {
      const response = await fetch('/api/chat/thinking', { cache: 'no-store' });
      if (!response.ok) return;
      const state = await response.json();
      if (version !== revision || state.model !== currentModel) return;
      if (JSON.stringify(levels) !== JSON.stringify(state.levels) || currentLevel !== state.level) close();
      levels = state.levels;
      currentLevel = state.level;
      button.textContent = currentLevel;
      control.hidden = levels.length < 2;
    } catch { /* Preserve the last confirmed preference when offline. */ }
  };
})();
