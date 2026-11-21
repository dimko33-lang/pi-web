let nextPickerId = 0;

// Native selects own form values; one presentation serves Model, Thinking and Replies.
export function createProfilePicker(select) {
  select.hidden = true;
  const container = select.parentElement;
  const label = select.getAttribute('aria-label') || select.name;
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'profile-picker-trigger'; button.dataset.field = select.name;
  button.setAttribute('role', 'combobox'); button.setAttribute('aria-label', label);
  if (select.hasAttribute('aria-describedby')) button.setAttribute('aria-describedby', select.getAttribute('aria-describedby'));
  button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false');
  const list = document.createElement('div');
  list.id = 'profile-options-' + ++nextPickerId;
  list.className = 'profile-picker-list'; list.dataset.field = select.name;
  list.hidden = true; list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', label + ' options'); button.setAttribute('aria-controls', list.id);
  container.append(button, list);
  let focused = -1;
  const options = () => [...list.children];
  const close = () => {
    list.hidden = true; button.setAttribute('aria-expanded', 'false'); button.removeAttribute('aria-activedescendant');
  };
  const highlight = index => {
    const items = options();
    if (!items.length) return;
    focused = Math.max(0, Math.min(items.length - 1, index));
    items.forEach((item, position) => item.classList.toggle('is-focused', position === focused));
    button.setAttribute('aria-activedescendant', items[focused].id);
    items[focused].scrollIntoView({ block: 'nearest' });
  };
  const choose = index => {
    const option = select.options[index];
    if (!option || option.disabled || select.disabled) return;
    select.value = option.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    refresh(); close(); button.focus();
  };
  function refresh() {
    button.disabled = select.disabled || !select.options.length;
    button.textContent = select.selectedOptions[0]?.textContent || 'Loading...';
    list.replaceChildren(...[...select.options].map((option, index) => {
      const item = document.createElement('button');
      item.type = 'button'; item.tabIndex = -1; item.className = 'profile-picker-option';
      item.id = list.id + '-' + index; item.textContent = option.textContent;
      item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(option.selected));
      item.disabled = option.disabled;
      item.addEventListener('click', () => { choose(index); });
      return item;
    }));
    if (button.disabled) close();
  }
  const open = () => {
    if (button.disabled) return;
    // Always anchor below the field, regardless of the selected option or OS menu rules.
    list.style.maxHeight = Math.max(80, Math.min(240, innerHeight - button.getBoundingClientRect().bottom - 12)) + 'px';
    list.hidden = false; button.setAttribute('aria-expanded', 'true');
    highlight(select.selectedIndex);
  };
  button.addEventListener('click', () => { if (list.hidden) open(); else close(); });
  button.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'Tab') { close(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (list.hidden) { open(); return; }
      highlight(event.key === 'Home' ? 0 : event.key === 'End' ? options().length - 1 : focused + (event.key === 'ArrowDown' ? 1 : -1));
    } else if ((event.key === 'Enter' || event.key === ' ') && !list.hidden) {
      event.preventDefault(); choose(focused);
    }
  });
  document.addEventListener('pointerdown', event => { if (!container.contains(event.target)) close(); });
  button.addEventListener('blur', event => { if (!container.contains(event.relatedTarget)) close(); });
  new MutationObserver(refresh).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'selected'] });
  new MutationObserver(() => { if (container.closest('section')?.hidden) close(); }).observe(container.closest('section'), { attributes: true, attributeFilter: ['hidden'] });
  select.addEventListener('change', refresh);
  refresh();
  return { close, refresh };
}
