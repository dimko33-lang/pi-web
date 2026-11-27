'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const chatMsgs = $('chatMsgs'), chatInput = $('chatInput');
  if (chatMsgs) window.__responseFooter = window.PiWebLastMessageTime.create({ feed: chatMsgs });

  /* See docs/ARCHITECTURE.md for module ownership and boundaries. */
  (function () {
    try {
      const u = new URL(location.href);
      if (u.searchParams.get('fresh') !== '1') return;
      const drop = [
        'pi-web.popPos', 'pi-web.mPopSize', 'pi-web.chatPopBox',
        'pi-web.settingsW', 'pi-web.chatW', 'pi-web.drawerLeftW',
        'pi-web.chatOpen', 'pi-web.leftOpen', 'pi-web.panelCollapsed',
        'pi-web.inputHidden', 'pi-web.expanded', 'pi-web.wasExpanded',
        'pi-web.filesWin',
      ];
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i) || '';
        if (drop.includes(k) || /^pi-web\.(winSize|winH)\./.test(k)) localStorage.removeItem(k);
      }
      u.searchParams.delete('fresh');
      history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
    } catch (e) {}
  })();

  /* Reset window geometry on load; retain theme, language, prompts and model. */
  (function () {
    try {
      const drop = [
        'pi-web.popPos', 'pi-web.mPopSize', 'pi-web.chatPopBox',
        'pi-web.settingsW', 'pi-web.chatW', 'pi-web.drawerLeftW',
        'pi-web.chatOpen', 'pi-web.leftOpen',
        'pi-web.inputHidden', 'pi-web.expanded', 'pi-web.wasExpanded',
        'pi-web.filesWin',
      ];
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i) || '';
        if (drop.includes(k) || /^pi-web\.(winSize|winH)\./.test(k)) localStorage.removeItem(k);
      }
    } catch (e) {}
  })();

  /* ============================================================
     TOAST
     ============================================================ */
  /* Notification rendering is disabled; retain the no-op for existing callers. */
  function toast(text) {
    /* Intentionally no notification DOM or output. */
    try { if (text) console.debug('[pi-web]', text); } catch (e) {}
    return;
  }

  /* Server-pushed source changes. */
  function watch() {
    let es;
    try { es = new EventSource('/api/watch'); } catch (e) { return; }
    /* Reload changed assets while preserving the unsent draft. */
    es.addEventListener('shell', () => {
      // Never interrupt a live response to install UI changes.
      // Updated UI is applied on the next manual page reload.
      document.body.dataset.uiUpdateAvailable = '1';
    });

    /* Synchronize the shared transcript across connected clients. */
    es.addEventListener('chat', (ev) => {
      let reason = '', text = '';
      try {
        const d = JSON.parse(ev.data) || {};
        reason = d.reason || '';
        text = d.text || '';
      } catch (e) {}
      /* Avoid rerendering our own in-flight turn. */
      if (document.body.dataset.sending === '1' || window.__chatMessageActions?.pending) return;
      if (typeof loadChat === 'function') loadChat();
    });
  }

  const dChat = $('drawerChat');
  /* Mobile keyboards may shrink only visualViewport. Apply the difference
     to the chat bottom inset through --kb and body.kb-open. */
  (function watchKeyboard() {
    const vv = window.visualViewport;
    if (!vv) return;

    let last = -1;

    const sync = () => {
      /* Include offsetTop because iOS Safari may shift visualViewport upward. */
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      if (kb === last) return;              // Skip unchanged viewport measurements.
      last = kb;
      document.documentElement.style.setProperty('--kb', kb + 'px');
      document.body.classList.toggle('kb-open', kb > 80);
      /* Keep the latest message above the composer. */
      if (kb > 80) {
        const feed = document.getElementById('chatFeed') || document.querySelector('.chat-feed');
        if (feed) feed.scrollTop = feed.scrollHeight;
        /* Keep the input visible. */
        const ta = document.querySelector('.chat-in textarea');
        if (ta && typeof ta.scrollIntoView === 'function') {
          try { ta.scrollIntoView({ block: 'nearest' }); } catch (e) {}
        }
      }
    };

    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);

    /* Safari may omit the first keyboard resize event; also handle focus. */
    document.addEventListener('focusin', (e) => {
      if (!e.target || !e.target.matches || !e.target.matches('textarea, input')) return;
      setTimeout(sync, 60);
      setTimeout(sync, 320);
    }, true);
    document.addEventListener('focusout', () => setTimeout(sync, 60), true);

    sync();
  })();

  /* Escape leaves fullscreen chat. */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('chat-focus')) {
      document.body.classList.remove('chat-focus');
    }
  });
  /* Chat settings belong to the control panel, not a connected project. */
  const tbToggles = $('tbToggles');
  const tgMemory = $('tgMemory');
  const tgMem100 = $('tgMem100');
  const tgMem200 = $('tgMem200');
  const tgMemHist = $('tgMemHist');
  const tgMemNew = $('tgMemNew');
  const tgPrompt = $('tgPrompt');
  const tgCustom = $('tgCustom');
  const tgChar = $('tgChar');
  const tgTail = { piwep: $('tgTailPiwep'), debri: $('tgTailDebri'),
    lightcone: $('tgTailLightcone'), direct: $('tgTailDirect') };
  const TAIL_FIELDS = { piwep: 'tailPiwep', debri: 'tailDebri', lightcone: 'tailLightcone', direct: 'tailDirect' };
  const tgRoot = $('tgRoot');
  const pmptSheet = $('pmptSheet');
  const pmptText = $('pmptText');
  const pmptHint = $('pmptHint');

  /* Browser preferences supplement the authoritative server settings. */
  const TK = 'chat';
  const K_MEM = 'pi-web.agentMemory.' + TK;
  const K_PROMPT = 'pi-web.agentPrompt.' + TK;
  const K_CUSTOM = 'pi-web.agentCustomPrompt.' + TK;
  const K_CHAR = 'pi-web.agentCharacter.' + TK;
  const K_ROOT = 'pi-web.agentRoot.' + TK;
  function flag(key, def = true) {
    try { const v = localStorage.getItem(key); return v === null ? def : v === '1'; }
    catch (e) { return def; }
  }
  function setFlag(key, v) {
    try { localStorage.setItem(key, v ? '1' : '0'); } catch (e) {}
  }

  let agentMemory = flag(K_MEM);
  let agentMemLimit = 200;
  let agentMemResetAt = 0;
  let agentPrompt = flag(K_PROMPT);
  /* Custom instructions are independent of the saved-character switch. */
  let agentCustomOn = true;
  let agentCustom = '';
  try { agentCustom = localStorage.getItem(K_CUSTOM) || ''; } catch (e) {}
  /* System activates the saved shared character without deleting it. */
  let agentChar = '';
  try { agentChar = localStorage.getItem(K_CHAR) || ''; } catch (e) {}
  /* Tail notes: appended to the very end of each Telegram request, per chat. */
  let agentTail = { piwep: '', debri: '', lightcone: '', direct: '' };
  let agentTailOn = { piwep: true, debri: true, lightcone: true, direct: true };
  /* Active instruction editor: custom, char, or a tail note target. */
  let pmptMode = 'custom';

  /* Fail closed until the server reports actual administration capability. */
  let agentRoot = false;
  let rootAvailable = false;
  let rootBusy = false;
  let rootSaving = false;

  function applyExecutionState(d) {
    if (d.settings) {
      agentPrompt = d.settings.systemPrompt !== false;
      agentChar = String(d.settings.character || '');
      agentCustom = String(d.settings.customPrompt || '');
      agentCustomOn = d.settings.customOn !== false;
      agentTail = { piwep: String(d.settings.tailPiwep || ''), debri: String(d.settings.tailDebri || ''),
        lightcone: String(d.settings.tailLightcone || ''), direct: String(d.settings.tailDirect || '') };
      agentTailOn = { piwep: d.settings.tailPiwepOn !== false, debri: d.settings.tailDebriOn !== false,
        lightcone: d.settings.tailLightconeOn !== false, direct: d.settings.tailDirectOn !== false };
      agentMemory = d.settings.memory !== false;
      agentMemLimit = Number(d.settings.memoryLimit) === 100 ? 100 : 200;
      agentMemResetAt = Number(d.settings.memoryResetAt) || 0;
    }
    rootAvailable = d.capabilities?.root === true;
    agentRoot = rootAvailable && d.settings?.root === true;
    if (typeof d.busy === 'boolean') rootBusy = d.busy;
    setFlag(K_ROOT, agentRoot);
    paintToggles();
  }

  function paintToggles() {
    if (tgMemory) tgMemory.classList.toggle('on', agentMemory);
    if (tgMem100) tgMem100.classList.toggle('on', agentMemLimit === 100);
    if (tgMem200) tgMem200.classList.toggle('on', agentMemLimit === 200);
    /* history lights up only while the retained conversation is actually attached. */
    if (tgMemHist) tgMemHist.classList.toggle('on', agentMemResetAt === 0);
    if (tgPrompt) tgPrompt.classList.toggle('on', agentPrompt);
    for (const [button, text, enabled] of [[tgCustom, agentCustom, agentCustomOn], [tgChar, agentChar, agentPrompt]]) {
      if (!button) continue;
      const active = enabled && !!text.trim();
      button.classList.toggle('on', active);
      button.setAttribute('aria-pressed', String(active));
      button.title = (active ? 'On' : 'Off') + ' · Click to toggle; hold or press F2 to edit';
    }
    for (const key of Object.keys(agentTail)) {
      if (tgTail[key]) {
        const active = agentTailOn[key] && !!agentTail[key].trim();
        tgTail[key].classList.toggle('on', active);
        tgTail[key].title = !agentTail[key].trim() ? 'Tap to edit a tail note (long press or empty)'
          : active ? 'Tail note ON — tap to pause, long press to edit'
          : 'Tail note OFF — tap to enable, long press to edit';
      }
    }
    if (tgRoot) {
      tgRoot.title = !rootAvailable ? 'Root unavailable in this workspace; tools remain enabled'
        : rootBusy ? 'Root cannot change during an active task'
        : agentRoot ? 'Root on: full server administration' : 'Root off: workspace permissions; tools enabled';
      tgRoot.disabled = !rootAvailable || rootBusy || rootSaving;
      tgRoot.setAttribute('aria-pressed', String(agentRoot));
      tgRoot.classList.toggle('on', agentRoot);
    }
  }

  /* Populate the instruction editor from the saved value. */
  function openPmpt(mode) {
    if (!pmptSheet) return;
    pmptMode = mode;
    if (pmptText) pmptText.placeholder = pmptMode === 'char'
      ? 'Browser character'
      : pmptMode === 'custom'
        ? 'Browser custom instructions'
        : 'Tail note — appended to the very end of each request in this chat only';
    pmptSheet.hidden = false;
    if (pmptText) {
      pmptText.value = pmptMode === 'char' ? agentChar
        : pmptMode === 'custom' ? agentCustom
        : (agentTail[pmptMode.replace('tail-', '')] || '');
    }
    updatePmptHint();
    requestAnimationFrame(() => pmptSheet.classList.add('show'));
    if (pmptText) { pmptText.focus(); pmptText.setSelectionRange(0, 0); }
  }
  function closePmpt() {
    if (!pmptSheet) return;
    pmptSheet.classList.remove('show');
    setTimeout(() => { pmptSheet.hidden = true; }, 240);
  }
  function updatePmptHint() {
    if (!pmptHint) return;
    const n = (pmptText?.value || '').trim().length;
    const isTail = pmptMode.startsWith('tail-');
    pmptHint.textContent = !n
      ? (isTail ? 'empty → no tail note' : pmptMode === 'char' ? 'empty → no character' : 'empty → no prompt')
      : (n + ' chars — ' + (isTail ? 'appended at the very end of this chat\u2019s requests'
        : (pmptMode === 'char' ? agentPrompt : agentCustomOn) ? 'enabled' : 'paused'));
  }
  if (pmptText) pmptText.addEventListener('input', updatePmptHint);
  if ($('pmptClose')) $('pmptClose').onclick = closePmpt;
  try { const _ps = $('pmptSheet'); if (_ps && typeof makeResizable === 'function') makeResizable(_ps, 180, 120, undefined, true); } catch (e) {}
  if ($('pmptClear')) $('pmptClear').onclick = () => {
    if (pmptText) pmptText.value = '';
    updatePmptHint();
    pmptText && pmptText.focus();
  };
  if ($('pmptApply')) $('pmptApply').onclick = () => {
    if (pmptMode.startsWith('tail-')) {
      const key = pmptMode.replace('tail-', '');
      agentTail[key] = (pmptText?.value || '');
      saveSettingsNow(undefined, { [TAIL_FIELDS[key]]: agentTail[key] });
      paintToggles();
      closePmpt();
      return;
    }
    if (pmptMode === 'char') {
      agentChar = (pmptText?.value || '');
      try { localStorage.setItem(K_CHAR, agentChar); } catch (e) {}
      saveSettingsNow(undefined, { character: agentChar });
      paintToggles();
      closePmpt();
      return;
    }
    agentCustom = (pmptText?.value || '');
    try { localStorage.setItem(K_CUSTOM, agentCustom); } catch (e) {}
    saveSettingsNow(undefined, { customPrompt: agentCustom });
    paintToggles();
    closePmpt();
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pmptSheet && pmptSheet.classList.contains('show')) closePmpt();
  });

  async function saveSettingsNow(root, patch = {}) {
    try {
      const r = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          personalitySchema: 1, ...patch,
          ...(root === undefined ? {} : { root })
        })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save settings');
      applyExecutionState(d);
      toast(patch.memory === undefined ? 'Saved for the browser chat'
        : agentMemory ? 'Memory on: new conversation, previous context stays excluded'
        : 'Memory off: no conversation history or ambient background; enabling starts fresh');
      return true;
    } catch (e) {
      toast(e.message || 'Could not save settings');
      await loadSettings();
      return false;
    }
  }

  /* CHAT SETTINGS: restore server-side model and workspace preferences. */
  async function loadSettings() {

    try {
      const r = await fetch('/api/settings', { credentials: 'same-origin' });
      if (!r.ok) return false;                        // Keep the local cache if the server rejects access.
      const d = await r.json();
      applyExecutionState(d);
      /* Initialize missing server settings from this browser exactly once. */
      if (!d.exists) { await saveSettingsNow(); return true; }
      const s = d.settings || {};
      /* Resolve server-owned settings. */
      const srvCustom = String(s.customPrompt || '');
      const srvChar = String(s.character || '');
      const hadLocal = !!agentCustom.trim() || !!agentChar.trim();
      /* An empty server value is authoritative; do not resurrect cleared prompts. */
      if (s.customPrompt !== undefined) agentCustom = srvCustom;
      if (s.character !== undefined) agentChar = srvChar;
      agentMemory = s.memory !== false;
      agentPrompt = s.systemPrompt !== false;
      agentRoot = rootAvailable && s.root === true;
      try {
        localStorage.setItem(K_CUSTOM, agentCustom);
        localStorage.setItem(K_CHAR, agentChar);
      } catch (e) {}
      setFlag(K_MEM, agentMemory);
      setFlag(K_PROMPT, agentPrompt);
      setFlag(K_ROOT, agentRoot);
      paintToggles();
      /* Never write stale browser prompts back over cleared server values. */
      return true;
    } catch (e) { return false; }
  }
  loadSettings();
  async function syncExecutionState() {
    if (rootSaving) return;
    try {
      const r = await fetch('/api/settings', { credentials: 'same-origin' });
      if (!r.ok) throw new Error('Execution state unavailable');
      applyExecutionState(await r.json());
    } catch {
      rootAvailable = false;
      agentRoot = false;
      paintToggles();
    }
  }
  setInterval(() => { if (!document.hidden) syncExecutionState(); }, 4000);
  window.addEventListener('focus', syncExecutionState);
  new MutationObserver(() => {
    if (document.body.dataset.sending === '1') rootBusy = true;
    else syncExecutionState();
    paintToggles();
  }).observe(document.body, { attributes: true, attributeFilter: ['data-sending'] });

  /* Execution settings: custom, character, memory, system and root. */
  let modesBound = false;

  function bindModeHandlers() {
    if (modesBound) return;
    modesBound = true;

    if (tgMemory) tgMemory.onclick = () => {
      agentMemory = !agentMemory;
      setFlag(K_MEM, agentMemory);
      saveSettingsNow(undefined, { memory: agentMemory });
      paintToggles();
    };

    function bindInstruction(button, mode) {
      if (!button) return;
      let timer, held = false, saving = false;
      const cancel = () => clearTimeout(timer);
      button.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0) return;
        cancel(); held = false;
        timer = setTimeout(() => { held = true; openPmpt(mode); }, 550);
      });
      for (const name of ['pointerup', 'pointerleave', 'pointercancel']) button.addEventListener(name, cancel);
      window.addEventListener('blur', cancel);
      button.addEventListener('contextmenu', event => event.preventDefault());
      button.addEventListener('keydown', event => {
        if (event.key === 'F2') { event.preventDefault(); openPmpt(mode); }
      });
      button.onclick = async event => {
        if (held && event.detail !== 0) { held = false; return; }
        if (saving) return;
        const custom = mode === 'custom';
        if (!(custom ? agentCustom : agentChar).trim()) { toast('No text yet. Hold the button or press F2 to edit.'); return; }
        saving = true;
        try { await saveSettingsNow(undefined, custom ? { customOn: !agentCustomOn } : { systemPrompt: !agentPrompt }); }
        finally { saving = false; }
      };
    }
    bindInstruction(tgCustom, 'custom');
    bindInstruction(tgChar, 'char');

    for (const key of Object.keys(tgTail)) {
      const button = tgTail[key];
      if (!button) continue;
      let hold = null, long = false;
      const clear = () => { if (hold) { clearTimeout(hold); hold = null; } };
      button.addEventListener('pointerdown', (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        long = false;
        clear();
        hold = setTimeout(() => {
          long = true;
          openPmpt('tail-' + key);
        }, 550);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(name =>
        button.addEventListener(name, clear));
      button.addEventListener('pointerup', async () => {
        if (long) return;
        clear();
        if (!agentTail[key].trim()) { openPmpt('tail-' + key); return; }
        agentTailOn[key] = !agentTailOn[key];
        paintToggles();
        const ok = await saveSettingsNow(undefined, { [TAIL_FIELDS[key] + 'On']: agentTailOn[key] });
        if (!ok) await loadSettings();
        else toast(agentTailOn[key] ? 'Tail note ON: applied at the end of requests' : 'Tail note OFF');
      });
      button.addEventListener('click', (event) => event.preventDefault());
    }

    if (tgRoot) tgRoot.onclick = async () => {
      if (!rootAvailable || rootBusy || rootSaving) return;
      rootSaving = true;
      paintToggles();
      const saved = await saveSettingsNow(!agentRoot);
      rootSaving = false;
      paintToggles();
      if (saved) toast(agentRoot
        ? 'Root on — full server administration'
        : 'Root off — workspace permissions; tools remain enabled');
      else await syncExecutionState();
    };

    const setWindow = async (limit) => {
      agentMemLimit = limit;
      paintToggles();
      if (!await saveSettingsNow(undefined, { memoryLimit: limit })) await loadSettings();
      else toast('Reading the last ' + limit + ' messages');
    };
    if (tgMem100) tgMem100.onclick = () => setWindow(100);
    if (tgMem200) tgMem200.onclick = () => setWindow(200);
    if (tgMemNew) tgMemNew.onclick = async () => {
      try {
        const r = await fetch('/api/memory/new', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin', body: '{}' });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Could not start a new context');
        toast('New context: the next reply starts from scratch');
        await loadSettings();
      } catch (e) { toast(e.message || 'Could not start a new context'); }
    };
    if (tgMemHist) tgMemHist.onclick = async () => {
      try {
        const r = await fetch('/api/memory/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin', body: '{}' });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Could not restore history');
        toast('History restored: the retained conversation is used again');
        await loadSettings();
      } catch (e) { toast(e.message || 'Could not restore history'); }
    };

    if (tgPrompt) tgPrompt.onclick = () => {
      agentPrompt = !agentPrompt;
      setFlag(K_PROMPT, agentPrompt);
      saveSettingsNow(undefined, { systemPrompt: agentPrompt });
      paintToggles();
    };
  }

  function showModes() {
    if (!tbToggles) return;
    tbToggles.hidden = false;
    bindModeHandlers();
    paintToggles();
  }
  showModes();
  document.body.classList.add('chat-app');

  async function resetChatNow() {
    
    if (chatMsgs) chatMsgs.textContent = '';
    if (chatInput) { chatInput.value = ''; chatInput.style.height = 'auto'; chatInput.focus(); }
    try {
      const r = await fetch('/api/chat/reset', { method: 'POST', credentials: 'same-origin' });
      if (r.ok) {
        toast('New chat');
        if (typeof loadChat === 'function') loadChat();
      } else {
        const d = await r.json().catch(() => ({}));
        toast(d.error || 'Could not start a new chat');
      }
    } catch (e) {
      /* Local state is already cleared if the server is unavailable. */
      toast('New chat');
    }
  }

  /* Persisted reasoning display mode: hide, show or open. */
  const K_THINK = 'pi-web.thinkMode.chat';
  let thinkMode = 'show';
  try { thinkMode = localStorage.getItem(K_THINK) || 'show'; } catch (e) {}

  /* Chat action menu. */
