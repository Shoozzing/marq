(function (MARQ) {
  'use strict';
  // Pure rules for the label canvas (no DOM). Every function mutates/validates a plain `project.label` object,
  // so callers use them inside Store.commit(). All lengths are millimetres.
  //
  // label = { width, height, preset, orientation, background, borderWidth, borderColor,
  //           margin:{top,right,bottom,left} }
  //  - width/height are the REAL canvas size (already oriented): orientation is portrait when height > width.
  //  - preset is 'custom' or a PRESETS id; any non-custom value always matches width/height (either orientation).
  const MIN_MM = 1, MAX_MM = 2000, EPS = 0.01, PRECISION = 1e4; // sizes are kept to 0.1 µm so unit round-trips stay clean
  const MIN_PRINTABLE = 1; // margins may never leave less than 1 mm of drawable area

  // Defined with their natural (short × long) numbers; orientation decides which is the width.
  const PRESETS = [
    { id: '50x30',  name: '50 × 30 mm',  w: 50,  h: 30 },
    { id: '60x40',  name: '60 × 40 mm',  w: 60,  h: 40 },
    { id: '70x50',  name: '70 × 50 mm',  w: 70,  h: 50 },
    { id: '100x50', name: '100 × 50 mm', w: 100, h: 50 },
    { id: 'A4',     name: 'A4 (210 × 297 mm)', w: 210, h: 297 }
  ];
  const SIDES = ['top', 'bottom', 'left', 'right'];

  const snap = v => Math.round(v * PRECISION) / PRECISION;
  const finite = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const sizeOk = v => typeof v === 'number' && v >= MIN_MM && v <= MAX_MM;

  function orientationOf(w, h, fallback) {
    if (w > h) return 'landscape';
    if (h > w) return 'portrait';
    return fallback === 'portrait' ? 'portrait' : 'landscape'; // square keeps what it had
  }
  function oriented(w, h, orientation) {
    const a = Math.min(w, h), b = Math.max(w, h);
    return orientation === 'portrait' ? { w: a, h: b } : { w: b, h: a };
  }
  function presetFor(w, h) {
    const a = Math.min(w, h), b = Math.max(w, h);
    const p = PRESETS.find(p => Math.abs(Math.min(p.w, p.h) - a) < EPS && Math.abs(Math.max(p.w, p.h) - b) < EPS);
    return p ? p.id : 'custom';
  }
  function dimsFor(presetId, orientation) {
    const p = PRESETS.find(p => p.id === presetId);
    return p ? oriented(p.w, p.h, orientation) : null;
  }

  // Keep margins and border inside the label after any size change.
  function fitPair(a, b, limit) {
    limit = Math.max(0, limit);
    if (a + b <= limit) return [a, b];
    const s = limit / (a + b);
    return [snap(a * s), snap(b * s)];
  }
  function clamp(label) {
    const m = label.margin;
    [m.left, m.right] = fitPair(m.left, m.right, label.width - MIN_PRINTABLE);
    [m.top, m.bottom] = fitPair(m.top, m.bottom, label.height - MIN_PRINTABLE);
    label.borderWidth = Math.min(label.borderWidth, Math.min(label.width, label.height) / 2);
    return label;
  }

  // ---- mutators (call inside Store.commit) ----
  function setSize(label, w, h) {
    label.width = snap(w); label.height = snap(h);
    label.orientation = orientationOf(label.width, label.height, label.orientation);
    label.preset = presetFor(label.width, label.height);
    return clamp(label);
  }
  function setPreset(label, id) {
    if (id === 'custom') { label.preset = 'custom'; return label; } // keep the size, just mark it as hand-set
    const d = dimsFor(id, label.orientation);
    if (!d) return label;
    label.width = snap(d.w); label.height = snap(d.h); label.preset = id; // orientation persists across presets
    return clamp(label);
  }
  function setOrientation(label, orientation) {
    if (orientation !== 'portrait' && orientation !== 'landscape') return label;
    const d = oriented(label.width, label.height, orientation);
    label.width = d.w; label.height = d.h; label.orientation = orientation;
    return clamp(label);
  }
  function setMargin(label, side, mm) { label.margin[side] = snap(mm); return label; }

  // ---- validators: return an error message (in mm terms) or null ----
  function validateSize(mm) {
    return sizeOk(mm) ? null : { code: 'size', min: MIN_MM, max: MAX_MM };
  }
  function maxMargin(label, side) {
    const horiz = side === 'left' || side === 'right', opp = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' }[side];
    return Math.max(0, (horiz ? label.width : label.height) - label.margin[opp] - MIN_PRINTABLE);
  }
  function validateMargin(label, side, mm) {
    if (!SIDES.includes(side) || !(mm >= 0)) return { code: 'margin', min: 0, max: SIDES.includes(side) ? maxMargin(label, side) : 0 };
    const max = maxMargin(label, side);
    return mm <= max + 1e-9 ? null : { code: 'margin', min: 0, max };
  }
  function maxBorder(label) { return Math.min(label.width, label.height) / 2; }
  function validateBorder(label, mm) {
    const max = maxBorder(label);
    return mm >= 0 && mm <= max + 1e-9 ? null : { code: 'border', min: 0, max };
  }
  const isHex = s => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);

  // Fill/repair a label from any source (old files, hand-edited JSON). Never throws.
  function normalize(label) {
    label = label || {};
    label.width = sizeOk(label.width) ? snap(label.width) : Math.min(MAX_MM, Math.max(MIN_MM, finite(label.width, 100)));
    label.height = sizeOk(label.height) ? snap(label.height) : Math.min(MAX_MM, Math.max(MIN_MM, finite(label.height, 50)));
    label.orientation = orientationOf(label.width, label.height, label.orientation);
    if (label.preset !== 'custom') label.preset = presetFor(label.width, label.height);
    if (!isHex(label.background)) label.background = '#ffffff';
    if (!isHex(label.borderColor)) label.borderColor = '#000000';
    label.borderWidth = Math.max(0, finite(label.borderWidth, 0));
    const m = label.margin && typeof label.margin === 'object' ? label.margin : {};
    label.margin = {};
    SIDES.forEach(s => { label.margin[s] = Math.max(0, finite(m[s], 0)); });
    return clamp(label);
  }

  MARQ.LabelSpec = {
    MIN_MM, MAX_MM, PRESETS, SIDES,
    orientationOf, oriented, presetFor, dimsFor,
    setSize, setPreset, setOrientation, setMargin,
    validateSize, validateMargin, validateBorder, maxMargin, maxBorder, normalize, clamp
  };
})(window.MARQ = window.MARQ || {});
