/* Selection preview follows the actual SVG hit target; it never changes document state. */
(function (scope) {
  'use strict';
  function attach(svg, enabled, resolveTarget) {
    let source = null, outline = null;
    function clear() {
      if (outline) outline.remove();
      outline = source = null;
    }
    function move(event) {
      if (!enabled() || event.buttons) { clear(); return; }
      const target = resolveTarget ? resolveTarget(event) : event.target.closest?.('[data-pick-outline]');
      if (!target || !svg.contains(target)) { clear(); return; }
      if (target === source && outline?.isConnected) return;
      clear();
      source = target;
      outline = target.cloneNode(false);
      for (const key of ['id', 'data-id', 'data-drag', 'data-pick-outline', 'data-outline-id', 'style']) outline.removeAttribute(key);
      outline.setAttribute('data-hover-preview', 'true');
      outline.setAttribute('fill', 'none');
      outline.setAttribute('stroke', '#0d99ff');
      outline.setAttribute('stroke-width', '3');
      outline.setAttribute('vector-effect', 'non-scaling-stroke');
      outline.setAttribute('pointer-events', 'none');
      target.parentNode.appendChild(outline);
    }
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerleave', clear);
    svg.addEventListener('pointerdown', clear);
    return () => {
      clear();
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerleave', clear);
      svg.removeEventListener('pointerdown', clear);
    };
  }
  scope.CurveLabSelectionHover = Object.freeze({ attach });
})(globalThis);