(function () {
  const pop = $('chatPop'), plus = $('chatPlus');
  const thinkLbl = $('chatPopThink');
  if (!pop || !plus) return;

  /* Action-menu geometry and edge resizing. */
  if (typeof makeResizable === 'function') {
    makeResizable(pop, 40, 30, () => { try { saveBox(); window.syncPopFont(); } catch (e) {} });
    /* Scale menu typography and spacing with panel width. */
    window.syncPopFont = function () {
      const w = pop.getBoundingClientRect().width || 170;
      const fs = Math.max(10, Math.min(26, Math.round(w / 12)));
      pop.style.setProperty('--pop-fs', fs);
    };
    try { new ResizeObserver(() => { try { window.syncPopFont(); } catch (e) {} }).observe(pop); } catch (e) {}
  }

  function syncLabels() {
    if (thinkLbl) thinkLbl.textContent = thinkMode;
    pop.querySelectorAll('[data-act="reasoning"] .mpop-dot').forEach(d => {
      d.style.background = '#6f8fae';
    });
  }

  /* Persist window geometry for subsequent openings within this session. */
  const P_KEY = 'pi-web.chatPopBox';
  function saveBox() {
    try {
      const r = pop.getBoundingClientRect();
      localStorage.setItem(P_KEY, JSON.stringify({
        w: Math.round(r.width),
        h: Math.round(r.height),
        /* user=true marks manual resizing; otherwise size to content. */
        user: true,
      }));
    } catch (e) {}
  }

  /* Anchor the action menu at the bottom right; cornerBox owns its size. */
  const POP_KEY = 'pi-web.popPos';
  const popPin = (typeof cornerBox === 'function')
    ? cornerBox(pop, POP_KEY, { minW: 120, minH: 120 })
    : null;

  /* Fit width to the widest menu/control row plus panel padding. */
  function measurePopWidth(el, listEl) {
    el.hidden = false;
    el.style.width = 'auto';
    el.style.height = 'auto';
    /* Temporarily reveal hidden content for nonzero layout measurements. */
    const prevMaxH = listEl ? listEl.style.maxHeight : null;
    if (listEl) listEl.style.maxHeight = 'none';
    let widest = 0;
    if (listEl) {
      for (const ch of listEl.children) {
        const cs = getComputedStyle(ch);
        if (cs.display === 'none') continue;
        const w = ch.getBoundingClientRect().width;
        if (w > widest) widest = w;
      }
    }
    if (listEl && prevMaxH !== null) listEl.style.maxHeight = prevMaxH;
    else if (listEl) listEl.style.maxHeight = '';
    /* Include list padding in the measured width. */
    let pad = 0;
    if (listEl) {
      const cs = getComputedStyle(listEl);
      pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      /* Reserve space for borders and any visible scrollbar. */
    }
    /* Clear the measurement width before place() positions the panel. */
    el.style.width = '';
    el.style.height = '';
    const want = Math.round(widest + pad + 2);
    /* Respect resize minimums and viewport bounds. */
    return Math.max(120, Math.min(want, window.innerWidth - 16));
  }

  /* Cache the list reference for place(). */
  const popListEl = pop.querySelector('.mpop-list');
  const listQuery = () => popListEl;

  function place() {
    /* Manual geometry takes precedence over automatic content sizing. */
    let userSized = false;
    let savedW = 0;
    try {
      const saved = JSON.parse(localStorage.getItem(P_KEY) || 'null');
      userSized = !!(saved && saved.user);
      if (saved && typeof saved.w === 'number') savedW = saved.w;
    } catch (e) {}
    /* Use manual width when available; otherwise fit the widest content row. */
    const defW = (userSized && savedW > 0)
      ? savedW
      : Math.min(
          measurePopWidth(pop, listQuery()),
          window.innerWidth - 2 * 8
        );
    
    if (popPin) {
      if (userSized) { popPin.place(defW, 0); return; }
      popPin.place(defW, 0);
      /* Content height remains bounded by the viewport. */
      pop.style.height = 'auto';
      const listEl = pop.querySelector('.mpop-list');
      /* Compute the initial menu height separately from scrollable mode controls. */
      /* Sum menu-row heights and padding rather than reserving empty footer space. */
      const modesBox = pop.querySelector('.mpop-modes');
      /* Measure child rows directly; constrained scrollHeight can misstate natural height. */
      let full = 0;
      if (listEl) {
        for (const ch of listEl.children) {
          const cs = getComputedStyle(ch);
          if (cs.display === 'none') continue;
          /* Count nested mode controls separately to avoid double-counting their height. */
          if (ch.classList && ch.classList.contains('mpop-modes')) continue;
          full += ch.getBoundingClientRect().height
                + (parseFloat(cs.marginTop) || 0)
                + (parseFloat(cs.marginBottom) || 0);
        }
        const lcs = getComputedStyle(listEl);
        full += (parseFloat(lcs.paddingTop) || 0) + (parseFloat(lcs.paddingBottom) || 0);
        if (!full) full = listEl.scrollHeight;
      }
      const modesH = modesBox ? modesBox.offsetHeight : 0;
      /* Include action rows and execution controls in the full content measurement. */
      /* Initial height may exclude mode controls while hinting at scrollable content. */
      /* Keep the final visible action row fully inside the initial viewport. */
      const secret = pop.querySelector('.mpop-secret');
      const secretH = secret ? secret.offsetHeight : 0;
      const foot = pop.querySelector('.mpop-foot');
      /* A display:none footer contributes zero offsetHeight. */
      const footH = foot ? foot.offsetHeight : 0;
      /* Bound the full panel height by available viewport space. */
      const fitAll = Math.max(120, Math.round(full + modesH + Math.max(secretH, 10) + footH + 2));
      const limit = Math.max(120, Math.min(fitAll, Math.round(window.innerHeight - 20)));
      pop.style.height = Math.round(limit) + 'px';
      /* Reposition the bottom-anchored panel after measuring its height. */
      const hh = pop.getBoundingClientRect().height;
      pop.style.top = Math.round(Math.max(6, window.innerHeight - hh - 6)) + 'px';
      pop.style.height = Math.round(hh) + 'px';
      if (listEl) listEl.style.minHeight = '0';
      return;   /* Do not fall through and reset the measured height to auto. */
    }
    /* Fallback when cornerBox is unavailable. */
    pop.style.width = defW + 'px';
    pop.style.height = 'auto';
    const h = Math.min(pop.getBoundingClientRect().height || 200, window.innerHeight - 20);
    pop.style.left = (window.innerWidth - defW - 8) + 'px';
    pop.style.top = Math.max(8, window.innerHeight - h - 44) + 'px';
  }

  /* Resize from edges and corners. */
  pop.style.position = 'fixed';
  makeResizable(pop, 40, 30, saveBox);

  function open() {
    syncLabels();
    pop.hidden = false;
    place();
    try { if (window.syncPopFont) window.syncPopFont(); } catch (e) {}
    plus.classList.add('on');
  }

  /* Recompute anchored placement when the viewport changes. */
  window.addEventListener('resize', () => {
    if (!pop.hidden) place();
  });
  function shut() {
    pop.hidden = true;
    plus.classList.remove('on');
  }
  function isOpen() { return !pop.hidden; }

  /* New-chat gesture handling. */
  /* Recognize two taps within 600ms rather than an armed confirmation timer. */
  const NEW_DBL_MS = 600;
  let newLastTap = 0;
  function disarmNew() {
    newLastTap = 0;
    plus.classList.remove('armed');
    const row = document.querySelector('#chatPop [data-act="newchat"]');
    if (row) row.classList.remove('armed');
  }

  function startNewChat() {
    disarmNew();
    if (isOpen()) shut();
    resetChatNow();
  }
  /* The dedicated NEW button starts a conversation with one tap. */
  (function () {
    const b = document.getElementById('chatNew');
    if (!b) return;
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      startNewChat();
    });
  })();

  /* One permission owner; the server rechecks each requested screenshot. */


  plus.onclick = (e) => {
    e.stopPropagation();
    if (plus.hidden || plus.style.display === 'none') return;
    // MENU always opens settings, regardless of footer/input layout.
    // Starting a new chat belongs exclusively to the NEW button.
    if (isOpen()) shut(); else open();
  };
  /* Resume uses /api/chat/list and /api/chat/open to continue native conversations. */

  /* Resume window geometry and pointer interactions. */
  const RW_KEY = 'pi-web.resumeBox';
  let resumePin = null;

  function resumeReadBox() {
    try {
      const b = JSON.parse(localStorage.getItem(RW_KEY) || 'null');
      if (b && Number.isFinite(b.w)) return b;
    } catch (e) {}
    return null;
  }

  function resumeSaveBox() {
    const w = $('resumeWin');
    if (!w || w.hidden) return;
    try {
      const r = w.getBoundingClientRect();
      localStorage.setItem(RW_KEY, JSON.stringify({
        w: Math.round(r.width),
        h: Math.round(r.height),
        l: Math.round(r.left),
        t: Math.round(r.top),
        user: true,
      }));
    } catch (e) {}
  }

  function resumePlace() {
    const w = $('resumeWin');
    if (!w) return;
    w.hidden = false;

    if (!resumePin && typeof cornerBox === 'function') {
      resumePin = cornerBox(w, RW_KEY, { minW: 130, minH: 80 });
      if (typeof makeResizable === 'function') {
        makeResizable(w, 130, 80, resumeSaveBox);
      }
    }

    const saved = resumeReadBox();
    if (saved && saved.user) {
      /* Preserve size; viewport anchoring controls the position. */
      resumePin.place(saved.w, saved.h);
      return;
    }

    /* Initially fit the widest row and the number of conversations. */
    let defW = 130;
    {
      w.style.width = 'auto';
      const list0 = $('resumeList');
      let widest = 0;
      if (list0) {
        const prevMaxH = list0.style.maxHeight;
        list0.style.maxHeight = 'none';
        for (const ch of list0.children) {
          if (getComputedStyle(ch).display === 'none') continue;
          const cw = ch.getBoundingClientRect().width;
          if (cw > widest) widest = cw;
        }
        list0.style.maxHeight = prevMaxH;
        const cs = getComputedStyle(list0);
        widest += (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      }
      w.style.width = '';
      if (widest > 0) defW = Math.round(widest + 2);
      defW = Math.max(130, Math.min(defW, 320));
    }
    resumePin.place(defW, 0);
    w.style.height = 'auto';
    const list = $('resumeList');
    let n = 0;
    if (list) {
      for (const ch of list.children) {
        if (getComputedStyle(ch).display === 'none') continue;
        n += ch.getBoundingClientRect().height;
      }
    }
    const lcs = list ? getComputedStyle(list) : null;
    const pad = lcs ? (parseFloat(lcs.paddingTop) || 0) + (parseFloat(lcs.paddingBottom) || 0) : 0;
    /* Fit row heights within viewport bounds. */
    const maxH = Math.round(window.innerHeight - 16);
    const want = Math.max(80, Math.min(Math.round(n + pad + 4), maxH));
    w.style.height = want + 'px';
    /* Match the action menu's bottom-right viewport anchor. */
    const r0 = w.getBoundingClientRect();
    w.style.left = Math.max(4, Math.round(window.innerWidth - r0.width - 8)) + 'px';
    w.style.top = Math.max(4, Math.round(window.innerHeight - r0.height - 8)) + 'px';
  }

  /* Drag from unused window space. */
  function resumeFmt(ts) {
    try {
      const d = new Date(ts);
      const p2 = (n) => String(n).padStart(2, '0');
      const now = new Date();
      if (d.toDateString() === now.toDateString()) {
        return p2(d.getHours()) + ':' + p2(d.getMinutes());
      }
      return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + ' ' +
             p2(d.getHours()) + ':' + p2(d.getMinutes());
    } catch (e) { return ''; }
  }

  function resumeTitle(t) {
    const s = String(t || 'Untitled').replace(/\s+/g, ' ').trim();
    return s.length > 70 ? s.slice(0, 70) + '…' : s;
  }

  /* SESSION PICKER: fetch conversations and render Resume rows. */
  async function openResume() {
    const w = $('resumeWin');
    if (!w) return;
    const l = $('resumeList');
    if (l) l.innerHTML = '<span class="chat-list-empty">Loading…</span>';
    w.hidden = false;
    try {
      const resp = await fetch('/api/chat/list', { credentials: 'same-origin' });
      const d = await resp.json().catch(() => ({}));
      const chats = d.chats || [];
      const cur = d.current || '';
      if (!l) return;
      l.textContent = '';
      if (!chats.length) {
        l.innerHTML = '<span class="chat-list-empty">No conversations yet</span>';
        return;
      }
      for (const c of chats) {
        const row = document.createElement('div');
        row.className = 'mpop-item' + (c.id === cur ? ' on' : '');
        row.style.cursor = 'pointer';
        const name = document.createElement('span');
        name.className = 'mpop-name';
        name.style.cssText = 'white-space:normal;overflow-wrap:anywhere';
        name.textContent = resumeTitle(c.title);
        const hint = document.createElement('span');
        hint.className = 'mpop-hint';
        hint.textContent = resumeFmt(c.at) + ' · ' + (c.turns || 0) + ' turns';
        const body = document.createElement('span');
        body.className = 'mpop-body';
        body.appendChild(name);
        body.appendChild(hint);
        const dot = document.createElement('span');
        dot.className = 'mpop-dot';
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'resume-del';
        del.title = 'Delete conversation';
        del.textContent = '×';
        del.onclick = (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          deleteChat(c.id, row);
        };
        row.appendChild(dot);
        row.appendChild(body);
        row.appendChild(del);
        row.onclick = () => pickChat(c.id);
        l.appendChild(row);

      }
      /* Resolve content-sized or saved geometry. */
      requestAnimationFrame(() => resumePlace());
    } catch (e) {
      if (l) l.innerHTML = '<span class="chat-list-empty">Could not load conversations</span>';
    }
  }

  async function pickChat(id) {
    closeResume();
    try {
      const r = await fetch('/api/chat/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.error || 'Could not open conversation'); return; }
      if (typeof loadChat === 'function') await loadChat();
      if (typeof loadUsage === 'function') loadUsage();
      toast('Conversation opened');
    } catch (e) {
      toast('Error: ' + e.message);
    }
  }

  function closeResume() {
    const w = $('resumeWin');
    if (w) w.hidden = true;
  }

  /* Close Resume on outside taps. */
  document.addEventListener('pointerdown', (e) => {
    const w = $('resumeWin');
    if (!w || w.hidden) return;
    if (w.contains(e.target)) return;
    closeResume();
  }, true);

  /* Close on Escape. */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const w = $('resumeWin');
    if (w && !w.hidden) closeResume();
  });

  /* Delete a conversation's native session file. */
  /* SESSION DELETE: remove a conversation, then update the picker. */
  async function deleteChat(id, rowEl) {
    try {
      const r = await fetch('/api/chat/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id })
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        toast(d.error || 'Could not delete conversation');
        return;
      }
      const result = await r.json();
      if (result.activeDeleted) await loadChat();
      if (rowEl && rowEl.parentNode) rowEl.parentNode.removeChild(rowEl);
      const l = $('resumeList');
      if (l && !l.querySelector('.mpop-item')) {
        l.innerHTML = '<span class="chat-list-empty">No conversations yet</span>';
      }
      toast('Conversation deleted');
    } catch (e) {
      toast('Error: ' + e.message);
    }
  }

  /* Outside taps replace a dedicated close button. */
  pop.addEventListener('click', (e) => {
    const row = e.target.closest && e.target.closest('.mpop-item');
    if (!row) return;
    const act = row.dataset.act;

    if (act === 'newchat') {
      /* The open menu starts a new chat without another confirmation. */
      startNewChat();
      return;
    }
    if (act === 'tg') {
      shut();
      return;
    }
    if (act === 'files') {
      shut(); openFilesWindow();
      return;
    }
    if (act === 'resume') {
      shut();
      openResume();
      return;
    }
    if (act === 'reasoning') {
      const order = ['hide', 'show', 'open'];
      thinkMode = order[(order.indexOf(thinkMode) + 1) % order.length];
      try { localStorage.setItem(K_THINK, thinkMode); } catch (err) {}
      paintThinkModes();
      syncLabels();
      return;
    }
    if (act === 'modes') {
      const sub = $('chatPopModes');
      if (sub) {
        sub.hidden = !sub.hidden;
        place();
      }
      syncLabels();
      return;
    }
  });

  document.addEventListener('click', (e) => {
    if (!isOpen()) return;
    if (pop.contains(e.target) || plus.contains(e.target)) return;
    shut();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) shut();
  });


})();

    /* The attachment control opens the native file picker. */
