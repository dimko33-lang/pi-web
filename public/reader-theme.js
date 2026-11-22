(() => {
  const root = document.documentElement;
  const key = 'reader.theme';
  let mode;
  try { mode = localStorage.getItem(key); } catch {}
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'reader-theme-icon';
  function apply(value) {
    const dark = value === 'dark';
    root.dataset.readerTheme = value;
    button.textContent = dark ? '☼' : '☾';
    button.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
    button.setAttribute('aria-label', button.title);
  }
  apply(['light','dark'].includes(mode) ? mode : (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  button.onclick = () => {
    apply(root.dataset.readerTheme === 'dark' ? 'light' : 'dark');
    try { localStorage.setItem(key, root.dataset.readerTheme); } catch {}
  };
  document.querySelector('header')?.append(button);
})();
