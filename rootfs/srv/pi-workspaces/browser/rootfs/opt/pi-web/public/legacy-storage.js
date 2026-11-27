/* One-time preference migration. This file is the only browser compatibility
   boundary; it does not load or control any former project. */
(() => {
  try {
    if (localStorage.getItem('pi-web.storageVersion') !== '1') {
      const keys = ['theme', 'lang', 'chatAppearance', 'resumeBox',
        'thinkMode.lab', 'agentMemory.lab', 'agentPrompt.lab',
        'agentCustomPrompt.lab', 'agentCharacter.lab', 'agentRoot.lab'];
      for (const suffix of keys) {
        const next = 'pi-web.' + suffix.replace(/\.lab$/, '.chat');
        if (localStorage.getItem(next) !== null) continue;
        const value = localStorage.getItem('curvelab.' + suffix);
        if (value !== null) localStorage.setItem(next, value);
      }
      localStorage.setItem('pi-web.storageVersion', '1');
    }
    const pending = sessionStorage.getItem('curvelab.pendingInput');
    if (pending !== null) {
      if (sessionStorage.getItem('pi-web.pendingInput') === null) sessionStorage.setItem('pi-web.pendingInput', pending);
      sessionStorage.removeItem('curvelab.pendingInput');
    }
  } catch { /* Storage may be blocked; normal app defaults still work. */ }
})();
