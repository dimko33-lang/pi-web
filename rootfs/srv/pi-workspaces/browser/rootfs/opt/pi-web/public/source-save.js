(() => {
  'use strict';
  let saving = false;
  function downloadName(disposition) {
    const supplied = disposition?.match(/filename="([^"]+)"/)?.[1];
    const stamp = supplied?.match(/^pi-web-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.tar\.gz$/);
    // Use the archive's creation time, not the browser's clock or download completion time.
    if (supplied && !stamp) return supplied;
    const at = stamp ? new Date(`${stamp[1]}T${stamp[2]}:${stamp[3]}:${stamp[4]}.${stamp[5]}Z`) : new Date();
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at);
    const get = type => parts.find(part => part.type === type).value;
    return `pi-web-project-${get('year')}-${get('month')}-${get('day')}_${get('hour')}-${get('minute')}-${get('second')}.tar.gz`;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'us-save';
  button.textContent = 'Save';
  button.title = 'Download a portable pi-web source backup without conversations or credentials';
  button.addEventListener('click', async () => {
    if (saving) return;
    saving = true;
    button.disabled = true;
    button.textContent = 'Saving…';
    try {
      const response = await fetch('/api/project/download/source', { credentials: 'same-origin' });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Backup download failed.');
      }
      const blob = await response.blob();
      const name = downloadName(response.headers.get('Content-Disposition'));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) { window.PiWebNotice.show(error.message); }
    finally { saving = false; button.disabled = false; button.textContent = 'Save'; }
  });
  function mount() {
    const usage = document.getElementById('chatUsage');
    const model = usage?.querySelector('.us-model');
    if (model && button.parentNode !== usage) usage.insertBefore(button, model);
  }
  new MutationObserver(mount).observe(document.body, { childList: true, subtree: true });
  mount();
})();
