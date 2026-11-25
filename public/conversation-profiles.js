import { createProfilePicker } from './profile-picker.js?v=2';
import { initFullscreenControl } from './fullscreen-control.js?v=1';

'use strict';
(() => {
  initFullscreenControl(document.querySelector('#profile-fullscreen'), { onUnavailable: () => {
    const notice = document.querySelector('#fullscreen-status');
    notice.textContent = 'Full screen is unavailable in this browser. On iPhone, add this page to your Home Screen for a standalone view.';
    notice.hidden = false;
  } });
  // Clicking outside an editor returns its scroll gestures to the page.
  // Keyboard focus and native touch scrolling remain browser-managed.
  document.addEventListener('pointerdown', event => {
    const active = document.activeElement;
    if (active instanceof HTMLTextAreaElement && active !== event.target) active.blur();
  });
  const endpoint = '/api/conversation-profiles';
  const fields = ['textOutput', 'voiceOutput', 'piOn', 'model', 'thinking', 'replyMode', 'systemPrompt', 'character', 'customPrompt', 'customOn', 'basePrompt', 'baseOn', 'toolsOn',
    'tail', 'tailOn', 'personLimit', 'memoryLimit', 'backgroundLimit'];
  const profileFields = editor => fields.concat(editor.item.kind === 'group' ? ['personOn', 'groupOn', 'backgroundOn'] : ['memory']);
  const status = document.querySelector('#status');
  const editors = new Map();
  const metadataCache = new Map();
  let revision = 0, pending = false, syncing = false;
  let catalog = [], addressingNames = null;
  const request = async (url, body) => {
    const response = await fetch(url, { cache: 'no-store', ...(body ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    } : {}) });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Request failed');
    return data;
  };
  const message = (element, text, error = false) => {
    element.textContent = text; element.classList.toggle('error', error);
  };
  const metadataFor = model => {
    if (!metadataCache.has(model)) {
      metadataCache.set(model, request(endpoint + '/thinking?model=' + encodeURIComponent(model))
        .catch(error => { metadataCache.delete(model); throw error; }));
    }
    return metadataCache.get(model);
  };
  const updateReplyHint = editor => {
    const mode = editor.form.elements.replyMode.value;
    const privateConversation = editor.item.kind === 'private' || editor.item.kind === 'private_default';
    let text;
    if (mode === 'off') text = 'Does not reply to conversation messages. Control commands remain available.';
    else if (privateConversation) text = 'Replies to incoming private messages. No tag, reply or name is needed; each person keeps a separate history.';
    else if (mode === 'all') text = 'Replies to every incoming message in this chat, without needing a tag, reply or name.';
    else if (mode === 'mentions') text = 'Replies only to exact Telegram @mentions. A reply without a tag does not trigger it.';
    else if (mode === 'addressed') {
      const names = addressingNames === null ? 'Name triggers are unavailable.'
        : addressingNames.length ? 'Also: ' + addressingNames.map(name => '“' + name + '”').join(', ') + ' (whole words, any case).'
        : 'No name triggers are configured.';
      text = 'Bot @mentions or replies to its messages. ' + names + ' For name mentions, checks context and may stay silent.';
    } else text = 'Replies to an exact Telegram @mention of the bot or a reply to one of its messages.';
    const hint = editor.section.querySelector('[data-reply-hint]');
    if (hint.textContent !== text) hint.textContent = text;
  };
  const currentSettings = editor => Object.fromEntries(profileFields(editor).map(name => {
    const input = editor.form.elements[name];
    return [name, input.type === 'checkbox' ? input.checked : input.type === 'number' ? input.valueAsNumber : input.value];
  }));
  const selectProfile = (id, push = false) => {
    if (!editors.has(id)) id = editors.keys().next().value;
    if (!id) return;
    const salon=document.querySelector('#salon-link');if(salon)salon.href='/go/hub?chat='+encodeURIComponent(id);
    for (const [key, editor] of editors) {
      editor.section.hidden = key !== id;
      if (key === id) editor.tab.setAttribute('aria-current', 'page');
      else editor.tab.removeAttribute('aria-current');
    }
    const url = new URL(location.href); url.searchParams.set('chat', id);
    if (push) history.pushState(null, '', url);
    else history.replaceState(null, '', url);
  };
  const updateThinking = async (editor, selected) => {
    const generation = ++editor.metadataGeneration;
    editor.metadataPending = true; editor.form.elements.thinking.disabled = true;
    try {
      const model = editor.form.elements.model.value;
      const metadata = await metadataFor(model);
      if (generation !== editor.metadataGeneration || editor.form.elements.model.value !== model) return;
      editor.form.elements.thinking.replaceChildren(...metadata.levels.map(level => new Option(({medium:'Med', minimal:'Min', xhigh:'XHi', high:'High', low:'Low', off:'Off'})[level.toLowerCase()] ?? level, level)));
      editor.form.elements.thinking.value = metadata.levels.includes(selected) ? selected : metadata.level;
      editor.metadataPending = false; editor.form.elements.thinking.disabled = pending;
    } catch (error) {
      if (generation === editor.metadataGeneration) message(editor.feedback, error.message, true);
    }
  };
  function fill(editor, item) {
    editor.item = item;
    updateReplyHint(editor);
    const scope = editor.section.querySelector('[data-memory-scope]');
    scope.textContent = item.settings.memoryResetAt > 0
      ? 'History: since the last New Chat. Old Chat reopens earlier retained messages.'
      : 'History: all retained messages, within the saved limits.';
    editor.section.querySelector('.scope').textContent = item.independent ? 'Independent settings' : 'Current defaults until first save';
    const notice = editor.section.querySelector('[data-notice]');
    notice.textContent = item.notice || ''; notice.hidden = !item.notice;
    editor.tab.textContent = item.label;
    const fingerprint = JSON.stringify(item.settings);
    if (editor.dirty) {
      if (fingerprint !== editor.baseline) {
        editor.conflict = true;
        message(editor.feedback, 'Changed on another device. Your draft is kept; reload this page before saving.', true);
      }
      return;
    }
    if (fingerprint === editor.baseline) return;
    editor.baseline = fingerprint; editor.conflict = false;
    if (!catalog.some(model => model.id === item.settings.model)
        && ![...editor.form.elements.model.options].some(option => option.value === item.settings.model)) {
      editor.form.elements.model.add(new Option(item.settings.model, item.settings.model));
    }
    const legacy = [...editor.form.elements.replyMode.options].find(option => option.value === 'mentions');
    if (item.settings.replyMode === 'mentions' && !legacy) editor.form.elements.replyMode.add(new Option('Tag', 'mentions'));
    else if (item.settings.replyMode !== 'mentions' && legacy) legacy.remove();
    for (const name of profileFields(editor)) {
      if (name === 'thinking') continue;
      const input = editor.form.elements[name];
      if (input.type === 'checkbox') input.checked = item.settings[name];
      else input.value = item.settings[name] ?? (name === 'personLimit' ? 0 : '');
    }
    updateReplyHint(editor);
    for (const picker of editor.pickers) picker.refresh();
    void updateThinking(editor, item.settings.thinking);
  }
  let reference;
  function addShowControls(form, id) {
    for (const [toggle, name] of Object.entries({piOn: 'pi', baseOn: 'basePrompt', systemPrompt: 'character', customOn: 'customPrompt', tailOn: 'tail'})) {
      const heading = form.elements[toggle].closest('.field-heading');
      const area = name === 'pi' ? form.querySelector('[data-pi-reference]') : form.elements[name];
      area.id = 'block-' + id + '-' + name;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Show';
      button.className = 'instruction-show'; button.setAttribute('aria-controls', area.id);
      button.setAttribute('aria-label', 'Show ' + heading.textContent.trim() + ' text'); heading.append(button);
      const key = 'profiles.show.' + id + '.' + name;
      const display = open => {
        area.hidden = !open; button.setAttribute('aria-expanded', String(open));
        if (open && name === 'pi') {
          const pre = area.querySelector('pre'); pre.textContent = 'Loading…';
          reference ??= request(endpoint + '/pi-reference').catch(error => { reference = null; throw error; });
          reference.then(data => { pre.textContent = data.text; }, error => { pre.textContent = error.message; });
        }
      };
      let initial = false; try { initial = localStorage.getItem(key) === '1'; } catch {}
      display(initial);
      button.addEventListener('click', () => { display(area.hidden); try { localStorage.setItem(key, area.hidden ? '0' : '1'); } catch {} });
    }
  }
  function addRequestInspector(section) {
    const details = document.createElement('details'); details.className = 'request-inspector';
    details.innerHTML = '<summary>Request JSON</summary><p>One test in My DM. Turn off Tools, Dialogue and Response style; send a new message containing only ok. Expires after 10 minutes.</p><button type="button" data-arm>Capture next ok</button> <button type="button" data-clear>Clear</button><p role="status"></p><pre></pre>';
    section.append(details);
    const api = '/api/owner-request-inspection', status = details.querySelector('[role=status]'), pre = details.querySelector('pre');
    let seq = 0, busy = false;
    const update = async action => {
      if (busy || !details.open || section.hidden || document.hidden) return;
      busy = true; const id = ++seq;
      try {
        const data = await request(api, action ? {action} : undefined);
        if (id !== seq || !details.open) return;
        status.textContent = ({armed:'Waiting for the next ok in My DM.',captured:'Captured before sending to the provider.',off:'Not recording.'})[data.state];
        pre.textContent = data.state === 'captured' ? JSON.stringify(data.body,null,2) : '';
      } catch (error) { status.textContent = error.message; pre.textContent = ''; } finally { busy = false; }
    };
    details.querySelector('[data-arm]').onclick = () => update('arm'); details.querySelector('[data-clear]').onclick = () => update('clear');
    details.ontoggle = () => { if (details.open) void update(); else { seq++; pre.textContent = ''; } };
    setInterval(() => { if (details.open && !document.hidden && !section.hidden) void update(); else pre.textContent = ''; }, 2000);
  }
  function setDirty(editor, dirty) {
    if (editor.dirty === dirty) return;
    editor.dirty = dirty;
    editor.draftStatus.textContent = dirty ? editor.draftStatus.dataset.label : '';
  }
  function createEditor(item) {
    const section = document.querySelector('#profile-template').content.firstElementChild.cloneNode(true);
    section.dataset.profile = item.id;
    if (item.id === 'owner_dm') addRequestInspector(section);
    section.querySelector('h2').textContent = item.label;
    const privateConversation = item.kind === 'private' || item.kind === 'private_default';
    section.querySelector('.identity').textContent = item.kind === 'private_default'
      ? 'Shared defaults; each person keeps a separate conversation and history.'
      : privateConversation ? 'Your private Telegram conversation.' : 'Telegram ' + (item.chatIds || [item.chatId]).join(' / ');
    const form = section.querySelector('form');
    const toolbar = document.createElement('div'); toolbar.className = 'profile-toolbar';
    form.prepend(toolbar);
    addShowControls(form, item.id);
    toolbar.append(form.querySelector('.grid'), form.elements.toolsOn.closest('.field-heading'), form.querySelector('.memory-grid'), form.querySelector('.actions'));
    const replyHint = section.querySelector('[data-reply-hint]');
    replyHint.id = 'reply-hint-' + item.id;
    form.elements.replyMode.setAttribute('aria-describedby', replyHint.id);
    const pickers = ['model', 'thinking', 'replyMode'].map(name => createProfilePicker(form.elements[name]));
    if (privateConversation) {
      form.elements.groupOn.closest('.number-slot').title = 'Earlier messages in this private conversation';
      form.elements.groupOn.name = 'memory'; // The existing DM gate, not a group-wide switch.
      form.querySelector('[data-dialogue-label]').textContent = 'Dialogue';
    }
    for (const slot of form.querySelectorAll('.number-slot')) {
      const toggle = slot.querySelector('[type=checkbox]'), count = slot.querySelector('[type=number]');
      if (privateConversation && slot.hasAttribute('data-group-only')) {
        slot.hidden = toggle.disabled = count.disabled = true;
        continue;
      }
      count.id = `${item.id}-${count.name}`;
      toggle.setAttribute('aria-controls', count.id);
      toggle.addEventListener('change', () => {
        // Pausing keeps the displayed count. A never-used window starts at one.
        if (toggle.checked && !(count.valueAsNumber > 0)) { count.value = '1'; count.focus(); count.select(); }
      });
      count.addEventListener('input', () => { if (count.validity.valid) toggle.checked = count.valueAsNumber > 0; });
      count.addEventListener('focus', () => count.select());
    }
    if (item.kind === 'private_default') section.querySelector('[data-reset-hint]').textContent =
      'New Chat starts a fresh context separately for every guest. Old Chat reopens each guest\'s own retained history within the enabled Dialogue window. People never share history. Neither action deletes logs or cancels active replies; removed messages cannot be restored.';
    for (const model of catalog) {
      const label = model.label || model.name || model.id;
      form.elements.model.add(new Option(label, model.id));
    }
    const tab = document.createElement('a'); tab.className = 'nav-button'; tab.textContent = item.label;
    tab.href = '/profiles?chat=' + encodeURIComponent(item.id);
    tab.addEventListener('click', event => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); selectProfile(item.id, true);
    });
    const editor = { section, form, tab, item, pickers, feedback: form.querySelector('.feedback'),
      draftStatus: form.querySelector('.draft-status'), baseline: null, dirty: false, conflict: false, metadataGeneration: 0, metadataPending: false };
    form.elements.model.addEventListener('change', () => { void updateThinking(editor, ''); });
    form.elements.replyMode.addEventListener('change', () => { updateReplyHint(editor); });
    const dirty = () => {
      setDirty(editor, true);
      if (!editor.conflict && editor.feedback.textContent) message(editor.feedback, '');
    };
    form.addEventListener('input', dirty); form.addEventListener('change', dirty);
    form.addEventListener('submit', event => { event.preventDefault(); void save(editor, 'save'); });
    for (const action of ['reset', 'restore']) {
      form.querySelector(`[data-action="${action}"]`).addEventListener('click', () => { void save(editor, action); });
    }
    document.querySelector('#profile-tabs').insertBefore(tab,document.querySelector('#salon-notes'));
    document.querySelector('#profiles').append(section);
    editors.set(item.id, editor);
    return editor;
  }
  function apply(data) {
    if (data.revision < revision) return;
    revision = data.revision;
    addressingNames = Array.isArray(data.addressingNames) ? data.addressingNames : null;
    document.querySelector('#title').textContent = data.title; document.title = data.title;
    for (const item of data.profiles) {
      if (item.id === 'lake') item.label = 'Soul Lake';
      fill(editors.get(item.id) || createEditor(item), item);
    }
    selectProfile(new URL(location.href).searchParams.get('chat'));
  }
  async function save(editor, action) {
    if (pending || editor.metadataPending) return;
    if (editor.conflict) { message(editor.feedback, 'Reload this page before saving the conflicting draft.', true); return; }
    if (action !== 'save' && editor.dirty) { message(editor.feedback, 'Save or reload your edits before changing the history scope.', true); return; }
    const confirmation = action === 'reset'
      ? 'Start a fresh context for ' + editor.item.label + '? Stored logs and Telegram messages are kept.'
      : action === 'restore' ? 'Reopen all retained history for ' + editor.item.label + '? Saved window counts and switches still apply.' : '';
    if (confirmation && !window.confirm(confirmation)) return;
    pending = true;
    const settings = currentSettings(editor);
    const controls = [...document.querySelectorAll('input, textarea, select, button')];
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    try {
      const data = await request(endpoint + '/' + encodeURIComponent(editor.item.id), { action, revision, settings: action === 'save' ? settings : undefined });
      setDirty(editor, false); editor.baseline = null;
      apply(data);
      message(editor.feedback, action === 'reset' ? 'Fresh context started.' : action === 'restore'
        ? 'Retained history restored. Saved window counts and switches still apply.' : '');
    } catch (error) { message(editor.feedback, error.message, true); }
    finally {
      pending = false;
      controls.forEach((control, index) => { control.disabled = disabled[index]; });
      for (const entry of editors.values()) if (entry.metadataPending) entry.form.elements.thinking.disabled = true;
    }
  }
  async function sync() {
    if (pending || syncing || document.hidden) return;
    syncing = true;
    try { const data = await request(endpoint); if (!pending) { apply(data); message(status, ''); } }
    catch (error) { message(status, error.message, true); }
    finally { syncing = false; }
  }
  async function start() {
    try {
      const [data, models] = await Promise.all([request(endpoint), request('/api/chat/models')]);
      catalog = models.models; apply(data); message(status, data.profiles.length ? '' : 'No conversations registered.');
      setInterval(() => { void sync(); }, 5000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) void sync(); });
    } catch (error) { message(status, error.message, true); }
  }
  window.addEventListener('popstate', () => { selectProfile(new URL(location.href).searchParams.get('chat')); });
  window.addEventListener('beforeunload', event => {
    if (pending || [...editors.values()].some(editor => editor.dirty)) { event.preventDefault(); event.returnValue = ''; }
  });
  void start();
})();
