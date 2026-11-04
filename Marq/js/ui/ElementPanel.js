(function (MARQ) {
  'use strict';
  // Right-sidebar editor for the selected element + the Layers list. Built once per selected element (and type), then kept in sync
  // with the model without ever overwriting the field the user is typing in. All writes go through MARQ.Elements (validated + undoable).
  const S = () => MARQ.Store.state, E = () => MARQ.Elements, SP = () => MARQ.ElementSpec, U = () => MARQ.Units;
  const unit = () => S().app.unit;
  const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const toast = (m, err) => MARQ.Shell && MARQ.Shell.toast(m, err);

  let root = null, key = null, binds = [], closed = new Set(), curId = null;
  const cur = () => E().get(curId);
  const D = () => MARQ.Data, boundProp = el => D().BOUND[el.type];
  const isDyn = el => !!boundProp(el) && typeof (el.bindings || {})[boundProp(el)] === 'string';
  const keyOf = el => el ? el.id + '|' + el.type + '|' + (isDyn(el) ? 'd' : 's') + '|' + D().signature() : ''; // rebuild on mode switch or when a spreadsheet is (re)loaded
  const SOLO = /^\{\{\s*([^}]+?)\s*\}\}$/;

  function reject(err, input) { // explain, flash the field, restore the real value
    err = err.error || err; // setters return { error }, local parse failures return the bare object
    toast(SP().describe(err, (a, b) => U().format(a, unit()) + ' and ' + U().format(b, unit())), true);
    const f = input && input.closest('.fld'); if (f) { f.classList.add('err'); setTimeout(() => f.classList.remove('err'), 1600); }
    sync(true);
  }
  const done = (err, input) => { if (err) reject(err, input); };
  const parseNum = s => { const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*$/.exec(String(s)); return m ? parseFloat(m[1].replace(',', '.')) : NaN; };
  const r4 = v => Math.round(v * 1e4) / 1e4;

  /* ---------- field builders: each registers a binder { input, read(el), enabled?(el), keep? } ---------- */
  function bind(input, read, extra) { binds.push(Object.assign({ input, read }, extra)); }
  function field(label, cls) { return mk('label', 'fld ' + (cls || ''), label); }

  function lenField(inn, label, id, read, write, o) { // millimetres shown/typed in the current unit
    const w = field(label, o && o.cls), i = mk('input'); i.type = 'text'; i.id = id; i.inputMode = 'decimal'; i.autocomplete = 'off'; i.spellcheck = false;
    i.onchange = e => { const mm = U().parse(e.target.value, unit()); done(isNaN(mm) ? { label, invalid: true } : write(mm), i); };
    w.append(i); inn.append(w); bind(i, el => String(U().display(read(el), unit())), o);
  }
  function numField(inn, label, id, read, write, o) { // plain numbers (pt, °, %, ×)
    const w = field(label, o && o.cls), i = mk('input'); i.type = 'text'; i.id = id; i.inputMode = 'decimal'; i.autocomplete = 'off'; i.spellcheck = false;
    i.onchange = e => { const v = parseNum(e.target.value); done(isNaN(v) ? { label, invalid: true } : write(v), i); };
    w.append(i); inn.append(w); bind(i, el => String(r4(read(el))), o);
  }
  function checkField(inn, label, id, read, write, o) {
    const w = mk('label', 'chk ' + ((o && o.cls) || ''), ''), i = mk('input'); i.type = 'checkbox'; i.id = id;
    i.onchange = () => done(write(i.checked), i); w.append(i, document.createTextNode(label)); inn.append(w); bind(i, el => !!read(el), o);
    return i;
  }
  function selectField(inn, label, id, options, read, write, o) {
    const w = field(label, o && o.cls), s = mk('select'); s.id = id;
    options.forEach(x => { const [v, t] = Array.isArray(x) ? x : [x, x]; const op = new Option(t, v); if (o && o.fonts) op.style.fontFamily = SP().fontStack(v); s.add(op); });
    s.onchange = () => done(write(s.value), s); w.append(s); inn.append(w);
    bind(s, el => { const v = read(el); if (![...s.options].some(op => op.value === v)) s.add(new Option(v, v)); return v; }, o);
  }
  function colorField(inn, label, id, read, write, o) { // colour picker; with o.none an extra "None" checkbox stores ''
    const w = field(label, o && o.cls), i = mk('input'); i.type = 'color'; i.id = id; w.append(i); inn.append(w);
    let last = '#000000';
    i.oninput = () => { last = i.value; done(write(i.value), i); }; // live while dragging; Store coalesces it into one undo step
    bind(i, el => { const v = read(el); if (v) last = v; return v || last; }, o);
    if (o && o.none) {
      const n = mk('label', 'chk none'), c = mk('input'); c.type = 'checkbox'; c.id = id + '-none'; n.append(c, document.createTextNode('None'));
      c.onchange = () => done(write(c.checked ? '' : last), c); w.append(n);
      bind(c, el => !read(el), o);
    }
  }
  function segField(inn, label, id, options, read, write, o) {
    const w = mk('div', 'fld ' + ((o && o.cls) || ''), label), g = mk('div', 'seg');
    options.forEach(([v, t, tip]) => { const b = mk('button', 'chip', t); b.type = 'button'; b.id = id + '-' + v; b.title = tip || t; b.onclick = () => done(write(v), b); g.append(b); bind(b, el => read(el) === v, { aria: true, keep: o && o.keep }); });
    w.append(g); inn.append(w);
  }
  function toggle(inn, label, id, tip, read, write, extraCls) {
    const b = mk('button', 'chip tog ' + (extraCls || ''), label); b.type = 'button'; b.id = id; b.title = tip; b.onclick = () => done(write(!read(cur())), b);
    inn.append(b); bind(b, el => !!read(el), { aria: true });
  }
  function button(inn, label, id, fn, cls, o) {
    const b = mk('button', 'chip act ' + (cls || ''), label); b.type = 'button'; b.id = id; b.onclick = fn; inn.append(b); bind(b, () => null, o || {}); return b;
  }
  function section(title) {
    const s = mk('section', 'sec' + (closed.has(title) ? ' closed' : '')), h = mk('button', null, title), inn = mk('div', 'in');
    h.onclick = () => { s.classList.toggle('closed'); s.classList.contains('closed') ? closed.add(title) : closed.delete(title); };
    s.append(h, inn); root.append(s); return inn;
  }

  /* ---------- sections ---------- */
  const P = (k) => el => el.props[k];
  const setP = k => v => E().setProp(curId, k, v);

  function buildElement() {
    const inn = section('Element');
    const nw = field('Name', 'full'), ni = mk('input'); ni.type = 'text'; ni.id = 'ep-name'; ni.maxLength = 80; ni.autocomplete = 'off';
    ni.onchange = () => { E().setMeta(curId, { name: ni.value }); sync(true); }; nw.append(ni); inn.append(nw); bind(ni, e => e.name, { keep: true });
    numField(inn, 'Opacity %', 'ep-opacity', e => e.opacity * 100, v => E().setOpacity(curId, v));
    const col = mk('div', 'chkcol'); inn.append(col);
    checkField(col, 'Locked', 'ep-locked', e => e.locked, v => E().setMeta(curId, { locked: v }), { keep: true });
    checkField(col, 'Visible', 'ep-visible', e => e.visible, v => E().setMeta(curId, { visible: v }), { keep: true });
    const row = mk('div', 'full btnrow'); inn.append(row);
    button(row, 'Duplicate', 'ep-dup', () => E().duplicate(curId), '', { keep: true });
    button(row, 'Forward', 'ep-fwd', () => E().reorder(curId, 'up'), '', { keep: true });
    button(row, 'Back', 'ep-back', () => E().reorder(curId, 'down'), '', { keep: true });
    button(row, 'Delete', 'ep-del', () => E().remove(curId), 'danger');
  }
  function buildGeometry() {
    const el = cur(), line = el.type === 'line', inn = section('Position & Size');
    lenField(inn, 'X', 'ep-x', e => e.x, v => E().setGeometry(curId, { x: v }));
    lenField(inn, 'Y', 'ep-y', e => e.y, v => E().setGeometry(curId, { y: v }));
    lenField(inn, line ? 'Length' : 'Width', 'ep-w', e => e.w, v => E().setGeometry(curId, { w: v }));
    if (!line) lenField(inn, 'Height', 'ep-h', e => e.h, v => E().setGeometry(curId, { h: v }), { enabled: e => !(e.type === 'text' && e.props.autoHeight) });
    numField(inn, 'Rotation °', 'ep-rot', e => e.rotation, v => E().setRotation(curId, v));
    button(inn, '⟳ 90°', 'ep-rot90', () => done(E().setRotation(curId, cur().rotation + 90)), 'tall');
    if (!line && el.type !== 'text' && el.type !== 'barcode') {
      checkField(inn, 'Lock aspect ratio', 'ep-lock-aspect', e => e.props.lockAspect, setP('lockAspect'), { cls: 'full' });
      if (el.type === 'image') button(inn, 'Reset to original proportions', 'ep-reset-aspect', () => done(E().resetAspect(curId)), 'full');
    }
  }
  // Static / Dynamic switch + column mapping for text and barcode elements. Mappings live in element.bindings, so they travel with the element.
  function buildSource(el) {
    const inn = section('Data source'), prop = boundProp(el), text = el.type === 'text';
    segField(inn, 'Content source', 'ep-src', [['static', 'Static', 'Fixed content'], ['dynamic', 'Dynamic', 'Filled from a spreadsheet column']], e => isDyn(e) ? 'dynamic' : 'static', v => E().setDynamic(curId, v === 'dynamic'), { cls: 'full' });
    const info = mk('div', 'hint', ''); info.id = 'ep-bind-info';
    if (isDyn(el)) {
      const w = field(text ? 'Map whole text to column' : 'Spreadsheet column', 'full'), s = mk('select'); s.id = 'ep-col';
      s.add(new Option('— choose a column —', '')); D().columns().forEach(h => s.add(new Option(h, h)));
      s.onchange = () => { if (s.value) done(E().setBinding(curId, prop, '{{' + s.value + '}}'), s); else if (!text) done(E().setBinding(curId, prop, ''), s); else sync(true); };
      w.append(s); inn.append(w);
      bind(s, e => { // a mapped column that is not in the loaded spreadsheet stays visible (flagged) so the mapping is never silently lost
        const t = e.bindings[prop], m = SOLO.exec(t || ''), v = m ? m[1] : '';
        [...s.options].forEach(o => { if (o.dataset.missing) o.remove(); });
        if (v && ![...s.options].some(o => o.value === v)) { const o = new Option(v + ' (not in spreadsheet)', v); o.dataset.missing = '1'; s.add(o); }
        s.options[0].text = t && !m ? '— custom template —' : '— choose a column —'; return v;
      });
    }
    inn.append(info);
    bind(info, e => {
      const d = D().diagnose(e); if (!d) { info.classList.remove('warn'); return ''; }
      info.classList.toggle('warn', d.issues.length > 0); return [d.preview].concat(d.issues.map(i => '⚠ ' + i)).join('\n');
    }, { text: true, keep: true });
  }
  function buildText() {
    const el = cur(), dyn = isDyn(el); let inn = section('Text');
    const w = field(dyn ? 'Template (use {{Column}} placeholders)' : 'Content', 'full'), ta = mk('textarea'); ta.id = 'ep-text'; ta.rows = 3; ta.maxLength = 5000; ta.spellcheck = false;
    ta.oninput = () => done(dyn ? E().setBinding(curId, 'text', ta.value, true) : E().setProp(curId, 'text', ta.value), ta); w.append(ta); inn.append(w);
    bind(ta, dyn ? (e => e.bindings.text) : P('text'));
    if (dyn) { // insert {{Column}} at the caret: text may mix static words and several columns
      const iw = field('Insert column at cursor', 'full'), is = mk('select'); is.id = 'ep-insert-col';
      is.add(new Option('— insert column —', '')); D().columns().forEach(h => is.add(new Option(h, h)));
      is.onchange = () => { if (!is.value) return; const tag = '{{' + is.value + '}}', a = ta.selectionStart == null ? ta.value.length : ta.selectionStart, b = ta.selectionEnd == null ? a : ta.selectionEnd, next = ta.value.slice(0, a) + tag + ta.value.slice(b); is.value = ''; const err = E().setBinding(curId, 'text', next); if (err) return done(err, is); sync(true); ta.focus(); ta.setSelectionRange(a + tag.length, a + tag.length); };
      iw.append(is); inn.append(iw);
    } else {
      const note = mk('div', 'hint', ''); note.id = 'ep-text-note'; inn.append(note);
      bind(note, e => /\{\{\s*[^}]+?\s*\}\}/.test(e.props.text) ? 'This text contains {{placeholders}}. Set Content source to Dynamic to fill them from the spreadsheet.' : '', { text: true, keep: true });
    }
    inn = section('Typography');
    selectField(inn, 'Font', 'ep-font', SP().FONTS, P('fontFamily'), setP('fontFamily'), { cls: 'full', fonts: true });
    numField(inn, 'Size (pt)', 'ep-size', P('fontSize'), setP('fontSize'));
    numField(inn, 'Line height (×)', 'ep-lh', P('lineHeight'), setP('lineHeight'));
    numField(inn, 'Letter spacing (pt)', 'ep-ls', P('letterSpacing'), setP('letterSpacing'));
    colorField(inn, 'Text colour', 'ep-color', P('color'), setP('color'));
    const st = mk('div', 'fld full btnrow', 'Style'); inn.append(st);
    toggle(st, 'B', 'ep-bold', 'Bold', P('bold'), setP('bold'), 'b'); toggle(st, 'I', 'ep-italic', 'Italic', P('italic'), setP('italic'), 'i');
    segField(inn, 'Alignment', 'ep-align', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], P('align'), setP('align'), { cls: 'full' });
    segField(inn, 'Vertical', 'ep-valign', [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']], P('valign'), setP('valign'), { cls: 'full' });
    inn = section('Text box');
    colorField(inn, 'Background', 'ep-bg', P('background'), setP('background'), { none: true });
    lenField(inn, 'Padding', 'ep-padding', P('padding'), setP('padding'));
    checkField(inn, 'Auto height (fit text)', 'ep-autoh', P('autoHeight'), setP('autoHeight'), { cls: 'full' });
  }
  function buildShape() {
    const el = cur(), inn = section('Appearance');
    colorField(inn, 'Fill', 'ep-fill', P('fill'), setP('fill'), { none: true });
    colorField(inn, 'Stroke', 'ep-stroke', P('stroke'), setP('stroke'), { none: true });
    lenField(inn, 'Stroke width', 'ep-sw', P('strokeWidth'), setP('strokeWidth'), { enabled: e => !!e.props.stroke });
    if (el.type === 'rect') lenField(inn, 'Corner radius', 'ep-radius', P('radius'), setP('radius'));
  }
  function buildLine() {
    const inn = section('Line');
    colorField(inn, 'Colour', 'ep-stroke', P('stroke'), setP('stroke'));
    lenField(inn, 'Thickness', 'ep-sw', P('strokeWidth'), setP('strokeWidth'));
    selectField(inn, 'Style', 'ep-dash', [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']], P('dash'), setP('dash'));
    selectField(inn, 'Ends', 'ep-cap', [['butt', 'Flat'], ['round', 'Round']], P('cap'), setP('cap'));
    lenField(inn, 'Dash length', 'ep-dash-len', P('dashLength'), setP('dashLength'), { enabled: e => e.props.dash === 'dashed' });
    lenField(inn, 'Dash gap', 'ep-dash-gap', P('dashGap'), setP('dashGap'), { enabled: e => e.props.dash === 'dashed' });
  }
  function buildImage() {
    const inn = section('Image'), info = mk('div', 'hint', ''); info.id = 'ep-img-info'; inn.append(info);
    bind(info, el => { const a = S().project.assets[el.props.assetId]; return (a ? a.name : 'Image missing from project') + (el.props.naturalW ? ' · ' + el.props.naturalW + ' × ' + el.props.naturalH + ' px' : ''); }, { text: true, keep: true });
    selectField(inn, 'Fit', 'ep-fit', [['fill', 'Stretch to box'], ['contain', 'Contain (keep proportions)'], ['cover', 'Cover (crop)']], P('fit'), setP('fit'), { cls: 'full' });
    button(inn, 'Replace image…', 'ep-replace', () => MARQ.Shell.pickImage(curId), 'full');
  }

  function buildBarcode() {
    const inn = section('Barcode'), B = MARQ.Barcodes;
    const w = field(isDyn(cur()) ? 'Static value (unused while dynamic)' : 'Value', 'full'), vi = mk('input'); vi.type = 'text'; vi.id = 'ep-bc-value'; vi.maxLength = 80; vi.autocomplete = 'off'; vi.spellcheck = false;
    vi.onchange = () => done(E().setProp(curId, 'value', vi.value.trim()), vi); w.append(vi); inn.append(w); bind(vi, P('value'), { enabled: e => !isDyn(e) });
    selectField(inn, 'Format', 'ep-bc-format', B.formats().filter(f => f.kind === 'linear').map(f => [f.id, f.label]), P('format'), setP('format'), { cls: 'full' });
    const info = mk('div', 'hint', ''); info.id = 'ep-bc-info'; inn.append(info);
    bind(info, el => { if (isDyn(el)) return ''; const r = B.encode(el.props.format, el.props.value); return r.error ? '⚠ ' + r.error : 'Valid · encodes “' + r.text + '”'; }, { text: true, keep: true });
    lenField(inn, 'Bar width', 'ep-bc-module', P('moduleWidth'), setP('moduleWidth'));
    lenField(inn, 'Margin', 'ep-bc-margin', P('margin'), setP('margin'));
    checkField(inn, 'Show human-readable text', 'ep-bc-text', P('showText'), setP('showText'), { cls: 'full' });
    numField(inn, 'Text size (pt)', 'ep-bc-size', P('textSize'), setP('textSize'), { enabled: e => e.props.showText });
    colorField(inn, 'Bars', 'ep-bc-color', P('color'), setP('color'));
    colorField(inn, 'Background', 'ep-bc-bg', P('background'), setP('background'));
  }
  function buildQr() {
    const inn = section('QR code'), w = field('Contents', 'full'), ta = mk('textarea'); ta.id = 'ep-qr-value'; ta.rows = 3; ta.maxLength = 5000; ta.spellcheck = false;
    ta.oninput = () => done(E().setProp(curId, 'value', ta.value), ta); w.append(ta); inn.append(w); bind(ta, P('value'));
    selectField(inn, 'Error correction', 'ep-qr-ec', [['L', 'Low (7%)'], ['M', 'Medium (15%)'], ['Q', 'Quartile (25%)'], ['H', 'High (30%)']], P('ecLevel'), setP('ecLevel'), { cls: 'full' });
    const info = mk('div', 'hint', ''); info.id = 'ep-qr-info'; inn.append(info);
    bind(info, el => { const q = MARQ.Barcodes.matrix('QR', el.props.value, { ecLevel: el.props.ecLevel }); return q.error ? '⚠ ' + q.error : 'Valid · version ' + q.version + ' (' + q.size + ' × ' + q.size + ' modules)'; }, { text: true, keep: true });
    lenField(inn, 'Margin', 'ep-qr-margin', P('margin'), setP('margin'));
    colorField(inn, 'Modules', 'ep-qr-color', P('color'), setP('color'));
    colorField(inn, 'Background', 'ep-qr-bg', P('background'), setP('background'));
  }

  /* ---------- build / sync ---------- */
  function rebuild() {
    root.textContent = ''; binds = []; const el = cur(); curId = el ? el.id : null; key = keyOf(el);
    if (!el) { root.append(mk('div', 'hint pad', 'Nothing selected. Click an element on the canvas or in Layers to edit it here.')); return; }
    buildElement(); buildGeometry();
    if (boundProp(el) && el.type !== 'qr') buildSource(el);
    if (el.type === 'text') buildText(); else if (el.type === 'rect' || el.type === 'ellipse') buildShape(); else if (el.type === 'line') buildLine(); else if (el.type === 'image') buildImage(); else if (el.type === 'barcode') buildBarcode(); else if (el.type === 'qr') buildQr();
  }
  function sync(force) {
    if (!root) return;
    const el = E().selected(), k = keyOf(el);
    if (k !== key) { curId = el ? el.id : null; rebuild(); }
    if (!el) return;
    binds.forEach(b => {
      const i = b.input, v = b.read(el), focused = document.activeElement === i;
      if (b.text) i.textContent = v;
      else if (b.aria) i.setAttribute('aria-pressed', v);
      else if (i.type === 'checkbox') i.checked = v;
      else if (i.tagName !== 'BUTTON' && (force || !focused)) i.value = v;
      if (!b.text) i.disabled = (el.locked && !b.keep) || (b.enabled ? !b.enabled(el) : false);
    });
  }

  /* ---------- layers ---------- */
  const GLYPH = { text: 'T', rect: '▭', ellipse: '◯', line: '╱', image: '▨', barcode: '▌▌', qr: '▣' };
  function layers(box) {
    const els = S().project.elements, sel = S().app.selection[0];
    if (!els.length) { box.append(mk('div', 'empty', 'No layers yet. Elements you add will stack here.')); return; }
    els.slice().reverse().forEach(e => {
      const row = mk('div', 'layer' + (e.id === sel ? ' on' : '') + (e.visible ? '' : ' off')); row.dataset.id = e.id;
      const main = mk('button', 'lname'); main.type = 'button'; main.title = 'Select';
      main.append(mk('span', 'g', GLYPH[e.type] || '◆'), mk('span', 'nm', e.name));
      main.onclick = () => E().select(e.id);
      const act = (txt, tip, fn, on, more) => { const b = mk('button', 'lbtn' + (on ? ' on' : '') + (more ? ' more' : ''), txt); b.type = 'button'; b.title = tip; b.setAttribute('aria-label', tip); b.onclick = ev => { ev.stopPropagation(); fn(); }; return b; };
      row.append(main,
        act(e.visible ? '◉' : '○', e.visible ? 'Hide' : 'Show', () => E().setMeta(e.id, { visible: !e.visible })),
        act(e.locked ? '🔒' : '🔓', e.locked ? 'Unlock' : 'Lock', () => E().setMeta(e.id, { locked: !e.locked }), e.locked),
        act('↑', 'Bring forward', () => E().reorder(e.id, 'up'), false, true), act('↓', 'Send backward', () => E().reorder(e.id, 'down'), false, true),
        act('✕', 'Delete', () => E().remove(e.id), false, true));
      box.append(row);
    });
  }

  function init(container) { root = container; key = null; rebuild(); }
  MARQ.ElementPanel = { init, sync, layers };
})(window.MARQ = window.MARQ || {});
