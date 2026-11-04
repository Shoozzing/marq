(function (MARQ) {
  'use strict';
  // Coordinate spaces:
  //  MM     : document space (label origin top-left, y down) - what the model stores
  //  SCREEN : CSS pixels inside the editor canvas
  // view = { zoom, panX, panY }; panX/panY = screen position of label origin. zoom 1 = 100% physical (96 dpi).
  const PX_PER_MM = 96 / 25.4, MIN = 0.05, MAX = 32;
  const clamp = z => Math.min(MAX, Math.max(MIN, z));
  MARQ.Viewport = {
    PX_PER_MM, MIN_ZOOM: MIN, MAX_ZOOM: MAX, clamp,
    // Label origin on screen, rounded to whole CSS px. Canvas and rulers both use this so edges stay crisp and aligned.
    snap(v) { return { x: Math.round(v.panX), y: Math.round(v.panY) }; },
    mmToScreen(v, x, y) { const k = PX_PER_MM * v.zoom; return { x: v.panX + x * k, y: v.panY + y * k }; },
    screenToMm(v, sx, sy) { const k = PX_PER_MM * v.zoom; return { x: (sx - v.panX) / k, y: (sy - v.panY) / k }; },
    zoomAt(v, newZoom, sx, sy) { // zoom keeping screen point fixed
      const m = this.screenToMm(v, sx, sy), z = clamp(newZoom), k = PX_PER_MM * z;
      return { zoom: z, panX: sx - m.x * k, panY: sy - m.y * k };
    },
    fit(wMM, hMM, vw, vh, pad) {
      pad = pad == null ? 40 : pad;
      const z = clamp(Math.min((vw - 2 * pad) / (wMM * PX_PER_MM), (vh - 2 * pad) / (hMM * PX_PER_MM))), k = PX_PER_MM * z;
      return { zoom: z, panX: (vw - wMM * k) / 2, panY: (vh - hMM * k) / 2 };
    }
  };
})(window.MARQ = window.MARQ || {});
