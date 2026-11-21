/* Tool-returned images remain visible even when tool details are hidden. */
(function (global) {
  'use strict';
  function render(block, tool) {
    const parent = block.parentElement;
    let gallery = Array.from(parent.children).find(node => node.dataset.imageToolId === String(tool.id));
    const images = (tool.images || []).filter(image => /^\/api\/chat\/images\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(image.url || '')).slice(0, 4);
    const signature = JSON.stringify(images);
    if (!images.length) { gallery?.remove(); return; }
    if (gallery?.dataset.signature === signature) return;
    if (!gallery) {
      gallery = document.createElement('div'); gallery.className = 'chat-tool-images';
      gallery.dataset.imageToolId = String(tool.id); block.after(gallery);
    }
    gallery.dataset.signature = signature; gallery.replaceChildren();
    for (const image of images) {
      const figure = document.createElement('figure');
      const label = image.target === 'chat' ? 'Chat screenshot' : 'Tool image';
      const at = Number(image.capturedAt);
      const description = label + (image.source === 'agent-browser' ? ' · Agent browser' : '') +
        (Number.isFinite(at) && at > 0 ? ' · ' + new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(at) : '');
      const link = document.createElement('a'); link.href = image.url; link.target = '_blank'; link.rel = 'noopener';
      link.title = description + ' · Open full-size image'; link.setAttribute('aria-label', link.title);
      const img = document.createElement('img'); img.alt = label; img.loading = 'lazy'; img.decoding = 'async'; img.src = image.url;
      img.onerror = () => { img.remove(); link.textContent = 'Image unavailable. Open the original to check access.'; };
      link.append(img); figure.append(link); gallery.append(figure);
    }
  }
  global.PiWebChatImages = { render };
})(window);