(function () {
  const x = document.getElementById('chatFilesX');
  if (!x) return;
  x.onclick = (e) => {
    e.stopPropagation();
    const inp = document.getElementById('chatAttach');
    if (inp) { inp.click(); return; }
    if (typeof openFilesWindow === 'function') openFilesWindow();
  };
})();

  /* Independent file window. */
  const F_WIN = { left: null, top: null, w: 320, h: 210 };
  
  /* Anchor at the bottom left and close on outside clicks. */
  /* Size left-side windows to cover the usage controls beneath them. */
  
  function winDefault() {
    const W = window.innerWidth, H = window.innerHeight;
    /* Compact initial dimensions. */
    return {
      w: Math.min(200, W - 12),
      h: Math.min(220, H - 12)
    };
  }

  const innerPins = new WeakMap();

  function pinLeftBottom(win) {
    const KEY = 'pi-web.winSize.' + win.id;

    const stick = () => {
      const r = win.getBoundingClientRect();
      win.style.left = '0px';
      win.style.top = Math.max(0, window.innerHeight - r.height) + 'px';
      win.style.right = 'auto';
      win.style.bottom = 'auto';
    };

    const read = () => {
      try {
        const b = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (b && Number.isFinite(b.w)) return b;
      } catch (e) {}
      return null;
    };

    const apply = () => {
      const saved = read();
      const W = window.innerWidth, H = window.innerHeight;
      const def = winDefault();
      const w = saved ? Math.min(saved.w, W - 12) : def.w;
      const h = (saved && saved.h) ? Math.min(saved.h, H - 12) : def.h;
      win.style.width = Math.round(w) + 'px';
      win.style.height = Math.round(h) + 'px';
      stick();
    };

    if (!innerPins.has(win)) {
      innerPins.set(win, true);
      makeResizable(win, 100, 70, () => {
        const r = win.getBoundingClientRect();
        try { localStorage.setItem(KEY, JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height) })); } catch (e) {}
        stick();
      });
      window.addEventListener('resize', () => { if (!win.hidden) { apply(); } });
      document.addEventListener('pointerdown', (ev) => {
        if (win.hidden) return;
        if (ev.target.closest('#' + win.id)) return;
        if (ev.target.closest('.mpop-item')) return;
        win.hidden = true;
      });
    }

    win.hidden = false;
    apply();
  }

