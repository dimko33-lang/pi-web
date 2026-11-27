/* Camera boundary: SVG view application, browser persistence and scene coordinates.
   No geometry, network requests, gesture handlers or document-history mutations.
   Loaded as a classic script to preserve the existing editor's startup order. */
(function (scope) {
  'use strict';

  /**
   * @typedef {{x: number, y: number, w: number, h: number}} CameraView
   * @param {{
   *   svg: SVGSVGElement,
   *   readView: () => CameraView,
   *   writeView: (view: CameraView) => void,
   *   storage: () => Storage,
   *   redraw: () => void
   * }} options
   */
  function createCamera({ svg, readView, writeView, storage, redraw }) {
    const storageKey = 'curvelab.camera';
    let persistenceReady = false;

    function apply() {
      const view = readView();
      svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
      if (persistenceReady) {
        try { storage().setItem(storageKey, JSON.stringify(view)); }
        catch (e) { /* Storage is optional, including in restricted browser contexts. */ }
      }
    }

    // Restore after document initialization so its defaults cannot overwrite the camera.
    function restore() {
      try {
        const view = JSON.parse(storage().getItem(storageKey) || 'null');
        if (view && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(view[k])) && view.w > 0 && view.h > 0) {
          writeView({ x: view.x, y: view.y, w: view.w, h: view.h });
        }
      } catch (e) { /* Invalid data or inaccessible storage: retain the current view. */ }
      persistenceReady = true;
      apply();
    }

    function screenToWorld(event) {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const matrix = svg.getScreenCTM();
      if (!matrix) return [0, 0];
      const world = point.matrixTransform(matrix.inverse());
      return [world.x, world.y];
    }

    function getView() {
      try {
        const view = readView();
        return view ? { x: view.x, y: view.y, w: view.w, h: view.h } : null;
      } catch (e) { return null; }
    }

    // Preserve the existing Live hook's accepted payloads during extraction.
    function setRemoteView(view) {
      if (!view || typeof view.w !== 'number' || !(view.w > 0)) return;
      try {
        writeView({ x: view.x, y: view.y, w: view.w, h: view.h !== undefined ? view.h : readView().h });
        apply();
        redraw();
      } catch (e) { /* A remote update must not interrupt editor interaction. */ }
    }

    /** Apply wheel deltas using the editor's existing pixel/line/page conventions. */
    function panWheel({ deltaX, deltaY, deltaMode, shiftKey }) {
      const width = svg.clientWidth || 900;
      const height = svg.clientHeight || 600;
      const view = readView();
      let dx = deltaX, dy = deltaY;
      if (shiftKey && !dx) { dx = dy; dy = 0; }
      const unit = deltaMode === 1 ? 16 : (deltaMode === 2 ? height : 1);
      view.x += dx * unit * (view.w / width);
      view.y += dy * unit * (view.h / height);
      apply();
    }

    /** Scale around a scene-space anchor without moving the anchor on screen. */
    function zoomAt(x, y, factor) {
      const view = readView();
      view.x = x - (x - view.x) * factor;
      view.y = y - (y - view.y) * factor;
      view.w *= factor;
      view.h *= factor;
      apply();
    }

    return { apply, restore, screenToWorld, getView, setRemoteView, panWheel, zoomAt };
  }

  scope.CurveLabCamera = Object.freeze({ create: createCamera });
})(globalThis);
