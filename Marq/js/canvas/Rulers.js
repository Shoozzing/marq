(function (MARQ) {
  'use strict';
  // Horizontal + vertical rulers drawn in the *current display unit* (mm | cm | in | px).
  // Ruler origin (0) = label top-left, so it lines up with what Store/Model call document space.
  // Shows: ticks + numbers, the label's extent, margin markers, and a live cursor indicator.
  const SIZE = 22, CURSOR = '#4a6cf7', MARGIN = '#e0457b';
  let stage, corner, rh, rv, raf = 0, cursor = null, colors = null;

  const clean = x => Number(x.toPrecision(12)); // kill float dust: 0.30000000000000004 -> 0.3

  // Smallest 1/2/5 × 10ⁿ that is >= minUnits, with how many minor ticks make up one major step.
  function niceStep(minUnits) {
    const base = Math.pow(10, Math.floor(Math.log10(minUnits)));
    for (const m of [1, 2, 5, 10]) {
      if (m * base >= minUnits * (1 - 1e-9)) return { step: clean(m * base), sub: m === 2 ? 4 : m === 5 ? 5 : 10 };
    }
  }

  // Pure tick maths (unit-agnostic). offset = screen px of value 0, ppu = screen px per ruler unit, length = ruler px.
  // Returns ticks with screen position `pos`, ruler `value` and kind major|mid|minor.
  function computeTicks(o) {
    const minLabel = o.minLabelPx || 56, minMinor = o.minMinorPx || 6;
    const ns = niceStep(minLabel / o.ppu), step = ns.step, sub = ns.sub;
    const minor = clean(step / sub), showMinor = minor * o.ppu >= minMinor, stride = showMinor ? 1 : sub;
    const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    const first = Math.ceil((-o.offset) / o.ppu / minor / stride - 1e-9) * stride;
    const last = Math.floor((o.length - o.offset) / o.ppu / minor + 1e-9);
    const ticks = [];
    for (let i = first; i <= last; i += stride) {
      const value = clean(i * minor);
      ticks.push({ value, pos: o.offset + value * o.ppu, kind: i % sub === 0 ? 'major' : (sub === 10 && i % 5 === 0 ? 'mid' : 'minor') });
    }
    return { step, minor, sub, decimals, ticks };
  }
  const numText = (v, decimals) => (v === 0 ? '0' : v.toFixed(decimals));

  function readColors() {
    const cs = getComputedStyle(document.body), g = n => cs.getPropertyValue(n).trim();
    colors = { bg: g('--p1'), band: g('--p3'), line: g('--ln'), text: g('--mu') };
  }

  function paint(cv, horiz, g) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
    if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const len = horiz ? w : h;
    // helpers: a = distance along the ruler, b = distance across it
    const rect = (a, b, da, db) => horiz ? c.fillRect(a, b, da, db) : c.fillRect(b, a, db, da);
    const line = (a, b0, b1) => { c.beginPath(); if (horiz) { c.moveTo(a, b0); c.lineTo(a, b1); } else { c.moveTo(b0, a); c.lineTo(b1, a); } c.stroke(); };

    c.fillStyle = colors.bg; rect(0, 0, len, SIZE);
    // label extent (what is actually printable) is shaded
    const a0 = g.off, a1 = g.off + (horiz ? g.L.width : g.L.height) * g.k;
    c.fillStyle = colors.band; rect(Math.max(0, a0), 0, Math.min(len, a1) - Math.max(0, a0), SIZE);
    // inner edge
    c.strokeStyle = colors.line; c.lineWidth = 1;
    c.beginPath(); if (horiz) { c.moveTo(0, SIZE - .5); c.lineTo(w, SIZE - .5); } else { c.moveTo(SIZE - .5, 0); c.lineTo(SIZE - .5, h); } c.stroke();

    const t = computeTicks({ offset: g.off, ppu: g.ppu, length: len });
    c.strokeStyle = colors.text; c.fillStyle = colors.text; c.font = '9px system-ui, sans-serif'; c.textBaseline = 'alphabetic';
    t.ticks.forEach(k => {
      const a = Math.round(k.pos) + .5, len2 = k.kind === 'major' ? 12 : k.kind === 'mid' ? 8 : 5;
      line(a, SIZE, SIZE - len2);
      if (k.kind === 'major') {
        const s = numText(k.value, t.decimals);
        if (horiz) c.fillText(s, a + 3, 9);
        else { c.save(); c.translate(3, a + 3); c.rotate(Math.PI / 2); c.fillText(s, 0, 0); c.restore(); }
      }
    });

    // margin markers
    const m = g.L.margin, marks = horiz ? [m.left, g.L.width - m.right, m.left, m.right] : [m.top, g.L.height - m.bottom, m.top, m.bottom];
    c.fillStyle = MARGIN;
    [[marks[0], marks[2]], [marks[1], marks[3]]].forEach(([mm, amt]) => {
      if (!(amt > 0)) return;
      const a = Math.round(g.off + mm * g.k) + .5;
      c.beginPath();
      if (horiz) { c.moveTo(a - 3.5, SIZE - 1); c.lineTo(a + 3.5, SIZE - 1); c.lineTo(a, SIZE - 7); } else { c.moveTo(SIZE - 1, a - 3.5); c.lineTo(SIZE - 1, a + 3.5); c.lineTo(SIZE - 7, a); }
      c.closePath(); c.fill();
    });

    // cursor indicator
    if (cursor) {
      const mm = horiz ? cursor.x : cursor.y, a = Math.round(g.off + mm * g.k) + .5;
      if (a >= 0 && a <= len) {
        c.strokeStyle = CURSOR; line(a, 0, SIZE);
        c.font = '600 9px system-ui, sans-serif'; // measure with the font it is drawn in
        const txt = String(MARQ.Units.round(MARQ.Units.fromMM(mm, g.u), g.u)), tw = Math.ceil(c.measureText(txt).width) + 8;
        const p = Math.max(0, Math.min(len - tw, a + 4));
        c.fillStyle = CURSOR; rect(p, 2, tw, 14);
        c.fillStyle = '#fff';
        // glyph body must sit inside the 14px-thick tag: baseline y=12 (horizontal) / x=6 (vertical, rotated +90° so glyphs grow toward +x)
        if (horiz) c.fillText(txt, p + 4, 12);
        else { c.save(); c.translate(6, p + 4); c.rotate(Math.PI / 2); c.fillText(txt, 0, 0); c.restore(); }
      }
    }
  }

  function draw() {
    raf = 0;
    const st = MARQ.Store.state; if (!st || !stage) return;
    stage.classList.toggle('no-rulers', !st.app.rulers);
    if (!st.app.rulers) return;
    if (!colors) readColors();
    const u = st.app.unit, v = st.app.view, o = MARQ.Viewport.snap(v), k = MARQ.Viewport.PX_PER_MM * v.zoom;
    corner.textContent = u;
    const base = { L: st.project.label, k, u, ppu: k * MARQ.Units.toMM(1, u) };
    paint(rh, true, Object.assign({ off: o.x }, base));
    paint(rv, false, Object.assign({ off: o.y }, base));
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(draw); }

  function init() {
    stage = document.getElementById('stage'); corner = document.getElementById('corner');
    rh = document.getElementById('ruler-h'); rv = document.getElementById('ruler-v');
    MARQ.Bus.on('state:changed', schedule); MARQ.Bus.on('state:replaced', schedule);
    MARQ.Bus.on('cursor:moved', p => { cursor = p; schedule(); });
    new ResizeObserver(schedule).observe(stage);
    const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)');
    if (mq && mq.addEventListener) mq.addEventListener('change', () => { colors = null; schedule(); });
    schedule();
  }

  MARQ.Rulers = { init, draw, computeTicks, niceStep, SIZE };
})(window.MARQ = window.MARQ || {});
