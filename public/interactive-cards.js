/* Automatic, isolated previews. Never call the model or mutate project state. */
(() => {
  'use strict';
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none';";
  const cards = new Map();
  let scheduled = false;
  // The opaque frame may report its height, never access the containing page.
  const sizing = `<script>(()=>{let last=0,queued=false;const measure=()=>{queued=false;const h=Math.ceil(Math.max(document.body.scrollHeight,document.body.getBoundingClientRect().height));if(Math.abs(h-last)>1){last=h;parent.postMessage({type:'pi-web-card-height',height:h},'*')}};const queue=()=>{if(!queued){queued=true;requestAnimationFrame(measure)}};new ResizeObserver(queue).observe(document.body);new MutationObserver(queue).observe(document.body,{childList:true,subtree:true,characterData:true});addEventListener('load',queue);queue()})()<\/script>`;
  function start(card) {
    const entry = cards.get(card);
    if (!entry || entry.frame || !card.isConnected) return;
    let source;
    try { source = decodeURIComponent(entry.source); }
    catch { entry.mount.textContent = 'Invalid demo source.'; return; }
    const frame = document.createElement('iframe');
    frame.title = 'Interactive demo';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'");
    frame.referrerPolicy = 'no-referrer';
    frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + policy + '"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{color-scheme:dark;background:transparent}body{margin:0;background:transparent;color:#ddd;font:14px/1.5 system-ui;display:flow-root}*{box-sizing:border-box}svg,canvas{max-width:100%}</style></head><body>' + source + sizing + '</body></html>';
    entry.frame = frame;
    entry.mount.replaceChildren(frame);
  }
  const visibility = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) start(entry.target);
  }, { rootMargin: '300px 0px' }) : null;
  function scan() {
    scheduled = false;
    for (const [card] of cards) {
      if (!card.isConnected) { visibility?.unobserve(card); cards.delete(card); }
    }
    for (const card of document.querySelectorAll('.interactive-card[data-card-source]')) {
      const source = card.dataset.cardSource;
      const prior = cards.get(card);
      if (prior && prior.source === source) continue;
      visibility?.unobserve(card);
      // Handle previously rendered card markup without retaining its old controls.
      card.querySelectorAll(':scope > .interactive-card-head, :scope > details').forEach(node => node.remove());
      let mount = card.querySelector('[data-card-mount]');
      if (!mount) { mount = document.createElement('div'); mount.dataset.cardMount = ''; card.append(mount); }
      mount.replaceChildren();
      cards.set(card, { source, mount, frame: null });
      if (visibility) visibility.observe(card); else start(card);
    }
  }
  function queueScan() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(scan); }
  }
  addEventListener('message', event => {
    if (event.data?.type !== 'pi-web-card-height' || !Number.isFinite(event.data.height)) return;
    for (const { frame } of cards.values()) {
      if (frame && event.source === frame.contentWindow) {
        const height = Math.max(120, Math.min(1000, Math.ceil(event.data.height)));
        if (frame.style.height !== height + 'px') frame.style.height = height + 'px';
        break;
      }
    }
  });
  new MutationObserver(queueScan).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-card-source'] });
  queueScan();
})();
