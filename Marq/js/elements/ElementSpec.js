(function (MARQ) {
  'use strict';
  const GEO = { x: { label: 'X', min: -10000, max: 10000, len: true }, y: { label: 'Y', min: -10000, max: 10000, len: true }, w: { label: 'Width', min: 0.1, max: 5000, len: true }, h: { label: 'Height', min: 0.1, max: 5000, len: true } };
  const FONTS = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Times New Roman', 'Georgia', 'Garamond', 'Courier New', 'Impact'];
  const GENERIC = { 'Times New Roman': 'serif', Georgia: 'serif', Garamond: 'serif', 'Courier New': 'monospace' };
  const fontStack = f => '"' + f + '", ' + (GENERIC[f] || 'sans-serif');
  const num = (label, min, max, extra) => Object.assign({ kind: 'num', label, min, max }, extra);
  const color = (label, none) => ({ kind: 'color', label, none: !!none });
  const enm = (label, values) => ({ kind: 'enum', label, values });
  const bool = label => ({ kind: 'bool', label });
  const str = (label, max) => ({ kind: 'str', label, max });
  const formats = ['CODE128', 'CODE39', 'EAN13', 'EAN8', 'ITF14'];
  const RULES = {
    text: { text: str('Text', 5000), fontFamily: str('Font', 100), fontSize: num('Font size', 1, 500, { unit: 'pt' }), bold: bool('Bold'), italic: bool('Italic'), align: enm('Alignment', ['left', 'center', 'right']), valign: enm('Vertical alignment', ['top', 'middle', 'bottom']), color: color('Text colour'), letterSpacing: num('Letter spacing', -5, 50, { unit: 'pt' }), lineHeight: num('Line height', 0.5, 5, { unit: '×' }), background: color('Background', true), padding: num('Padding', 0, 100, { len: true }), autoHeight: bool('Auto height') },
    rect: { fill: color('Fill', true), stroke: color('Stroke', true), strokeWidth: num('Stroke width', 0, 50, { len: true }), radius: num('Corner radius', 0, 1000, { len: true }), lockAspect: bool('Lock aspect ratio') },
    ellipse: { fill: color('Fill', true), stroke: color('Stroke', true), strokeWidth: num('Stroke width', 0, 50, { len: true }), lockAspect: bool('Lock aspect ratio') },
    line: { stroke: color('Line colour'), strokeWidth: num('Line width', 0.05, 50, { len: true }), dash: enm('Line style', ['solid', 'dashed', 'dotted']), dashLength: num('Dash length', 0.1, 100, { len: true }), dashGap: num('Dash gap', 0.1, 100, { len: true }), cap: enm('Line ends', ['butt', 'round']) },
    image: { assetId: str('Image', 100), fit: enm('Fit', ['fill', 'contain', 'cover']), lockAspect: bool('Lock aspect ratio'), naturalW: num('Natural width', 0, 100000), naturalH: num('Natural height', 0, 100000) },
    barcode: { value: str('Barcode value', 80), format: enm('Barcode format', formats), moduleWidth: num('Module width', 0.05, 5, { len: true }), color: color('Foreground colour'), background: color('Background colour'), showText: bool('Human-readable text'), textSize: num('Text size', 4, 72, { unit: 'pt' }), margin: num('Barcode margin', 0, 20, { len: true }) },
    qr: { lockAspect: bool('Lock aspect ratio'), value: str('QR contents', 5000), color: color('Foreground colour'), background: color('Background colour'), ecLevel: enm('Error correction', ['L', 'M', 'Q', 'H']), margin: num('QR margin', 0, 20, { len: true }) }
  };
  const COLOR_RE = /^#[0-9a-f]{6}$/i, round = v => Math.round(v * 1e4) / 1e4;
  function validateRule(r, raw) {
    if (r.kind === 'num') { const v = typeof raw === 'number' ? raw : NaN; return !isFinite(v) || v < r.min || v > r.max ? { error: { label: r.label, min: r.min, max: r.max, len: !!r.len, unit: r.unit } } : { value: round(v) }; }
    if (r.kind === 'color') return raw === '' && r.none ? { value: '' } : typeof raw === 'string' && COLOR_RE.test(raw) ? { value: raw.toLowerCase() } : { error: { label: r.label, invalid: true } };
    if (r.kind === 'enum') return r.values.includes(raw) ? { value: raw } : { error: { label: r.label, invalid: true } };
    if (r.kind === 'bool') return typeof raw === 'boolean' ? { value: raw } : { error: { label: r.label, invalid: true } };
    if (r.kind === 'str') return typeof raw === 'string' && raw.length <= r.max ? { value: raw } : { error: { label: r.label, invalid: true } };
    return { error: { label: r.label, invalid: true } };
  }
  function validateProp(type, key, raw, target) {
    const rule = RULES[type] && RULES[type][key]; if (!rule) return { error: { label: key, invalid: true } };
    const result = validateRule(rule, raw); if (result.error) return result;
    if (type === 'barcode' && (key === 'format' || key === 'value') && MARQ.Barcodes) {
      target = target || (MARQ.Store && MARQ.Store.state && MARQ.Store.state.project.elements.find(e => e.id === MARQ.Store.state.app.selection[0]));
      if (target && target.bindings && typeof target.bindings.value === 'string') return result; // dynamic: the spreadsheet value is checked per record
      const format = key === 'format' ? result.value : target && target.props.format || 'CODE128';
      const value = key === 'value' ? result.value : target && target.props.value || '';
      const error = MARQ.Barcodes.validate(format, value); if (error) return { error: { label: 'Barcode', invalid: true, detail: error } };
    }
    return result;
  }
  function validateGeometry(key, mm, type) { const g = GEO[key]; if (!g) return { error: { label: key, invalid: true } }; if (key === 'h' && type === 'line') return { value: 0 }; return validateRule(Object.assign({ kind: 'num' }, g), mm); }
  function normalizeRotation(deg) { if (typeof deg !== 'number' || !isFinite(deg)) return 0; const r = ((deg % 360) + 360) % 360; return round(r) >= 360 ? 0 : round(r); }
  const validateRotation = deg => typeof deg === 'number' && isFinite(deg) && Math.abs(deg) <= 100000 ? { value: normalizeRotation(deg) } : { error: { label: 'Rotation', min: -360, max: 360, unit: '°' } };
  const validateOpacity = pct => typeof pct === 'number' && pct >= 0 && pct <= 100 ? { value: round(pct / 100) } : { error: { label: 'Opacity', min: 0, max: 100, unit: '%' } };
  function describe(err, fmtRange) { if (err.locked) return err.label + ' is locked. Unlock it to edit.'; if (err.detail) return err.detail; if (err.invalid) return err.label + ' has an invalid value.'; const range = err.len && fmtRange ? fmtRange(err.min, err.max) : err.min + ' and ' + err.max + (err.unit ? ' ' + err.unit : ''); return err.label + ' must be between ' + range; }
  function normalize(el, defaults) {
    const d = defaults && defaults[el.type], n = (v, lo, hi, fallback) => typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
    if (!el.id || typeof el.id !== 'string') el.id = MARQ.Model.uid('el');
    el.x = n(el.x, GEO.x.min, GEO.x.max, 0); el.y = n(el.y, GEO.y.min, GEO.y.max, 0); el.w = n(el.w, GEO.w.min, GEO.w.max, d ? d.w : 10); el.h = el.type === 'line' ? 0 : n(el.h, GEO.h.min, GEO.h.max, d ? d.h : 10);
    el.rotation = normalizeRotation(el.rotation); el.opacity = n(el.opacity, 0, 1, 1); el.locked = el.locked === true; el.visible = el.visible !== false;
    if (typeof el.name !== 'string' || !el.name) el.name = el.type; if (!el.bindings || typeof el.bindings !== 'object') el.bindings = {};
    el.props = Object.assign({}, d ? d.props : {}, el.props && typeof el.props === 'object' ? el.props : {});
    const rules = RULES[el.type]; if (rules) for (const k in rules) { const res = validateRule(rules[k], el.props[k]); if (res.error) { const r = rules[k]; el.props[k] = r.kind === 'num' && typeof el.props[k] === 'number' && isFinite(el.props[k]) ? Math.min(r.max, Math.max(r.min, el.props[k])) : (d ? d.props[k] : el.props[k]); } else el.props[k] = res.value; }
    return el;
  }
  function corners(el) { const cx = el.x + el.w / 2, cy = el.y + el.h / 2, a = el.rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [[-el.w / 2, -el.h / 2], [el.w / 2, -el.h / 2], [el.w / 2, el.h / 2], [-el.w / 2, el.h / 2]].map(([dx, dy]) => ({ x: cx + dx * c - dy * s, y: cy + dx * s + dy * c })); }
  function toLocal(el, px, py) { const cx = el.x + el.w / 2, cy = el.y + el.h / 2, a = -el.rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), dx = px - cx, dy = py - cy; return { x: dx * c - dy * s + el.w / 2, y: dx * s + dy * c + el.h / 2 }; }
  function hit(el, px, py, tol) { const p = toLocal(el, px, py); tol = tol || 0; if (el.type === 'line') { const half = Math.max((el.props.strokeWidth || 0) / 2, 0) + tol; return p.x >= -half && p.x <= el.w + half && Math.abs(p.y - el.h / 2) <= half; } return p.x >= -tol && p.x <= el.w + tol && p.y >= -tol && p.y <= el.h + tol; }
  MARQ.ElementSpec = { GEO, FONTS, fontStack, RULES, validateProp, validateGeometry, validateRotation, validateOpacity, normalizeRotation, describe, normalize, corners, toLocal, hit };
})(window.MARQ = window.MARQ || {});