/* Shared edge and corner resize handling. */
/* Corner-anchored panel geometry. */
function cornerBox(el, key, opts = {}) {
  const MIN_W = Math.max(80, opts.minW | 0 || 100);
  const MIN_H = Math.max(40, opts.minH | 0 || 60);
  const EDGE = 6;

  const read = () => {
    try {
      const b = JSON.parse(localStorage.getItem(key) || 'null');
      if (b && Number.isFinite(b.w)) {
        return {
          w: b.w,
          h: Number.isFinite(b.h) ? b.h : 0,
          /* Restore saved height only after explicit manual resizing. */
          user: b.user === true,
        };
      }
    } catch (e) {}
    return null;
  };

  const save = () => {
    try {
      const r = el.getBoundingClientRect();
      localStorage.setItem(key, JSON.stringify({
        w: Math.round(r.width),
        h: Math.round(r.height),
        /* Without user=true, use automatic content sizing. */
        user: true,
      }));
    } catch (e) {}
  };

  /* Anchor at the bottom right without changing dimensions. */
  const stick = () => {
    const W = window.innerWidth, H = window.innerHeight;
    const r = el.getBoundingClientRect();
    const w = r.width, h = r.height;
    el.style.left = Math.round(Math.max(EDGE, W - w - EDGE)) + 'px';
    el.style.top = Math.round(Math.max(EDGE, H - h - EDGE)) + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  };

  const place = (defW, defH) => {
    el.hidden = false;
    const W = window.innerWidth, H = window.innerHeight;
    const b = read();
    const w = b ? Math.min(b.w, W - 2 * EDGE) : Math.min(defW, W - 2 * EDGE);
    if (w > 0) el.style.width = Math.round(w) + 'px';

    if (defH > 0) {
      el.style.height = Math.round(defH) + 'px';
    } else if (b && b.user && b.h > 0) {
      /* Preserve manually chosen dimensions. */
      el.style.height = Math.round(Math.min(b.h, H - 2 * EDGE)) + 'px';
    } else {
      /* Fit content initially; subsequent manual resizing takes precedence. */
      el.style.height = 'auto';
      const nat = el.getBoundingClientRect().height;
      el.style.height = Math.round(Math.min(nat, H - 2 * EDGE)) + 'px';
    }
    /* Freeze measured height so the first and subsequent placements agree. */
    const hh = el.getBoundingClientRect().height;
    el.style.height = Math.round(hh) + 'px';
    stick();
  };

  /* Preserve the bottom anchor while resizing upward.
     Measure height from the bottom boundary rather than moving the window top. */
  const H_KEY = 'pi-web.winH.' + key;

  const applyHeight = (h) => {
    const H = window.innerHeight;
    const hh = Math.max(MIN_H, Math.min(h, H - 2 * EDGE));
    el.style.height = Math.round(hh) + 'px';
    stick();
    return hh;
  };

  const topHandle = el.querySelector('.rz-n');
  const topCorners = [el.querySelector('.rz-nw'), el.querySelector('.rz-ne')].filter(Boolean);
  const bottomHandle = el.querySelector('.rz-s');
  const bottomEdge = [el.querySelector('.rz-sw'), el.querySelector('.rz-se')].filter(Boolean);

  const startGrow = (handle, dir) => {
    if (!handle) return;
    let st = null;
    handle.style.touchAction = 'none';
    handle.addEventListener('pointerdown', (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      const r = el.getBoundingClientRect();
      st = { y: ev.clientY, h: r.height, pid: ev.pointerId };
      try { handle.setPointerCapture(ev.pointerId); } catch (e) {}
      ev.preventDefault();
      ev.stopPropagation();
    });
    handle.addEventListener('pointermove', (ev) => {
      if (!st || ev.pointerId !== st.pid) return;
      const dy = ev.clientY - st.y;
      /* dir=-1 grows upward; dir=+1 shrinks downward. */
      applyHeight(st.h - dy * dir);
      ev.preventDefault();
      ev.stopPropagation();
    });
    const end = (ev) => {
      if (!st) return;
      st = null;
      try { if (ev && handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId); } catch (e) {}
      const r = el.getBoundingClientRect();
      try { localStorage.setItem(key, JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height) })); } catch (e) {}
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };

  /* Upper-edge drags grow from the anchored bottom edge. */
  if (topHandle) startGrow(topHandle, -1);
  topCorners.forEach((h) => startGrow(h, -1));
  /* Lower-edge drags also preserve the bottom anchor. */
  if (bottomHandle) startGrow(bottomHandle, 1);
  bottomEdge.forEach((h) => startGrow(h, 1));

  /* makeResizable owns width; persist it together with height. */
  if (typeof makeResizable === 'function') {
    makeResizable(el, MIN_W, MIN_H, () => {
      const r = el.getBoundingClientRect();
      try { localStorage.setItem(key, JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height) })); } catch (e) {}
      stick();
    });
  }

  window.addEventListener('resize', () => { if (!el.hidden) stick(); });

  return { place, save, stick, read };
}

