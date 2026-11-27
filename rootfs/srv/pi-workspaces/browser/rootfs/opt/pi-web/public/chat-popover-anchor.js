/* Anchor chat popovers to the visible viewport, including mobile zoom/keyboard. */
(() => {
  function update() {
    const v = window.visualViewport;
    const width = v ? v.width : innerWidth;
    const height = v ? v.height : innerHeight;
    const right = v ? Math.max(0, innerWidth - v.offsetLeft - width) : 0;
    const bottom = v ? Math.max(0, innerHeight - v.offsetTop - height) : 0;
    const style = document.documentElement.style;
    style.setProperty('--chat-popup-right', (right + 8) + 'px');
    style.setProperty('--chat-popup-bottom', (bottom + 8) + 'px');
    style.setProperty('--chat-popup-width', Math.max(0, width - 16) + 'px');
    style.setProperty('--chat-popup-height', Math.max(0, height - 16) + 'px');
  }
  addEventListener('resize', update);
  if (visualViewport) {
    visualViewport.addEventListener('resize', update);
    visualViewport.addEventListener('scroll', update);
  }
  update();
})();
