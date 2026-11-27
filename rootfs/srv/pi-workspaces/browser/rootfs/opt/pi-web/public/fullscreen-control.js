// The black chat and profile settings use the same native fullscreen behavior.
export function initFullscreenControl(button, { onUnavailable = () => {} } = {}) {
  if (!button) return;
  const active = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  const paint = () => {
    const enabled = active();
    document.body.classList.toggle('is-fullscreen', enabled);
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-label', enabled ? 'Exit full screen' : 'Full screen');
    button.title = enabled ? 'Exit full screen' : 'Full screen';
  };
  let pending = false;
  button.addEventListener('click', async () => {
    if (pending) return;
    pending = true;
    try {
      const target = active() ? document : document.documentElement;
      const method = active() ? document.exitFullscreen || document.webkitExitFullscreen
        : target.requestFullscreen || target.webkitRequestFullscreen;
      if (!method) { onUnavailable(); return; }
      await method.call(target);
    } catch (error) {
      console.warn('fullscreen:', error);
      onUnavailable();
    } finally { pending = false; paint(); }
  });
  document.addEventListener('fullscreenchange', paint);
  document.addEventListener('webkitfullscreenchange', paint);
  paint();
}
