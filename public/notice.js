(() => {
  'use strict';
  let dialog;
  const pending = [];
  function showNext() {
    if (!dialog || dialog.open || !pending.length) return;
    dialog.querySelector('.notice-message').textContent = pending.shift();
    dialog.showModal();
  }
  function show(message) {
    pending.push(String(message));
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'pi-web-notice';
      dialog.setAttribute('aria-label', 'Chat notification');
      const text = document.createElement('p');
      text.className = 'notice-message';
      text.id = 'pi-web-notice-message';
      dialog.setAttribute('aria-describedby', text.id);
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = 'Close';
      close.autofocus = true;
      close.addEventListener('click', () => dialog.close());
      dialog.append(text, close);
      dialog.addEventListener('close', showNext);
      document.body.append(dialog);
    }
    showNext();
  }
  window.PiWebNotice = { show };
})();
