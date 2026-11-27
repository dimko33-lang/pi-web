/* Browser presence: peer state, Live camera following and SVG-world cursors.
   See docs/CODE-MAP.md for coordinate and collaboration contracts. */
(function () {
  if (window.__presence) return;
  window.__presence = true;

  /* ---------- КТО Я ---------- */
  const KEY_WHO = 'curvelab.who';
  const KEY_CID = 'curvelab.cid';

  function readWho() {
    try {
      const u = new URL(location.href);
      const q = (u.searchParams.get('as') || '').trim();
      if (q) {
        try { localStorage.setItem(KEY_WHO, q); } catch (e) {}
        try {
          u.searchParams.delete('as');
          history.replaceState(null, '', u.toString());
        } catch (e) {}
        return q;
      }
      return localStorage.getItem(KEY_WHO) || '';
    } catch (e) { return ''; }
  }

  function readCid() {
    try {
      let c = localStorage.getItem(KEY_CID);
      if (!c) {
        c = 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        localStorage.setItem(KEY_CID, c);
      }
      return c;
    } catch (e) { return 'c0'; }
  }

  /* ИМЯ БОЛЬШЕ НЕ НУЖНО: одна общая ссылка, без ?as=.
     Идентификатор браузера (CID) — единственное, что различает людей. */
  const WHO = readWho() || 'guest';
  const CID = readCid();

  /* ---------- СОСТОЯНИЕ ---------- */
  let panel = '';          // 'layers' | '' | 'menu' | 'resume' | 'files'
  let tool = '';           // 'curve' | 'rect' | ...
  let cursor = null;       // { x, y } в процентах
  let sharing = false;     // This browser presents its camera and cursor.
  let leaderCid = null;    // кто сейчас ведёт (cid)
  let leadBusy = false;    // идёт запрос захвата

  /* Захват НЕ запоминаем между заходами: кто первый нажал — тот ведёт. */
  try { localStorage.removeItem('curvelab.shareCursor'); } catch (e) {}

  /* Вид холста: { x, y, w, h }. Есть только в редакторе. */
  function readView() {
    try {
      return (typeof window.__cvGetView === 'function') ? window.__cvGetView() : null;
    } catch (e) { return null; }
  }

  function send() {
    try {
      fetch('api/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        keepalive: true,
        body: JSON.stringify({
          cid: CID, who: WHO, panel, tool,
          view: readView(),
          cursor: (sharing && leaderCid === CID) ? cursor : null,
        }),
      }).catch(() => {});
    } catch (e) {}
  }

  /* ---------- СЛОЙ ДЛЯ ЧУЖИХ КУРСОРОВ ---------- */
  const SVG_MAC = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="24" viewBox="0 0 18 24">
    <path d="M1 1 L1 18.5 L5.2 14.6 L8.1 21.4 L11.2 20.1 L8.3 13.4 L14 13.4 Z"
          fill="currentColor" stroke="#0b0e12" stroke-width="1.2" stroke-linejoin="round"/>
  </svg>`;

  let layer = null;
  function ensureLayer() {
    if (layer || !document.body) return layer;
    layer = document.createElement('div');
    layer.id = 'presenceLayer';
    layer.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:99999;overflow:hidden';
    document.body.appendChild(layer);
    return layer;
  }

  const arrows = new Map();

  function makeArrow(cid) {
    let a = arrows.get(cid);
    if (a) return a;
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;width:18px;height:24px;pointer-events:none;color:#fff;' +
      'transform:translate(-1px,-1px);filter:drop-shadow(0 1px 2px rgba(0,0,0,.6));';
    el.innerHTML = SVG_MAC;
    ensureLayer().appendChild(el);
    arrows.set(cid, el);
    return el;
  }

  let cursorPeers = [];
  function paintCursors(peers) {
    cursorPeers = peers || [];
    const canvas = document.getElementById('canvas');
    const matrix = canvas && canvas.getScreenCTM();
    const bounds = canvas && canvas.getBoundingClientRect();
    const seen = new Set();
    for (const p of peers || []) {
      if (p.cid === CID) continue;
      if (!p.cursor || p.cid !== leaderCid || !matrix || !bounds) continue;
      if (!Number.isFinite(p.cursor.x) || !Number.isFinite(p.cursor.y)) continue;
      const point = canvas.createSVGPoint();
      point.x = p.cursor.x; point.y = p.cursor.y;
      const screen = point.matrixTransform(matrix);
      if (screen.x < bounds.left || screen.x > bounds.right || screen.y < bounds.top || screen.y > bounds.bottom) continue;
      const hit = document.elementFromPoint(screen.x, screen.y);
      if (!hit || !(hit === canvas || canvas.contains(hit))) continue;
      seen.add(p.cid);
      const el = makeArrow(p.cid);
      el.style.left = screen.x + 'px';
      el.style.top = screen.y + 'px';
    }
    for (const [cid, el] of arrows) {
      if (!seen.has(cid)) { el.remove(); arrows.delete(cid); }
    }
  }

  /* ---------- ОБЩИЙ ВИД ХОЛСТА ---------- */
  let lastRemoteView = null;
  let cameraTarget = null;
  let cameraFrame = 0;
  let cameraFrameAt = 0;

  function animateCamera(now) {
    cameraFrame = 0;
    if (!cameraTarget || !leaderCid || leaderCid === CID) {
      cameraTarget = null;
      cameraFrameAt = 0;
      return;
    }
    const current = readView();
    if (!current) { cameraFrameAt = 0; return; }
    const dt = cameraFrameAt ? Math.min(64, now - cameraFrameAt) : 16;
    cameraFrameAt = now;
    const alpha = 1 - Math.exp(-dt / 45);
    const next = {};
    let settled = true;
    for (const k of ['x', 'y', 'w', 'h']) {
      next[k] = current[k] + (cameraTarget[k] - current[k]) * alpha;
      if (Math.abs(cameraTarget[k] - current[k]) > Math.max(0.00001, cameraTarget.w * 0.00001)) settled = false;
    }
    try {
      if (typeof window.__cvSetView === 'function') window.__cvSetView(settled ? cameraTarget : next);
      paintCursors(cursorPeers);
    } catch (e) {}
    if (settled) { cameraTarget = null; cameraFrameAt = 0; }
    else cameraFrame = requestAnimationFrame(animateCamera);
  }

  function applyRemoteView(peers) {
    if (!leaderCid || leaderCid === CID) { lastRemoteView = null; return; }
    let latest = null;
    for (const p of peers || []) {
      if (p.cid !== leaderCid) continue;
      if (!p.view || !['x', 'y', 'w', 'h'].every(k => Number.isFinite(p.view[k])) || p.view.w <= 0 || p.view.h <= 0) continue;
      if (!latest || p.at > latest.at) latest = p;
    }
    if (!latest) return;

    const v = latest.view;
    const key = [v.x, v.y, v.w, v.h].map((n) => Math.round(n * 100) / 100).join(',');
    if (key === lastRemoteView) return;
    lastRemoteView = key;

    cameraTarget = { x: v.x, y: v.y, w: v.w, h: v.h };
    if (!cameraFrame) cameraFrame = requestAnimationFrame(animateCamera);
  }

  /* ---------- ПОВТОР ЧУЖИХ ПАНЕЛЕЙ ---------- */
  let lastRemotePanel = null;
  let echoGuard = false;

  function applyRemotePanel(peers) {
    if (echoGuard) return;

    let latest = null;
    for (const p of peers || []) {
      if (p.cid === CID) continue;
      if (!latest || p.at > latest.at) latest = p;
    }
    if (!latest) return;

    const want = String(latest.panel || '');
    if (want === lastRemotePanel) return;
    lastRemotePanel = want;

    const lp = document.getElementById('layersPanel');
    if (!lp) return;

    setTimeout(() => {
      echoGuard = true;
      try {
        const showLayers = want === 'layers';
        lp.classList.toggle('collapsed', !showLayers);
        document.documentElement.classList.toggle('no-layers', !showLayers);
        const btn = document.getElementById('btnLayers');
        if (btn) btn.classList.toggle('on', showLayers);
        if (typeof handleResize === 'function') handleResize();
      } catch (e) {}
      setTimeout(() => { echoGuard = false; }, 500);
    }, 60);
  }

  /* ---------- КНОПКА live ---------- */
  function ensureLiveButton() {
    /* редактор — своя кнопка в топбаре */
    const edBtn = document.getElementById('btnLive');
    if (edBtn && !edBtn.__wired) {
      edBtn.__wired = true;
      edBtn.addEventListener('click', (ev) => {
        onLiveClick(ev);
      });
    }

    const usage = document.getElementById('chatUsage');
    if (!usage) { paintLive(); return; }
    const eyes = usage.querySelector('.us-eyes');

    let live = usage.querySelector('.us-live');
    if (!live) {
      live = document.createElement('button');
      live.type = 'button';
      live.className = 'us-live';
      live.title = 'show my cursor to others';
      live.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        setSharing(!sharing);
      });
      if (eyes && eyes.parentNode === usage) usage.insertBefore(live, eyes);
      else usage.appendChild(live);
    }
    paintLive();
  }

  /* Кнопка live: просто слово «live». Включено — зелёное. Никаких точек
     и подсказок вроде «User: select» — они мешают. */
  function paintLive() {
    /* три состояния:
       • я веду — зелёное «live»
       • ведёт другой — серое «live», нажать нельзя
       • свободно — блёклое «live» */
    const mine = sharing && leaderCid === CID;
    const busy = !!leaderCid && leaderCid !== CID;
    const label = (liveMsg === 'busy' && !mine) ? 'busy' : 'live';

    const usage = document.getElementById('chatUsage');
    const live = usage && usage.querySelector('.us-live');
    if (live) {
      live.textContent = label;
      live.classList.toggle('on', mine);
      live.disabled = busy;
      live.style.opacity = busy ? '.35' : '';
      live.style.cursor = busy ? 'default' : 'pointer';
    }
    const edBtn = document.getElementById('btnLive');
    if (edBtn) {
      edBtn.textContent = label;
      edBtn.disabled = busy;
      edBtn.style.opacity = busy ? '.35' : '';
      edBtn.style.cursor = busy ? 'default' : 'pointer';
      edBtn.style.color = mine ? '#6fc99a' : 'rgba(200,216,232,.38)';
      edBtn.style.borderColor = mine ? 'rgba(111,201,154,.55)' : 'rgba(53,81,110,.45)';
    }
  }

  /* Нажатие: включить/выключить (если не занято). */
  function onLiveClick(ev) {
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    if (leaderCid && leaderCid !== CID) { toastLive('busy'); return; }
    setSharing(!sharing);
  }

  /* Включить/выключить ведение. Захват один на всех: пока кто-то ведёт,
     остальные нажать не могут — кнопка серая. */
  async function setSharing(on) {
    if (leadBusy) return;
    leadBusy = true;
    try {
      if (on) {
        const r = await fetch('api/presence/take', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ cid: CID }),
        });
        if (r.ok) {
          sharing = true;
          leaderCid = CID;
        } else {
          /* занято другим — показать, что нельзя */
          const d = await r.json().catch(() => ({}));
          leaderCid = d.leader || leaderCid;
          toastLive('busy');
        }
      } else {
        await fetch('api/presence/release', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ cid: CID }),
        }).catch(() => {});
        sharing = false;
        leaderCid = null;
      }
    } catch (e) {
      toastLive('error');
    } finally {
      leadBusy = false;
      paintLive();
      send();
    }
  }

  /* Короткое сообщение, если захват занят. */
  let liveMsg = '';
  let liveMsgTimer = null;
  function toastLive(kind) {
    liveMsg = kind === 'busy' ? 'busy' : 'error';
    paintLive();
    clearTimeout(liveMsgTimer);
    liveMsgTimer = setTimeout(() => { liveMsg = ''; paintLive(); }, 2000);
  }

  /* ---------- ОТРИСОВКА ЧУЖОГО СОСТОЯНИЯ ---------- */
  function render(peers) {
    ensureLiveButton();

    applyEditLock();
    applyRemoteView(peers);
    applyRemotePanel(peers);
    paintCursors(peers);
  }

  /* ---------- ПОТОК ---------- */
  /* Camera presentation is independent of collaborative editing. */
  function applyEditLock() {
    const mine = sharing && leaderCid === CID;
    const busy = !!leaderCid && leaderCid !== CID;
    const svg = document.getElementById('canvas');
    if (!svg) return;
    /* Live controls the camera, never editing permissions. */
    /* не блокируем pointer-events полностью: пусть листают и смотрят,
       но обработчик drag сам проверяет право (см. __cvCanEdit). */
  }

  window.__cvCanEdit = function () {
    return true;
  };

  function watch() {
    try {
      const es = new EventSource('api/presence/watch');
      es.onmessage = (ev) => {
        try {
          const d = JSON.parse(ev.data);
          const peers = Array.isArray(d) ? d : (d.peers || []);
          const lead = Array.isArray(d) ? null : (d.leader || null);
          if (lead !== leaderCid) {
            leaderCid = lead;
            sharing = lead === CID;
            paintLive();
          }
          render(peers);
        } catch (e) { console.error('presence render:', e); }
      };
      es.onerror = () => {
        try { es.close(); } catch (e) {}
        setTimeout(watch, 3000);
      };
    } catch (e) {}
  }

  /* ---------- СЛЕЖЕНИЕ ЗА РЕДАКТОРОМ ---------- */
  const TOOL_NAMES = {
    btnSelect: 'select', btnAdd: 'circle', btnAddRect: 'rect',
    btnAddCurve: 'curve', btnAddCorner: 'corner', btnAddParabola: 'parabola',
    btnAddHyperbola: 'hyperbola', btnAddClothoid: 'clothoid',
    btnAddUser: 'custom', btnLink: 'link', btnFit: 'fit', btnLayers: 'layers',
  };

  function readTool() {
    const rail = document.getElementById('toolrail');
    if (!rail) return '';
    const on = rail.querySelector('.tl-btn.active');
    return on && on.id ? (TOOL_NAMES[on.id] || '') : '';
  }

  function readPanel() {
    const lp = document.getElementById('layersPanel');
    if (!lp) return null;
    return lp.classList.contains('collapsed') ? '' : 'layers';
  }

  let editorWatched = false;

  function watchEditor() {
    const rail = document.getElementById('toolrail');
    const lp = document.getElementById('layersPanel');
    if (editorWatched) return;
    if (rail && lp) editorWatched = true;

    if (rail) {
      rail.addEventListener('click', () => {
        setTimeout(() => { tool = readTool(); send(); }, 30);
      }, true);
      try {
        new MutationObserver(() => {
          const t = readTool();
          if (t !== tool) { tool = t; send(); }
        }).observe(rail, { subtree: true, attributes: true, attributeFilter: ['class'] });
      } catch (e) {}
      tool = readTool();
    }

    if (lp) {
      try {
        new MutationObserver(() => {
          const p2 = readPanel();
          if (p2 !== null && !echoGuard && p2 !== panel) { panel = p2; send(); }
        }).observe(lp, { attributes: true, attributeFilter: ['class'] });
      } catch (e) {}
      const p0 = readPanel();
      if (p0 !== null) panel = p0;
    }
  }

  /* ---------- СТАРТ ---------- */
  function start() {
    ensureLayer();
    ensureLiveButton();
    /* Топбар редактора рисуется позже — пробуем несколько раз. */
    let triesBtn = 0;
    const tb = setInterval(() => {
      ensureLiveButton();
      if (document.getElementById('btnLive') || ++triesBtn > 30) clearInterval(tb);
    }, 200);
    /* Редактор рисует разметку позже — пробуем несколько раз. */
    watchEditor();
    let tries = 0;
    const t = setInterval(() => {
      if (document.getElementById('layersPanel') || ++tries > 20) {
        clearInterval(t);
        watchEditor();
      }
    }, 250);
    send();
    setInterval(send, 5000);
    // Publish at 25 Hz; followers interpolate at the display frame rate.
    let sentView = '';
    setInterval(() => {
      if (!sharing || leaderCid !== CID) { sentView = ''; return; }
      const view = readView();
      if (!view) return;
      const key = JSON.stringify(view);
      if (key === sentView) return;
      sentView = key;
      send();
    }, 40);
    watch();

    window.addEventListener('pagehide', () => {
      try {
        navigator.sendBeacon('api/presence/leave', JSON.stringify({ cid: CID }));
      } catch (e) {}
    });

    /* Send scene coordinates, never window percentages or UI positions. */
    document.addEventListener('pointermove', (ev) => {
      const canvas = document.getElementById('canvas');
      if (!canvas || !(ev.target === canvas || canvas.contains(ev.target))) {
        if (cursor) { cursor = null; send(); }
        return;
      }
      try {
        const matrix = canvas.getScreenCTM();
        if (!matrix) return;
        const point = canvas.createSVGPoint();
        point.x = ev.clientX; point.y = ev.clientY;
        const world = point.matrixTransform(matrix.inverse());
        cursor = { x: world.x, y: world.y };
        if (sharing && leaderCid === CID) send();
      } catch (e) {}
    }, { passive: true });
    document.addEventListener('pointerleave', () => {
      if (cursor) { cursor = null; send(); }
    });
  }

  window.setPresencePanel = function (name) {
    panel = name === undefined ? panel : String(name || '');
    send();
  };
  window.setPresenceTool = function (name) { tool = String(name || ''); send(); };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
