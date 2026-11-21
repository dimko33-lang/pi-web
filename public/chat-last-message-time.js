/* Per-answer UI metadata, never appended to the model's text. */
(function (global) {
  'use strict';
  function create({ feed }) {
    let disposed = false;
    const format = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const tooltip = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'long' });
    /* Measured response duration: request start (agent placeholder) to completion,
       including reasoning and tool execution. */
    function durationText(startAt, endAt) {
      const ms = Number(endAt) - Number(startAt);
      if (!Number.isFinite(ms) || ms < 0) return '';
      const s = Math.max(1, Math.round(ms / 1000));
      if (s < 60) return s + 's';
      const m = Math.floor(s / 60);
      const r = s % 60;
      return m + 'm ' + r + 's';
    }
    function refresh() {
      if (disposed) return;
      const messages = Array.from(feed.children).filter(n => n.classList.contains('cm'));
      for (const message of messages) {
        let marker = message.querySelector('.chat-last-message-time');
        const active = document.body.dataset.sending === '1' && message === messages.at(-1);
        const agent = message.dataset.role === 'agent' || !message.dataset.role;
        let meta;
        try { meta = JSON.parse(message.dataset.responseMeta || 'null'); } catch { meta = null; }
        const at = Number(meta?.completedAt || message.dataset.at);
        const duration = meta?.completedAt ? durationText(message.dataset.at, meta.completedAt) : '';
        if (!agent || active || !Number.isFinite(at) || at <= 0 || !Number.isFinite(new Date(at).getTime())) {
          marker?.remove(); continue;
        }
        if (!marker) { marker = document.createElement('time'); marker.className = 'chat-last-message-time'; }
        const model = String(meta?.model || '').replace(/^[^/]+\//, '');
        const label = [format.format(at), model, meta?.thinking, duration].filter(Boolean).join('  ');
        if (marker.textContent !== label) marker.textContent = label;
        const iso = new Date(at).toISOString();
        if (marker.dateTime !== iso) marker.dateTime = iso;
        const title = tooltip.format(at);
        if (marker.title !== title) marker.title = title;
        if (marker.parentElement !== message || message.lastElementChild !== marker) message.appendChild(marker);
      }
    }
    const observer = new MutationObserver(refresh);
    observer.observe(feed, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['data-at', 'data-role', 'data-response-meta'] });
    const activityObserver = new MutationObserver(refresh);
    activityObserver.observe(document.body, { attributes: true, attributeFilter: ['data-sending'] });
    refresh();
    return { refresh, destroy() {
      disposed = true; observer.disconnect(); activityObserver.disconnect();
      feed.querySelectorAll('.chat-last-message-time').forEach(n => n.remove());
    } };
  }
  global.PiWebLastMessageTime = { create };
})(window);