function makeResizable(el, minW, minH, onDone, anchorBottomLeft = false) {
  const edges = [
    ['.rz-e',  'e'], ['.rz-w', 'w'], ['.rz-s', 's'], ['.rz-n', 'n'],
    ['.rz-se', 'se'], ['.rz-sw', 'sw'], ['.rz-ne', 'ne'], ['.rz-nw', 'nw'],
  ];
  const MIN_W = Math.max(90, minW | 0);
  const MIN_H = Math.max(60, minH | 0);

  edges.forEach(([sel, dir]) => {
    const h = el.querySelector(sel);
    if (!h) return;
    let st = null;

    const stop = (ev) => {
      if (!st) return;
      st = null;
      try { if (ev && h.hasPointerCapture(ev.pointerId)) h.releasePointerCapture(ev.pointerId); } catch (e) {}
      if (typeof onDone === 'function') onDone();
    };

    h.addEventListener('pointerdown', (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      const r = el.getBoundingClientRect();
      /* Read left/top from styles because the live bounding rectangle changes. */
      st = {
        x: ev.clientX, y: ev.clientY,
        l: r.left, t: r.top, w: r.width, hh: r.height,
        pid: ev.pointerId
      };
      try { h.setPointerCapture(ev.pointerId); } catch (e) {}
      ev.preventDefault();
      ev.stopPropagation();
    });

    h.addEventListener('pointermove', (ev) => {
      if (!st || ev.pointerId !== st.pid) return;
      const dx = ev.clientX - st.x, dy = ev.clientY - st.y;
      if (anchorBottomLeft) {
        /* Grow upward/rightward while keeping the opposite corner fixed. */
        const inset = 5;
        const width = Math.min(window.innerWidth - inset * 2, Math.max(MIN_W, st.w + dx));
        const height = Math.min(window.innerHeight - inset * 2, Math.max(MIN_H, st.hh - dy));
        Object.assign(el.style, { left: inset + 'px', bottom: inset + 'px', top: 'auto',
          width: Math.round(width) + 'px', height: Math.round(height) + 'px' });
        ev.preventDefault();
        return;
      }
      let L = st.l, T = st.t, W = st.w, H = st.hh;

      if (dir.indexOf('e') >= 0) W = st.w + dx;
      if (dir.indexOf('s') >= 0) H = st.hh + dy;
      if (dir.indexOf('w') >= 0) { W = st.w - dx; L = st.l + dx; }
      if (dir.indexOf('n') >= 0) { H = st.hh - dy; T = st.t + dy; }

      /* Clamp minimum size without moving the opposite edge. */
      if (W < MIN_W) { if (dir.indexOf('w') >= 0) L = st.l + st.w - MIN_W; W = MIN_W; }
      if (H < MIN_H) { if (dir.indexOf('n') >= 0) T = st.t + st.hh - MIN_H; H = MIN_H; }

      /* Clamp to viewport bounds. */
      if (L < 0) { W += L; L = 0; }
      if (T < 0) { H += T; T = 0; }
      if (L + W > window.innerWidth)  W = window.innerWidth - L;
      if (T + H > window.innerHeight) H = window.innerHeight - T;

      el.style.left = Math.round(L) + 'px';
      el.style.top = Math.round(T) + 'px';
      el.style.width = Math.round(W) + 'px';
      el.style.height = Math.round(H) + 'px';
      ev.preventDefault();
    });

    h.addEventListener('pointerup', stop);
    h.addEventListener('pointercancel', stop);
    /* Reset resize state if pointer capture is lost. */
    h.addEventListener('lostpointercapture', stop);
    window.addEventListener('blur', stop);
  });
}

  function openFilesWindow() {
    let win = document.getElementById('filesWin');
    if (!win) {

      win = document.createElement('div');
      win.id = 'filesWin';
      win.innerHTML =
        '' +
        '<iframe src="/files/" title="Files"></iframe>' +
        '<div class="rz-e"></div><div class="rz-w"></div><div class="rz-s"></div><div class="rz-n"></div>' +
        '<div class="rz-ne rz-corner"></div>';
      document.body.appendChild(win);

      // Resolve the initial file-window geometry.
      /* Anchor the file window at the bottom-left edge. */
      const def = winDefault();
      F_WIN.w = def.w;
      F_WIN.h = def.h;
      F_WIN.left = 0;
      F_WIN.top = Math.round(window.innerHeight - F_WIN.h);

      win.style.left = F_WIN.left + 'px';
      win.style.top = F_WIN.top + 'px';
      win.style.width = F_WIN.w + 'px';
      win.style.height = F_WIN.h + 'px';

    }
    win.hidden = false;
    win.style.zIndex = 400;

    /* Restore bottom-left anchoring and size through pinLeftBottom. */
    pinLeftBottom(win);
    /* Close on outside clicks. */
    if (!win.dataset.closeOnOutside) {
      win.dataset.closeOnOutside = '1';
      const outside = (ev) => {
        if (win.hidden) return;
        if (win.contains(ev.target)) return;
        win.hidden = true;
        document.removeEventListener('pointerdown', outside, true);
        delete win.dataset.closeOnOutside;
      };
      setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
    }
  }

  /* Theme state. */
  function applyTheme(mode){
    const dark = mode === 'dark';
    document.documentElement.style.setProperty('--_dummy', '0');   // trigger
    document.documentElement.classList.toggle('pre-light', !dark);
    try { localStorage.setItem('pi-web.theme', mode); } catch (e) {}
    
  }
  // New browsers default to dark.
  let themeMode = 'dark';
  try { themeMode = localStorage.getItem('pi-web.theme') || 'dark'; } catch (e) {}
  applyTheme(themeMode);

  /* Interface language state. */
  // New browsers default to English.
  let lang = 'en';
  try { lang = localStorage.getItem('pi-web.lang') || window.__piWebBootLang || 'en'; } catch (e) {}
  function applyLang(l){
    lang = l;
    try { localStorage.setItem('pi-web.lang', l); } catch (e) {}
    document.documentElement.lang = l;
    if (typeof applyUiLang === 'function') applyUiLang(l);
    
  }

  /* Interface labels. */
  const UI_I18N = {
    en: {
      errBusy: 'The model is busy — wait for the reply, a second message will not queue.',
      errNetwork: 'Network unavailable, try again.',
      errGeneric: 'Something went wrong — try again.',
      chatPlaceholder: 'Send…',
    },
  };

  function applyUiLang(l){
    const dict = UI_I18N[l] || UI_I18N.en;
    document.documentElement.lang = l;
    document.documentElement.classList.add('lang-ready');
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const k = el.getAttribute('data-i18n');
      if (dict[k]) el.textContent = dict[k];
    });
    const ph = $('chatInput');
    if (ph) ph.placeholder = 'Ask anything';
  }

  let chatStick = true;
  // Scroll-to-latest control follows the composer height, not the viewport.
  if (chatMsgs) {
    const jump = document.createElement('button');
    jump.id = 'chatJumpBottom'; jump.type = 'button'; jump.hidden = true;
    jump.textContent = '↓'; jump.title = 'Jump to latest';
    jump.setAttribute('aria-label', 'Jump to latest');
    const host = chatMsgs.parentElement;
    host.style.position = 'relative';
    host.appendChild(jump);
    const updateJump = () => {
      jump.hidden = chatMsgs.scrollHeight - chatMsgs.scrollTop - chatMsgs.clientHeight < 80;
      const feed = chatMsgs.getBoundingClientRect();
      const parent = host.getBoundingClientRect();
      jump.style.bottom = Math.max(12, parent.bottom - feed.bottom + 14) + 'px';
    };
    jump.onclick = () => { chatStick = true; followTranscript(); };
    chatMsgs.addEventListener('scroll', updateJump, { passive: true });
    const observedMessages = new Set();
    const resize = new ResizeObserver(() => {
      updateJump();
      if (chatStick) followTranscript();
    });
    resize.observe(chatMsgs);
    new MutationObserver(() => {
      for (const node of observedMessages) {
        if (node.parentElement !== chatMsgs) { resize.unobserve(node); observedMessages.delete(node); }
      }
      for (const node of chatMsgs.children) {
        if (!observedMessages.has(node)) { resize.observe(node); observedMessages.add(node); }
      }
      updateJump();
      if (chatStick) followTranscript();
    }).observe(chatMsgs, { childList: true, subtree: true, characterData: true });
    updateJump();
  }
  if (chatMsgs) {
    chatMsgs.style.scrollBehavior = 'auto';
    chatMsgs.style.overflowAnchor = 'none';
  }

  if (chatMsgs) {
    // Only user intent detaches following; our animation also emits scroll events.
    chatMsgs.addEventListener('wheel', e => {
      if (e.deltaY < 0) chatStick = false;
    }, { passive: true });
    chatMsgs.addEventListener('touchmove', () => {
      chatStick = false;
    }, { passive: true });
    chatMsgs.addEventListener('pointerdown', e => {
      if (e.offsetX >= chatMsgs.clientWidth) chatStick = false;
    }, { passive: true });
    chatMsgs.addEventListener('keydown', e => {
      if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        chatStick = false;
      }
    });
    chatMsgs.addEventListener('scroll', () => {
      const nearBottom = chatMsgs.scrollHeight - chatMsgs.scrollTop - chatMsgs.clientHeight <= 2;
      if (nearBottom && !chatStick) {
        chatStick = true;
        followTranscript();
      }
    });
  }

  function esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  /* Render inline/display math with KaTeX; retain source text if unavailable. */

  /* Queue math until KaTeX is ready to avoid flashing unrendered LaTeX. */
  let mathPending = [];
  function katexReady() {
    if (typeof katex !== 'undefined' && katex.renderToString) {
      const queue = mathPending;
      mathPending = [];
      for (const job of queue) { try { job(); } catch (e) {} }
      return true;
    }
    return false;
  }
  window.addEventListener('load', katexReady);

  function inlineMd(s) {
    const parts = [];
    let text = String(s).replace(/`([^`]+)`/g, (m, c) => {
      parts.push('<code>' + esc(c) + '</code>'); return '\u0000' + (parts.length - 1) + '\u0000';
    });
    // Protect math before rendering the remaining Markdown.
    const mathParts = [];
    text = String(text).replace(/\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$\$([^$]+)\$\$|(?<![\\\w])\$([^$\n]+)\$/g, (m, bracket, paren, a, b) => {
      const body = bracket ?? paren ?? a ?? b;
      const display = bracket !== undefined || a !== undefined;
      let html;
      try {
        html = (typeof katex !== 'undefined' && katex.renderToString)
          ? katex.renderToString(body, { displayMode: display, throwOnError: false, trust: false, maxExpand: 1000 }).replace(/\n/g, '')
          : m;
      } catch (e) { html = m; }
      mathParts.push(html);
      return '\u0001' + (mathParts.length - 1) + '\u0001';
    });
    text = esc(text)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    text = text.replace(/\u0000(\d+)\u0000/g, (m, i) => parts[+i]);
    text = text.replace(/\u0001(\d+)\u0001/g, (m, i) => mathParts[+i]);
    return text;
  }

  // Split table cells without breaking escaped pipes or mathematical expressions.
  function tableCells(line) {
    const cells = []; let cell = '', math = '';
    const source = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
    for (let n = 0; n < source.length; n++) {
      const ch = source[n], next = source[n + 1];
      if (ch === '\\' && next === '|') { cell += '|'; n++; continue; }
      if (ch === '\\' && (next === '(' || next === ')')) {
        math = next === '(' ? '\\(' : ''; cell += ch + next; n++; continue;
      }
      if (ch === '$' && source[n - 1] !== '\\') math = math ? '' : '$';
      if (ch === '|' && !math) { cells.push(cell.trim()); cell = ''; }
      else cell += ch;
    }
    cells.push(cell.trim()); return cells;
  }

  function renderCodeBlock(source, language) {
    return '<section class="code-block"><div class="code-block-toolbar"><span>' + esc(language || 'text') +
      '</span><button type="button" class="code-copy" aria-label="Copy code">Copy</button></div><pre><code>' +
      esc(source) + '</code></pre></section>';
  }

  // Delegation also covers restored messages and blocks replaced during streaming.
  window.addEventListener('click', async event => {
    const button = event.target.closest?.('.code-copy');
    if (!button) return;
    const code = button.closest('.code-block')?.querySelector('pre code');
    if (!code) return;
    event.preventDefault();
    event.stopPropagation();
    let copied = false;
    try {
      await navigator.clipboard.writeText(code.textContent);
      copied = true;
    } catch {
      const field = document.createElement('textarea');
      const focused = document.activeElement;
      field.value = code.textContent;
      field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
      document.body.append(field);
      field.select();
      try { copied = document.execCommand('copy'); } catch {}
      field.remove();
      focused?.focus({ preventScroll: true });
    }
    button.textContent = copied ? 'Copied!' : 'Copy failed';
    setTimeout(() => { if (button.isConnected) button.textContent = 'Copy'; }, 2000);
  });

  function renderMd(text) {
    const lines = String(text == null ? '' : text).split('\n');
    const out = [];
    let i = 0, inCode = false, bufCode = [], inList = '', codeLanguage = '';
    const flushList = () => { if (inList) { out.push('</' + inList + '>'); inList = ''; } };

    while (i < lines.length) {
      const line = lines[i];

      if (/^```/.test(line)) {
        if (inCode) {
          const source = bufCode.join('\n');
          if (codeLanguage === 'interactive') {
            out.push('<section class="interactive-card" data-card-source="' + encodeURIComponent(source) + '"><div data-card-mount></div></section>');
          } else out.push(renderCodeBlock(source, codeLanguage));
          bufCode = []; inCode = false; codeLanguage = '';
        }
        else { flushList(); inCode = true; codeLanguage = line.slice(3).trim().toLowerCase(); }
        i++; continue;
      }
      if (inCode) { bufCode.push(line); i++; continue; }

      // Consume display equations before Markdown can interpret their contents.
      const displayStart = line.trim().match(/^(\$\$|\\\[)/);
      if (displayStart) {
        flushList();
        const close = displayStart[1] === '$$' ? '$$' : '\\]';
        let body = line.trim().slice(displayStart[1].length); i++;
        let end = body.indexOf(close);
        while (end < 0 && i < lines.length) {
          body += '\n' + lines[i++]; end = body.indexOf(close);
        }
        if (end >= 0) {
          out.push('<div class="math-block">' + inlineMd('$$' + body.slice(0, end) + '$$') + '</div>');
          const rest = body.slice(end + close.length).trim();
          if (rest) out.push('<p>' + inlineMd(rest) + '</p>');
        } else out.push('<p>' + esc(displayStart[1] + body).replace(/\n/g, '<br>') + '</p>');
        continue;
      }

      const headers = tableCells(line);
      const separators = i + 1 < lines.length ? tableCells(lines[i + 1]) : [];
      if (line.includes('|') && headers.length === separators.length && separators.every(c => /^:?-{3,}:?$/.test(c))) {
        flushList();
        const align = separators.map(c => c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left');
        const row = (cells, tag) => '<tr>' + headers.map((_, n) => '<' + tag + ' style="text-align:' + align[n] + '">' + inlineMd(cells[n] || '') + '</' + tag + '>').join('') + '</tr>';
        out.push('<div class="table-scroll" tabindex="0" role="region" aria-label="Table"><table><thead>' + row(headers, 'th') + '</thead><tbody>');
        i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) out.push(row(tableCells(lines[i++]), 'td'));
        out.push('</tbody></table></div>'); continue;
      }

      const h = line.match(/^(#{1,6})\s+(.*)$/);
      const ul = line.match(/^\s*[-*•]\s+(.*)$/);
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);

      if (h) { flushList(); const tag = h[1].length <= 3 ? 'h3' : 'h4'; out.push('<' + tag + '>' + inlineMd(h[2]) + '</' + tag + '>'); i++; continue; }
      if (ul) { if (inList !== 'ul') { flushList(); out.push('<ul>'); inList = 'ul'; } out.push('<li>' + inlineMd(ul[1]) + '</li>'); i++; continue; }
      if (ol) { if (inList !== 'ol') { flushList(); out.push('<ol>'); inList = 'ol'; } out.push('<li>' + inlineMd(ol[1]) + '</li>'); i++; continue; }
      if (/^>\s?/.test(line)) { flushList(); out.push('<blockquote>' + inlineMd(line.replace(/^>\s?/, '')) + '</blockquote>'); i++; continue; }
      if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flushList(); out.push('<hr>'); i++; continue; }
      if (!line.trim()) { flushList(); i++; continue; }

      const para = [line]; i++;
      while (i < lines.length && lines[i].trim() &&
        !/^```|^#{1,6}\s|^\s*[-*•]\s|^\s*\d+[.)]\s|^>|^\s*(?:\$\$|\\\[)/.test(lines[i]) &&
        !(i + 1 < lines.length && lines[i].includes('|') && tableCells(lines[i + 1]).every(c => /^:?-{3,}:?$/.test(c)))) { para.push(lines[i]); i++; }
      out.push('<p>' + inlineMd(para.join('\n')).replace(/\n/g, '<br>') + '</p>');
    }
    if (inCode && bufCode.length) out.push(renderCodeBlock(bufCode.join('\n'), codeLanguage));
    flushList();
    return out.join('');
  }

  function addCM(t, cls, at, tools, responseMeta) {
    const e = document.createElement('div');
    e.className = 'cm' + (cls ? ' ' + cls : '');
    /* Preserve stored identity; missing dates must not become today's date. */
    e.dataset.at = String(at || 0);
    e.dataset.role = cls || 'agent';
    if (responseMeta) e.dataset.responseMeta = JSON.stringify(responseMeta);
    if (cls === 'me' || cls === 'note' || cls === 'err' || cls === 'ok') e.textContent = t;
    else {
      e.innerHTML = renderMd(t);
      if (!katexReady() && /\$|\\[\[(]/.test(String(t))) {
        mathPending.push(() => { e.innerHTML = renderMd(t); if (chatStick) followTranscript(); });
      }
    }
    /* Message deletion and undo. */
    /* Deletion requires an authenticated session. */
    /* The shared chatMsgs handler below owns deletion gestures. */
    if (Array.isArray(tools) && tools.some(t => t.kind === 'text')) {
      e.replaceChildren();
      renderTools(e, tools);
    } else if (Array.isArray(tools) && tools.length) renderTools(e, tools);
    chatMsgs.appendChild(e);
    if (chatStick) followTranscript();
    return e;
  }

  /* Double-tap message deletion supports undo. */
  // All deletion/undo gestures are owned by the dedicated module.
  if (chatMsgs) window.__chatMessageActions = window.PiWebMessageActions.create({
    feed: chatMsgs,
    busy: () => document.body.dataset.sending === '1'
  });

  function renderAnswer(el, text) {
    if (el._orderedTranscript) return;
    let ans = el.querySelector('.ans');
    if (!ans) {
      // Keep any reasoning above the answer.
      const hadThink = el.querySelector('.thinking-wrap');
      ans = document.createElement('div');
      ans.className = 'ans';
      if (hadThink) el.appendChild(ans);
      else el.appendChild(ans);
    }
    ans.innerHTML = renderMd(text);
  }

  let thinkTimer = null;
  /* Reasoning timer ticks locally; server heartbeats provide stage and thought data. */
  /* K_THINK and thinkMode are shared with the action menu above. */

  $('chatInput').placeholder = 'Ask anything';
  $('chatPlus').title = 'Menu';
  $('chatPlus').setAttribute('aria-label', 'Menu');
  $('chatFilesX').title = 'Files';
  $('chatFilesX').setAttribute('aria-label', 'Files');

  function paintThinkModes() {
    document.body.classList.toggle('think-hidden', thinkMode === 'hide');
    document.body.dataset.transcriptMode = thinkMode;
  }
  paintThinkModes();

  /* Track the active reasoning indicator for cleanup without an element reference. */
  let thinkEl = null;

  function thinkStart(el) {
    el._liveTranscript = true;
    thinkEl = el;
    el._thinkFull = '';   // Accumulated reasoning text.
    el.innerHTML = '<div class="thinking-wrap">' +
      '<div class="thinking"><span class="dots"><i></i><i></i><i></i></span>' +
      '<span class="stage">thinking</span><span class="ph">0:00</span></div>' +
      '<div class="thinking-thought' + (thinkMode === 'open' ? ' open' : '') + '"></div></div>';
    const t0 = Date.now();
    thinkTimer = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      const ph = el.querySelector('.ph');
      if (ph) ph.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }, 500);
  }
  /* Apply server activity and reasoning updates. */
  let followFrame = 0;
  function followTranscript() {
    if (!chatStick || followFrame) return;
    let position = chatMsgs.scrollTop;
    let velocity = 0;
    let last = performance.now();
    const tick = now => {
      followFrame = 0;
      if (!chatStick || !chatMsgs) return;
      const bottom = Math.max(0, chatMsgs.scrollHeight - chatMsgs.clientHeight);
      // Rebase after manual movement or browser clamping when content shrinks.
      if (Math.abs(chatMsgs.scrollTop - position) > 2) {
        position = chatMsgs.scrollTop;
        velocity = 0;
      }
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      // Exact critically damped spring: continuous velocity, no overshoot.
      // Keep fractional position even on browsers that round scrollTop.
      const omega = 20;
      const offset = position - bottom;
      const decay = Math.exp(-omega * dt);
      const impulse = velocity + omega * offset;
      position = bottom + (offset + impulse * dt) * decay;
      velocity = (velocity - omega * impulse * dt) * decay;
      position = Math.max(0, Math.min(bottom, position));
      chatMsgs.scrollTop = position;
      if (Math.abs(bottom - position) < 0.5 && Math.abs(velocity) < 2) {
        chatMsgs.scrollTop = bottom;
        return;
      }
      followFrame = requestAnimationFrame(tick);
    };
    followFrame = requestAnimationFrame(tick);
  }

  /* Animate new live content only; render recovered history immediately. */
  function revealTranscript(node, target, markdown, live) {
    target = String(target || '');
    // Render all received text immediately; do not simulate slower model output.
    if (node._revealFrame) cancelAnimationFrame(node._revealFrame);
    node._revealFrame = 0;
    node._revealTarget = target;
    node._revealShown = target;
    if (markdown) node.innerHTML = renderMd(target);
    else node.textContent = target;
    if (live) followTranscript();
  }

  function renderTools(el, list) {
    if (list.some(t => t.kind === 'text')) {
      el._orderedTranscript = true;
      el.querySelector('.ans')?.remove();
    }
    let wrap = el.querySelector('.tools-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'tools-wrap';
      el.appendChild(wrap);
    }
    for (const t of list) {
      if (t.kind === 'reasoning') {
        let card = el.querySelector('.reasoning-card');
        if (!card) {
          card = document.createElement('details'); card.className = 'reasoning-card';
          card.append(document.createElement('summary'), document.createElement('div'));
          el.prepend(card);
        }
        card.firstChild.textContent = 'Reasoning' + (t.seconds != null ? ' · ' + t.seconds + 's' : '');
        card.lastChild.textContent = t.text || '';
        // Keep the activity indicator until the turn actually finishes.
        const thought = el.querySelector('.thinking-thought');
        if (thought) thought.textContent = '';
        continue;
      }
      let block = Array.from(wrap.children).find(b => b.dataset.tid === String(t.id));
      if (t.kind === 'text') {
        if (!block) {
          block = document.createElement('div');
          block.dataset.tid = String(t.id);
          block.className = 'transcript-text';
          block.style.cssText = 'display:block;color:inherit;font:inherit;margin:12px 0;background:none;border:0;padding:0;cursor:default;overflow-anchor:none';
          wrap.appendChild(block);
        }
        if (block._text !== t.text) {
          revealTranscript(block, t.text || '', true, !!el._liveTranscript);
          block._text = t.text;
        }
        continue;
      }
      if (!block) {
        block = document.createElement('div');
        block.dataset.tid = String(t.id);
        block.className = 'transcript-tool';
        block.style.cssText = 'margin:14px 0;padding:0;border:0;background:none;color:#889099';
        const heading = document.createElement('button');
        heading.type = 'button';
        heading.setAttribute('aria-expanded', 'false');
        heading.onclick = () => {
          const expanded = block.classList.toggle('tool-expanded');
          heading.setAttribute('aria-expanded', String(expanded));
        };
        block.append(heading, document.createElement('pre'));
        wrap.appendChild(block);
      }
      const toolArgs = t.args || {};
      const summary = String(toolArgs.command || toolArgs.path || toolArgs.file_path || '').split('\n')[0];
      block.firstChild.textContent = t.name + (summary ? ' · ' + summary.slice(0, 160) : '') + (t.running ? ' · running…' : t.isError ? ' · error' : '');
      block.firstChild.title = 'Expand / collapse';
      block.firstChild.style.cssText = 'display:block;background:none;border:0;padding:0;text-align:left;font:inherit;font-size:12px;margin-bottom:4px;color:' + (t.isError ? '#d58080' : 'inherit');
      const args = t.args || {};
      let call = args.command || '';
      if (!call && (t.name === 'read' || t.name === 'write' || t.name === 'edit')) {
        call = args.path || args.file_path || '';
        if (args.content !== undefined) call += '\n' + args.content;
        if (Array.isArray(args.edits)) call += '\n' + args.edits.map(e => '- ' + e.oldText + '\n+ ' + e.newText).join('\n');
      }
      if (!call && t.args) call = JSON.stringify(t.args, null, 2);
      revealTranscript(block.lastChild, call + (t.output ? '\n\n' + t.output : ''), false, !!el._liveTranscript);
      block.lastChild.style.cssText = 'display:block;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;max-height:none;overflow:visible;font:inherit;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.55;color:inherit;background:none;border:0;border-radius:0;box-shadow:none;padding:0;margin:0';
      window.@@PROJECT_HANDLE@@Images?.render(block, t);
    }
  }

  function thinkBeat(el, d) {
    if (!el) return;
    if (Array.isArray(d.tools) && d.tools.length) renderTools(el, d.tools);
    const ph = el.querySelector('.ph');
    if (ph) ph.textContent = Math.floor((d.seconds || 0) / 60) + ':' +
      String((d.seconds || 0) % 60).padStart(2, '0');
    const st = el.querySelector('.stage');
    if (st && d.stage) st.textContent = d.stage;
    const th = el.querySelector('.thinking-thought');
    if (th) {
      /* Merge reasoning snapshots into accumulated text rather than replacing prior content. */
      const incoming = d.thinking || '';
      const full = el._thinkFull || '';
      if (incoming && !full.endsWith(incoming)) {
        // Newly appended reasoning length.
        let add = incoming;
        for (let i = Math.min(full.length, incoming.length); i > 0; i--) {
          if (full.endsWith(incoming.slice(0, i))) { add = incoming.slice(i); break; }
        }
        if (add) el._thinkFull = (full + add);
      }
      th.textContent = el._thinkFull || '';
      th.scrollTop = th.scrollHeight;
    }
    if (chatStick) followTranscript();
  }
  /* Collapse completed reasoning unless open mode keeps it expanded. */
  function thinkFold(el) {
    if (!el) return;
    const txt = (el._thinkFull || '').trim();
    const wrap = el.querySelector('.thinking-wrap');
    if (!wrap) return;
    if (!txt) { wrap.remove(); return; }
    if (thinkMode === 'open') return;   // Keep expanded reasoning unchanged.

    // Avoid duplicating an existing collapsed indicator.
    if (el.querySelector('.think-fold')) return;

    const n = txt.length;
    const label = n > 1000 ? (n / 1000).toFixed(1) + 'K' : n;
    const btn = document.createElement('div');
    btn.className = 'think-fold';
    btn.innerHTML = '<span>▸ reasoning (' + label + ')</span>';
    const body = document.createElement('div');
    body.className = 'think-fold-body';
    body.textContent = txt;
    btn.onclick = () => {
      const open = btn.classList.toggle('open');
      btn.querySelector('span').textContent = (open ? '▾' : '▸') + ' reasoning (' + label + ')';
    };
    wrap.innerHTML = '';
    wrap.appendChild(btn);
    wrap.appendChild(body);
  }

  /* Stop timers and remove stale activity indicators after failure or completion. */
  function thinkStop(removeIfEmpty) {
    if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }
    const el = thinkEl;
    if (!el || !el.querySelector) return;
    const wrap = el.querySelector('.thinking-wrap');
    if (!wrap) return;
    wrap.querySelector('.thinking')?.remove();
    const hadThoughts = (el._thinkFull || '').trim().length > 0;
    const hasAnswer = !!(el.querySelector('.ans') &&
      el.querySelector('.ans').textContent.trim().length);
    if (!hadThoughts && !hasAnswer) wrap.remove();
  }

  /* Current-conversation usage and context status. */
  // Pi supplies tokens, percent and window, including output and trailing-message estimates.
  // Warn before exhaustion: upcoming output also needs space in the window.
  const CONTEXT_WARNING_RATIO = 0.60;
  const CONTEXT_DANGER_RATIO = 0.85;
  const CONTEXT_COLORS = { normal: '#52966b', warning: '#c4a348', danger: '#c65b5b', unknown: '#4a7196' };
  let usageTimer = null;
  let usageRevision = 0;
  let lastUsage = null;
  function fmtTokens(n) {
    if (!n) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }
  function renderUsage(u) {
    const el = $('chatUsage');
    if (!el || !u || u.ok === false) return;
    lastUsage = u;
    const knownLimit = Number.isFinite(u.contextWindow) && u.contextWindow > 0;
    const knownUsage = knownLimit && Number.isFinite(u.context) && u.context >= 0
      && Number.isFinite(u.contextPercent) && u.contextPercent >= 0;
    const ratio = knownUsage ? u.contextPercent / 100 : null;
    const pct = knownUsage ? Math.min(100, u.contextPercent) : 100;
    const ctxColor = !knownUsage ? CONTEXT_COLORS.unknown
      : ratio > CONTEXT_DANGER_RATIO ? CONTEXT_COLORS.danger
      : ratio >= CONTEXT_WARNING_RATIO ? CONTEXT_COLORS.warning : CONTEXT_COLORS.normal;
    const ctxTip = !knownLimit ? 'Context limit unknown'
      : !knownUsage ? 'Context usage temporarily unknown'
      : 'Context: ' + fmtTokens(u.context) + ' / ' + fmtTokens(u.contextWindow);
    const ctxNumber = knownUsage ? fmtTokens(u.context) : '?';
    const ctxDetail = (knownUsage ? u.contextPercent.toFixed(1) : '?') + '%/'
      + (knownLimit ? fmtTokens(u.contextWindow).replace(/\.0k$/, 'k') : '?');
    /* Current-session usage resets when a new native conversation starts. */
    const real = Number(u.cost || 0);
    const money = (v) => v < 0.01 ? '$' + v.toFixed(4) : '$' + v.toFixed(2);
    const priceTip =
      'This conversation: ' + money(real) + ' (' + (u.turns || 0) + ' turns)' +
      '\nInput: ' + (u.input || 0) + ' tokens, output: ' + (u.output || 0) + ' tokens' +
      (u.cacheRead ? '\nCached input: ' + u.cacheRead + ' tokens' : '') +
      (u.allTime ? '\nAll time: ' + money(u.allTime.cost) + ' (' + u.allTime.turns + ' turns)' : '');
    /* Show current-session cost without substituting all-time totals for zero. */
    const priceShown = money(real);
    const mdl = String(u.model || '').split('/').pop();
    // Mount once; reasoning and source export keep persistent controls in this row.
    if (!el.querySelector('.us-stats')) {
      el.insertAdjacentHTML('afterbegin',
        '<span class="us-stats"><span class="us-input" title="Input"></span>' +
        '<span class="us-output" title="Output"></span><span class="us-cache" title="Cached input"></span>' +
        '<span class="us-cost"></span><span class="us-ctx"><i></i></span><span class="us-ctxnum"></span></span>' +
        '<span class="us-ctxdetail"></span><span class="us-model" title="Model"></span>');
    }
    const setText = (selector, text) => {
      const node = el.querySelector(selector);
      if (node.textContent !== text) node.textContent = text;
      return node;
    };
    setText('.us-input', '\u2191' + fmtTokens(u.input));
    setText('.us-output', '\u2193' + fmtTokens(u.output));
    const cache = setText('.us-cache', u.cacheRead ? '\u26A1' + fmtTokens(u.cacheRead) : '');
    cache.style.display = u.cacheRead ? '' : 'none';
    setText('.us-cost', priceShown).title = priceTip;
    el.querySelector('.us-ctx').title = ctxTip;
    const fill = el.querySelector('.us-ctx i');
    fill.style.width = pct + '%';
    fill.style.background = ctxColor;
    setText('.us-ctxnum', ctxNumber);
    setText('.us-ctxdetail', ctxDetail);
    setText('.us-model', mdl).style.display = mdl ? '' : 'none';
    window.__paintThinking?.(u.model);
  }
  /* Prefer the catalog label; otherwise normalize the provider-qualified model ID. */
  function shortModel(id) {
    if (!id) return '';
    let label = '';
    if (modelList) {
      const hit = modelList.find(m => m.id === id);
      if (hit && hit.label) label = hit.label;
    }
    if (!label) {
      let s = String(id);
      s = s.replace(/^openrouter\//, '');        // openrouter/google/… -> google/…
      const parts = s.split('/');
      s = parts[parts.length - 1];               // Use the final path segment as the name.
      label = s.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
    /* Remove redundant display suffixes such as Code and HSPD. */
    return label.replace(/\s+(code|hspd)\b.*$/i, '').trim() || label;
  }
  function resetUsageContext(model) {
    usageRevision++;
    renderUsage({ ...(lastUsage || {}), model, context: null, contextWindow: null, contextPercent: null });
  }
  async function loadUsage() {
    const revision = ++usageRevision;
    try {
      const r = await fetch('/api/chat/usage', { credentials: 'same-origin' });
      if (!r.ok) throw new Error('Usage unavailable');
      const usage = await r.json();
      if (revision === usageRevision) {
        if (!usage || usage.ok === false) resetUsageContext(lastUsage?.model);
        else renderUsage(usage);
      }
    } catch (e) {
      if (revision === usageRevision) resetUsageContext(lastUsage?.model);
    }
  }
  function usageWatch(on) {
    if (usageTimer) { clearInterval(usageTimer); usageTimer = null; }
    // Poll usage more frequently during an active turn.
    usageTimer = setInterval(loadUsage, on ? 2000 : 20000);
  }

  /* Check the authenticated browser session before model requests. */
  let chatUnlocked = true;

  async function checkChatAccess() {
    try {
      const r = await fetch('/api/chat/status', { credentials: 'same-origin', cache: 'no-store' });
      const d = r.ok ? await r.json() : { ok: false };
      chatUnlocked = !!d.ok;
    } catch (e) { chatUnlocked = false; }
    return chatUnlocked;
  }

  let recoveredStream = null;
  let recoveryElement = null;
  function recoverChat(active) {
    if (!active) return;
    recoveredStream?.close();
    document.body.dataset.sending = '1';
    chatInput.disabled = true;
    const btn = $('chatSend');
    btn.disabled = false;
    btn.title = 'Stop agent';
    btn.setAttribute('aria-label', 'Stop agent');
    recoveryElement = addCM('', 'agent', active.agentAt);
    thinkStart(recoveryElement);
    const apply = state => {
      if (!state || state.id !== active.id) {
        finish();
        return;
      }
      if (state.responseMeta) recoveryElement.dataset.responseMeta = JSON.stringify(state.responseMeta);
      thinkBeat(recoveryElement, state);
      if (state.text) renderAnswer(recoveryElement, state.text);
      if (!state.active) finish(state.error);
    };
    const finish = error => {
      recoveredStream?.close();
      recoveredStream = null;
      document.body.dataset.sending = '';
      chatInput.disabled = false;
      btn.title = 'Send';
      btn.setAttribute('aria-label', 'Send');
      thinkStop();
      if (error) addCM(error, 'err');
      loadChat();
    };
    apply(active);
    recoveredStream = new EventSource('/api/chat/live');
    recoveredStream.onmessage = ev => {
      try { apply(JSON.parse(ev.data)); } catch (e) { console.error('Chat recovery failed', e); }
    };
    // EventSource reconnects automatically; loss of transport is not completion.
    recoveredStream.onerror = () => { btn.title = 'Connection lost — reconnecting; click to stop'; };
  }

  /* CHAT RECOVERY: restore persisted messages and tool blocks. */
  async function loadChat() {
    if (!chatMsgs || document.body.dataset.sending === '1') return;

    try {
      const r = await fetch('/api/chat/history', { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      if (document.body.dataset.sending === '1') return;
      window.__chatMessageActions?.reset();
      chatMsgs.textContent = '';
      const list = Array.isArray(d.messages) ? d.messages : [];
      for (const m of list) {
        if (m.role === 'agent' && !m.text) continue;
        /* Preserve role exactly: server deletion matches the timestamp/role pair. */
        addCM(m.text, m.role === 'me' ? 'me' : m.role === 'note' ? 'note' : m.role === 'err' ? 'err' : 'agent', m.at, m.tools, m.responseMeta);
      }
      if (list.length && list[list.length - 1].role === 'agent' && list[list.length - 1].text) showCompletionNote();
      if (d.active) recoverChat(d.active);
      chatMsgs.scrollTop = chatMsgs.scrollHeight;
    } catch (e) {}
  }

  function showCompletionNote() {
    if (!chatMsgs) return;
    chatMsgs.querySelectorAll('.chat-completion-note').forEach(n => n.remove());
    const note = document.createElement('div');
    note.className = 'chat-completion-note';
    note.textContent = 'GPT can make mistakes. Check important info.';
    chatMsgs.appendChild(note);
    if (chatStick) followTranscript();
  }

  let stoppingAgent = false;
  async function stopChatAgent() {
    if (stoppingAgent) return;
    stoppingAgent = true;
    const btn = $('chatSend');
    if (btn) btn.title = 'Stopping…';
    try {
      const r = await fetch('/api/chat/stop', { method: 'POST', credentials: 'same-origin' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
    } catch (e) {
      window.PiWebNotice.show('Could not stop the agent: ' + e.message);
    } finally {
      stoppingAgent = false;
    }
  }

  async function sendChat() {
    if (!chatInput || chatInput.disabled || document.body.dataset.sending === '1') return;
    const t = chatInput.value.trim();
    if (!t) return;
    if (t.length > 6000) {
      window.PiWebNotice.show('Message is too long (' + t.length + ' characters). The limit is 6000. Split it into smaller messages.');
      return;
    }

    chatMsgs.querySelectorAll('.chat-completion-note').forEach(n => n.remove());
    chatInput.value = '';
    resizeChatInput();

    /* Treat input as an ordinary model message, never as an access code. */
    chatInput.disabled = true;
    const btn = $('chatSend');
    if (btn) { btn.disabled = false; btn.title = 'Stop agent'; btn.setAttribute('aria-label', 'Stop agent'); }
    chatStick = true;
    /* Do not replace this client's in-flight turn with shared transcript events. */
    document.body.dataset.sending = '1';
    /* Assign the local user message a timestamp for server-side deletion matching. */
    const mine = addCM(t, 'me');
    const mineAt = Date.now();
    mine.dataset.at = String(mineAt);
    const el = addCM('', '');
    /* The answer shares the turn timestamp and uses role=agent for deletion matching. */
    el.dataset.at = String(mineAt);
    el.dataset.role = 'agent';
    thinkStart(el);
    usageWatch(true);
    let streamFinished = false;
    const markInterrupted = message => {
      thinkStop();
      const notice = document.createElement('div');
      notice.className = 'stream-notice';
      notice.style.cssText = 'color:#d5a46a;font-size:12px;margin-top:10px';
      notice.textContent = message;
      el.appendChild(notice);
    };

    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          message: t,
          // The server reads active instructions; do not send cached or paused text.
          memory: agentMemory,
          // The server owns execution privileges; tools are always enabled.
          root: agentRoot,
          
          

          // Keep the timestamp consistent with the persisted server message.
          at: mineAt
        })
      });
      
      if (!r.ok) {
        document.body.dataset.sending = '';
        // Restore the draft when a busy response rejects this turn.
        const T = (UI_I18N[lang] && UI_I18N[lang]) || UI_I18N.en;
        let msg;
        if (r.status === 409) {
          msg = T.errBusy || UI_I18N.en.errBusy;
        } else {
          msg = 'HTTP ' + r.status;
          try { const j = await r.json(); if (j && j.error) msg = j.error; } catch {}
        }
        thinkStop();
        el.remove();
        mine.remove();
        addCM(msg, 'err');
        chatInput.value = t; // Any HTTP rejection: preserve the unsent draft.
        resizeChatInput();
        return;
      }
      /* User and answer bubbles are separate; keep the shared lock until turn completion. */
      mine.dataset.busy = '';

      const reader = r.body.getReader(), dec = new TextDecoder();
      let acc = '', pending = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        const parts = acc.split('\n\n');
        acc = parts.pop() || '';
        for (const p of parts) {
          /* A chunk's final SSE event line may lack a trailing newline; accept it
             so completion events are not lost. */
          const ev = p.match(/^event: (.+)$/m), da = p.match(/^data: (.+)$/m);
          if (!ev || !da) continue;
          let d; try { d = JSON.parse(da[1]); } catch { continue; }

          if (ev[1] === 'beat') {
            // Heartbeat carries elapsed time and current activity.
            thinkBeat(el, d);
          } else if (ev[1] === 'progress') {
            const txt = d.text || '';
            if (!txt.trim()) continue;
            pending = txt;
            thinkStop();
            renderAnswer(el, txt);
            if (chatStick) followTranscript();
          } else if (ev[1] === 'done') {
            if (d.userAt) mine.dataset.at = String(d.userAt);
            if (d.agentAt) el.dataset.at = String(d.agentAt);
            if (d.responseMeta) el.dataset.responseMeta = JSON.stringify(d.responseMeta);
            streamFinished = true;
            thinkStop();
            if (Array.isArray(d.tools)) renderTools(el, d.tools);
            renderAnswer(el, d.reply);
            thinkFold(el);           // Collapse completed reasoning.
            showCompletionNote();
          } else if (ev[1] === 'error') {
            streamFinished = true;
            markInterrupted(d.message || 'Execution failed. Received output has been preserved.');
          }
        }
      }
      if (!streamFinished) {
        markInterrupted('Stream ended without completion confirmation. The response may be incomplete. Received output has been preserved.');
      }
      if (!pending && !el.classList.contains('err')) {
        thinkStop();
        if (el.textContent.trim().length < 3) el.textContent = '(empty)';
      }
    } catch (e) {
      markInterrupted('Connection lost. Reconnecting to the active response…');
    } finally {
      document.body.dataset.sending = '';
      thinkStop();
      usageWatch(false);
      loadUsage();
      chatInput.disabled = false;
      if (btn) { btn.disabled = false; btn.title = 'Send'; btn.setAttribute('aria-label', 'Send'); }
      // Do not force focus after streaming or reopen the mobile keyboard.
      if (!streamFinished) loadChat();
    }
  }

  /* Model picker opened from the status label. */
  let modelList = null;   // Cached server model catalog.
  let modelCurrent = '';

  function mpopClose() {
    const p = $('mPop');
    if (p) p.hidden = true;
  }

  function mpopPlace() {
    const p = $('mPop');
    if (!p) return;

    const MK = 'pi-web.mPopSize';

    /* Bind resizing once. */
    if (!p.dataset.rz && typeof makeResizable === 'function') {
      p.dataset.rz = '1';
      makeResizable(p, 60, 40, () => {
        try {
          const r = p.getBoundingClientRect();
          localStorage.setItem(MK, JSON.stringify({
            w: Math.round(r.width), h: Math.round(r.height)
          }));
        } catch (e) {}
      });
    }

    p.hidden = false;

    /* Refit changed model lists unless the user manually chose the panel height. */
    try {
      const saved = JSON.parse(localStorage.getItem('pi-web.mPopSize') || 'null');
      if (saved && saved.user !== true) localStorage.removeItem('pi-web.mPopSize');
    } catch (e) {}

    /* Model-picker position is anchored; only dimensions are saved. */
    requestAnimationFrame(() => {
      /* Bound the initial column width independently of viewport size. */
      const defW = Math.round(Math.max(130, Math.min(168, window.innerWidth * 0.25)));
      if (!p.__pin && typeof cornerBox === 'function') {
        p.__pin = cornerBox(p, MK, { minW: 120, minH: 100 });
      }
      if (p.__pin) { p.__pin.place(defW, 0); return; }
      const w = defW;
      p.style.width = w + 'px';
      p.style.height = 'auto';
      const h = Math.min(p.getBoundingClientRect().height || 200, window.innerHeight - 20);
      p.style.left = (window.innerWidth - w - 5) + 'px';
      p.style.top = (window.innerHeight - h - 5) + 'px';
    });
  }

  function mpopRender() {
    const list = $('mPopList');
    if (!list || !modelList) return;
    list.textContent = '';
    for (const m of modelList) {
      const row = document.createElement('div');
      row.className = 'mpop-item t-' + (m.tier || 'good') + (m.id === modelCurrent ? ' on' : '');
      row.innerHTML =
        '<span class="mpop-dot"></span>' +
        '<span class="mpop-body">' +
          '<span class="mpop-name">' + esc(shortModel(m.id) || m.label) + '</span>' +
          '<span class="mpop-hint">' + esc(m.hint) + '</span>' +
        '</span>';
      row.onclick = () => mpopPick(m.id);
      list.appendChild(row);
    }
  }

  async function mpopLoad() {
    try {
      const r = await fetch('/api/chat/models', { credentials: 'same-origin' });
      if (!r.ok) return false;
      const d = await r.json();
      // Sort by descending output-token price, not the sum of input and output rates.
      modelList = (d.models || []).slice().sort((a, b) =>
        (b.outUsd - a.outUsd) || (b.inUsd - a.inUsd));
      modelCurrent = d.current || '';
      return true;
    } catch (e) { return false; }
  }

  async function mpopOpen() {
    const p = $('mPop');
    if (!p) return;
    if (!modelList && !(await mpopLoad())) {
      toast('Chat access key required');
      return;
    }
    mpopRender();
    p.hidden = false;
    mpopPlace();
    /* Fit model rows using the same content-sizing rules as actions and Resume. */
    requestAnimationFrame(() => {
      const saved = (() => {
        try { return JSON.parse(localStorage.getItem('pi-web.mPopSize') || 'null'); }
        catch (e) { return null; }
      })();
      if (saved && saved.user === true) return;   // Preserve manually chosen dimensions.
      const l = $('mPopList');
      if (!l) return;
      const pad = 2;
      const h = l.scrollHeight + pad;
      p.style.height = 'auto';
      p.style.height = Math.round(h) + 'px';
      /* Fit width to the widest row plus padding. */
      p.style.width = 'auto';
      let widest = 0;
      for (const ch of l.children) {
        if (getComputedStyle(ch).display === 'none') continue;
        const cw = ch.getBoundingClientRect().width;
        if (cw > widest) widest = cw;
      }
      const lcs = getComputedStyle(l);
      widest += (parseFloat(lcs.paddingLeft) || 0) + (parseFloat(lcs.paddingRight) || 0);
      p.style.width = Math.max(130, Math.min(Math.round(widest + 2), 240)) + 'px';
      if (p.__pin && p.__pin.stick) p.__pin.stick();
    });
  }

  async function mpopPick(id) {
    if (id === modelCurrent) { mpopClose(); return; }
    const m = (modelList || []).find(x => x.id === id);
    const label = m ? m.label : id;
    try {
      const r = await fetch('/api/chat/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ model: id })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.error || 'Could not switch models'); return; }
      modelCurrent = d.current || id;
      /* Cache the selected model in this browser as well as on the server. */
      // Clear old context immediately and invalidate in-flight usage responses.
      resetUsageContext(modelCurrent);
      mpopClose();
      // Move the selection indicator to the newly selected model.
      if (typeof mpopLoad === 'function') await mpopLoad();
      // Refresh the transcript after a context change.
      loadChat();
      loadUsage();
    } catch (e) {
      toast('Error: ' + e.message);
    }
  }

  // Open the picker from the status model label.
  document.addEventListener('click', (e) => {
    const m = e.target.closest && e.target.closest('.chat-usage .us-model');
    if (m) { e.preventDefault(); mpopOpen(); return; }
    const p = $('mPop');
    if (p && !p.hidden && !p.contains(e.target)) mpopClose();
  });
  if ($('mPopClose')) $('mPopClose').onclick = mpopClose;
  window.addEventListener('resize', () => { const p = $('mPop'); if (p && !p.hidden) mpopPlace(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') mpopClose(); });

  if ($('chatSend')) $('chatSend').onclick = () => {
    if (document.body.dataset.sending === '1') stopChatAgent();
    else sendChat();
  };
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.body.dataset.sending === '1') {
      e.preventDefault();
      stopChatAgent();
    }
  });
  // Optional browser dictation: explicit click only; never auto-submit.
  {
    const mic = $('chatMic');
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (mic) {
      mic.hidden = false;
      if (!SpeechRecognition) {
        mic.disabled = true;
        mic.title = 'Voice input is not supported by this browser';
      } else {
        const recognition = new SpeechRecognition();
        recognition.lang = navigator.language || 'en-US';
        recognition.interimResults = false;
        let recording = false;
        mic.onclick = () => {
          if (!chatInput || chatInput.disabled) return;
          if (recording) { recognition.stop(); return; }
          try { recognition.start(); } catch (e) { mic.title = 'Unable to start voice input'; }
        };
        recognition.onstart = () => { recording = true; mic.classList.add('recording'); mic.title = 'Stop dictation'; };
        recognition.onend = () => { recording = false; mic.classList.remove('recording'); mic.title = 'Voice input'; };
        recognition.onerror = e => { mic.title = 'Voice input: ' + e.error; };
        recognition.onresult = e => {
          if (chatInput.disabled) return;
          const text = Array.from(e.results).slice(e.resultIndex).map(r => r[0].transcript).join(' ');
          chatInput.value += (chatInput.value ? ' ' : '') + text;
          resizeChatInput();
        };
      }
    }
  }

  /* Fullscreen control. */
  /* Apply the single supported Chat appearance. */

  /* Share the native fullscreen owner with the profile settings page. */
  void import('./fullscreen-control.js?v=1').then(({ initFullscreenControl }) => {
    initFullscreenControl(document.getElementById('styleSwitch'));
  }).catch(error => console.warn('fullscreen:', error));

  (function () {
    const brand = document.querySelector('.app-brand');
    if (!brand) return;
    let lit = false;
    const setLit = (on) => {
      if (lit === on) return;
      lit = on;
      brand.classList.toggle('lit', on);
    };
    brand.addEventListener('mouseenter', () => setLit(true));
    brand.addEventListener('mouseleave', () => setLit(false));
    brand.addEventListener('pointerenter', () => setLit(true));
    brand.addEventListener('pointerleave', () => setLit(false));
    brand.addEventListener('pointerdown', () => setLit(true));
    /* Preserve hover feedback after pointer release. */
    brand.addEventListener('pointerup', () => setLit(true));
    brand.addEventListener('click', () => setLit(true));
    /* Reconcile pointer feedback periodically. */
    let mx = -1, my = -1;
    document.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; }, true);
    setInterval(() => {
      if (mx < 0) return;
      const r = brand.getBoundingClientRect();
      const inside = mx >= r.left && mx <= r.right && my >= r.top && my <= r.bottom;
      setLit(inside);
    }, 300);
  })();

  /* Restore the unsent draft after an automatic reload. */
  (function () {
    try {
      const typed = sessionStorage.getItem('pi-web.pendingInput');
      sessionStorage.removeItem('pi-web.pendingInput');
      if (typed && chatInput) { chatInput.value = typed; chatInput.style.height = 'auto'; }
    } catch (e) {}
  })();

  /* Focus the composer on startup without placeholder text. */
  (function () {
    const inp = $('chatInput');
    if (!inp) return;
    const focusNow = () => { try { if (!inp.disabled) inp.focus({ preventScroll: true }); } catch (e) {} };
    if (document.readyState === 'complete') setTimeout(focusNow, 0);
    else window.addEventListener('load', () => setTimeout(focusNow, 0), { once: true });
  })();

  /* Double-tap SEND toggles expanded status. */
  (function () {
    const send = $('chatSend');
    const plus = $('chatPlus');
    const pop = $('chatPop');
    if (!send) return;
    const KEY = 'pi-web.expanded';
    /* Recognize expansion gestures within a 400ms window. */
    const DOUBLE_MS = 400;
    let armed = false;
    let lastTapAt = 0;

    function apply(on) {
      armed = !!on;
      lastTapAt = 0;
      document.body.classList.toggle('expanded', armed);
      try { localStorage.setItem(KEY, armed ? '1' : '0'); } catch (e) {}
      /* Compact mode hides status without moving the composer. */
      document.body.classList.remove('input-hidden');
    }

    /* Default to expanded status and restore the saved expansion state. */
    try {
      const saved = localStorage.getItem(KEY);
      apply(saved === null ? true : saved === '1');
    } catch (e) { apply(true); }

    /* With empty input, double-tap toggles status and a single tap does nothing.
       With a draft, a single tap sends the message. */
    send.addEventListener('click', (ev) => {
      if (document.body.dataset.sending === '1') { lastTapAt = 0; return; }
      const typed = chatInput ? chatInput.value.trim() : '';
      if (typed) { lastTapAt = 0; return; }
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const now = Date.now();
      if (now - lastTapAt > DOUBLE_MS) { lastTapAt = now; return; }
      lastTapAt = 0;
      apply(!armed);
      if (armed && chatInput) chatInput.focus();
    }, true);
  })();

  /* Upload attachments through /files/ and send the resulting reference to the model. */
  const attachBtn = $('chatFilesX'), attachInp = $('chatAttach');
  if (attachBtn && attachInp) {
    attachBtn.onclick = event => { event.stopPropagation(); attachInp.click(); };
    attachInp.addEventListener('change', async () => {
      const file = attachInp.files?.[0];
      if (!file) return;
      attachBtn.disabled = true;
      try {
        const fd = new FormData();
        fd.append('sub', '');
        fd.append('file', file);
        const r = await fetch('/files/upload', { method: 'POST', body: fd });
        const result = await r.json();
        if (!r.ok) throw new Error(result.error || 'Upload failed.');
        chatInput.value = (chatInput.value ? chatInput.value + '\n' : '') +
          'File: ' + result.name + '\n' + result.url + '\nLocal file: ' + result.localPath;
        sendChat();
      } catch (e) {
        window.PiWebNotice.show(e.message || 'Could not attach the file.');
      } finally {
        attachBtn.disabled = false;
        attachInp.value = '';
      }
    });
  }

  /* Usage is part of the authenticated interface. */
  checkChatAccess().then(() => {
    loadUsage();
    usageWatch(false);
  });
  function resizeChatInput() {
    if (!chatInput) return;
    const previousTop = chatMsgs?.scrollTop;
    chatInput.style.height = 'auto';
    if (!chatInput.value) {
      chatInput.style.overflowY = 'hidden';
    } else {
      const natural = chatInput.scrollHeight;
      chatInput.style.height = Math.min(natural, 160) + 'px';
      chatInput.style.overflowY = natural > 160 ? 'auto' : 'hidden';
    }
    // Composer resizing changes the viewport, not the transcript. Keep its
    // anchor in this layout pass rather than animating a catch-up afterwards.
    if (chatMsgs) chatMsgs.scrollTop = chatStick
      ? chatMsgs.scrollHeight
      : previousTop;
  }
  if (chatInput) {
    chatInput.addEventListener('input', resizeChatInput);
    chatInput.addEventListener('keydown', e => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
    resizeChatInput();
  }

  /* Startup. */
  applyUiLang(lang);

  watch();
  setTimeout(loadChat, 300);

  // The standalone control panel always opens its only transcript.
  dChat.classList.add('open');
  setTimeout(loadUsage, 700);
})();
