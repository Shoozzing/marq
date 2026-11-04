// Run: node tests/run-tests.js   (logic modules only; no DOM needed)
const fs = require('fs'), vm = require('vm'), path = require('path');
const win = { MARQ: {}, structuredClone, localStorage: (() => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; })() };
const ctx = vm.createContext({ window: win, console, structuredClone, TextEncoder, setTimeout, clearTimeout, JSON, Math, Date, Set, Map });
['core/EventBus','core/Units','core/Store','canvas/LabelSpec','elements/ElementSpec','model/Model','canvas/Viewport','canvas/Rulers','render/LabelRenderer','render/TextLayout','render/ImageCache','render/ElementDrawers','barcode/LinearEncoder','barcode/QrEncoder','barcode/BarcodeRegistry','barcode/JsBarcodeAdapter','barcode/QrAdapter','render/BarcodeDrawers','data/DataModel','generate/Generator','print/PrintPlanner','storage/ProjectStorage','elements/Elements']
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', f + '.js'), 'utf8'), ctx, { filename: f }));
const C = win.MARQ; let fails = 0;
const t = (n, c) => { if (!c) { fails++; console.log('FAIL', n); } else console.log('ok  ', n); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// Units
t('25.4mm = 1in', near(C.Units.convert(25.4, 'mm', 'in'), 1));
t('1cm = 10mm', C.Units.toMM(1, 'cm') === 10);
t('96px = 1in', near(C.Units.toMM(96, 'px'), 25.4));
t('roundtrip px', near(C.Units.fromMM(C.Units.toMM(37, 'px'), 'px'), 37));
t('parse "2in"', near(C.Units.parse('2in', 'mm'), 50.8));
t('parse "12,5" default cm', near(C.Units.parse('12,5', 'cm'), 125));
t('parse invalid', isNaN(C.Units.parse('abc', 'mm')));
t('300dpi px of 25.4mm', near(C.Units.mmToPx(25.4, 300), 300));
t('bad unit throws', (() => { try { C.Units.toMM(1, 'ft'); } catch (e) { return true; } })());

// Viewport
const v = { zoom: 2, panX: 30, panY: 50 };
const s = C.Viewport.mmToScreen(v, 10, 5), m = C.Viewport.screenToMm(v, s.x, s.y);
t('viewport roundtrip', near(m.x, 10) && near(m.y, 5));
const z = C.Viewport.zoomAt(v, 4, 200, 100), a = C.Viewport.screenToMm(v, 200, 100), b = C.Viewport.screenToMm(z, 200, 100);
t('zoomAt keeps anchor', near(a.x, b.x) && near(a.y, b.y));
const f = C.Viewport.fit(100, 50, 800, 600, 40);
t('fit centres', near(f.panX * 2 + 100 * C.Viewport.PX_PER_MM * f.zoom, 800));
t('zoom clamp', C.Viewport.clamp(1000) === 32);

// Units: every pair round-trips, and the physical definitions hold exactly
(() => {
  const us = C.Units.list; let ok = true;
  us.forEach(a => us.forEach(b => { const v = 37.125; if (!near(C.Units.convert(C.Units.convert(v, a, b), b, a), v, 1e-9)) ok = false; }));
  t('all unit pairs round-trip', ok);
  t('1in = 25.4mm = 2.54cm = 96px', near(C.Units.convert(1, 'in', 'mm'), 25.4) && near(C.Units.convert(1, 'in', 'cm'), 2.54) && near(C.Units.convert(1, 'in', 'px'), 96));
  t('A4 in inches', near(C.Units.convert(210, 'mm', 'in'), 8.2677, 1e-4) && near(C.Units.convert(297, 'mm', 'in'), 11.6929, 1e-4));
  t('100mm on screen @100% = 377.95px', near(100 * C.Viewport.PX_PER_MM, 377.9528, 1e-3));
  t('display() rounds per unit', C.Units.display(100, 'in') === 3.937 && C.Units.display(25.4, 'in') === 1 && C.Units.display(10, 'cm') === 1);
})();

// LabelSpec: presets, orientation, size, margins, border, repair
(() => {
  const LSp = C.LabelSpec, mk = () => C.Model.createProject().label;
  t('five presets defined', LSp.PRESETS.map(p => p.id).join() === '50x30,60x40,70x50,100x50,A4');
  let L = mk(); t('default label is 100x50 landscape preset', L.width === 100 && L.height === 50 && L.orientation === 'landscape' && L.preset === '100x50');
  LSp.setPreset(L, '50x30'); t('preset sets size', L.width === 50 && L.height === 30 && L.preset === '50x30');
  LSp.setOrientation(L, 'portrait'); t('portrait swaps', L.width === 30 && L.height === 50 && L.orientation === 'portrait' && L.preset === '50x30');
  LSp.setPreset(L, '70x50'); t('orientation persists across presets', L.width === 50 && L.height === 70 && L.orientation === 'portrait');
  LSp.setOrientation(L, 'landscape'); t('landscape swaps back', L.width === 70 && L.height === 50);
  LSp.setPreset(L, 'A4'); t('A4 landscape = 297x210', L.width === 297 && L.height === 210 && L.preset === 'A4');
  LSp.setOrientation(L, 'portrait'); t('A4 portrait = 210x297', L.width === 210 && L.height === 297);
  LSp.setSize(L, 60, 40); t('typed size matching preset is detected (either orientation)', L.preset === '60x40' && L.orientation === 'landscape');
  LSp.setSize(L, 33, 77); t('odd size -> custom + portrait', L.preset === 'custom' && L.orientation === 'portrait');
  LSp.setPreset(L, '100x50'); LSp.setPreset(L, 'custom'); t('choosing Custom keeps the size', L.preset === 'custom' && L.width === 50 && L.height === 100);
  LSp.setSize(L, 40, 40); LSp.setOrientation(L, 'portrait'); t('square keeps orientation flag', L.orientation === 'portrait' && L.width === 40 && L.height === 40);
  t('size range', LSp.validateSize(0.5) && LSp.validateSize(2001) && LSp.validateSize(NaN) && !LSp.validateSize(1) && !LSp.validateSize(2000));
  L = mk(); LSp.setSize(L, 3.9370078740157 * 25.4, 50); t('sizes stored cleanly (no float dust)', L.width === 100);
  // margins
  L = mk(); t('margin ok', LSp.validateMargin(L, 'left', 5) === null);
  t('negative margin rejected', LSp.validateMargin(L, 'top', -1) !== null);
  t('margin leaves 1mm printable', LSp.validateMargin(L, 'top', 49.5) !== null && LSp.validateMargin(L, 'top', 49) === null);
  LSp.setMargin(L, 'left', 60); t('left+right cap respects opposite side', LSp.validateMargin(L, 'right', 40) !== null && LSp.validateMargin(L, 'right', 39) === null);
  LSp.setMargin(L, 'top', 20); LSp.setMargin(L, 'bottom', 20); LSp.setSize(L, 100, 20);
  t('shrinking label re-fits margins', L.margin.top + L.margin.bottom <= 19 + 1e-9 && L.margin.left + L.margin.right <= 99 + 1e-9);
  L = mk(); L.borderWidth = 10; LSp.setSize(L, 100, 10); t('border clamped to half the short side', L.borderWidth === 5);
  t('border validation', LSp.validateBorder(L, 5) === null && LSp.validateBorder(L, 5.1) !== null && LSp.validateBorder(L, -1) !== null);
  // migration / repair of old and hand-edited files
  const old = C.Model.migrate({ schema: 1, label: { width: 80, height: 120, background: '#ffffff', borderWidth: 0, borderColor: '#000000' } });
  t('old file gains orientation/preset/margins', old.label.orientation === 'portrait' && old.label.preset === 'custom' && old.label.margin.top === 0);
  const bad = C.Model.migrate({ schema: 1, label: { width: -5, height: 99999, background: 'red', margin: { top: -3, left: 'x' }, preset: '50x30' } });
  t('bad values repaired', bad.label.width === 1 && bad.label.height === 2000 && bad.label.background === '#ffffff' && bad.label.margin.top === 0 && bad.label.margin.left === 0 && bad.label.preset === 'custom');
  const part = C.Model.migrate({ schema: 1, label: { width: 50, height: 30, margin: { top: 2 } } });
  t('partial margin merged', part.label.margin.top === 2 && part.label.margin.right === 0 && part.label.preset === '50x30');
})();

// Rulers: tick maths
(() => {
  const R = C.Rulers, k = C.Viewport.PX_PER_MM, mmPpu = k, inPpu = k * 25.4;
  const tk = R.computeTicks({ offset: 40, ppu: mmPpu, length: 700 });
  t('mm @100%: major every 20mm, 4 minors', tk.step === 20 && tk.sub === 4 && near(tk.minor, 5));
  const m0 = tk.ticks.find(x => x.value === 0), m20 = tk.ticks.find(x => x.value === 20);
  t('tick 0 sits on the origin', m0 && m0.pos === 40 && m0.kind === 'major');
  t('20mm tick is 20mm further (px exact)', near(m20.pos - m0.pos, 20 * k, 1e-9));
  t('all labelled majors are >= 56px apart', (() => { const mj = tk.ticks.filter(x => x.kind === 'major'); return mj.every((x, i) => !i || x.pos - mj[i - 1].pos >= 56 - 1e-6); })());
  t('no ticks outside the ruler', tk.ticks.every(x => x.pos >= -1e-6 && x.pos <= 700 + 1e-6));
  const ti = R.computeTicks({ offset: 0, ppu: inPpu, length: 400 });
  t('inches @100%: major every 1in, 10 minors', ti.step === 1 && ti.sub === 10 && ti.ticks.find(x => x.value === 1).pos === 96);
  t('inch tick values are clean decimals', ti.ticks.every(x => Math.abs(x.value * 1e6 - Math.round(x.value * 1e6)) < 1e-6));
  const tp = R.computeTicks({ offset: 0, ppu: 1, length: 400 }); t('px @100%: step 100', tp.step === 100 && tp.ticks.some(x => x.value === 300 && x.pos === 300));
  const tz = R.computeTicks({ offset: -5000, ppu: mmPpu * 32, length: 800 }); t('deep zoom stays sane', tz.step === 0.5 && near(tz.minor, 0.1) && tz.ticks.length < 400);
  t('negative values appear left of origin', R.computeTicks({ offset: 100, ppu: mmPpu, length: 300 }).ticks.some(x => x.value < 0));
  t('niceStep picks 1/2/5 x 10^n', R.niceStep(17).step === 20 && R.niceStep(60).step === 100 && R.niceStep(0.3).step === 0.5 && R.niceStep(1).step === 1);
})();

// Model
const el = C.Model.createElement('barcode', { x: 5, props: { value: 'X1' } });
t('element defaults merged', el.x === 5 && el.props.value === 'X1' && el.props.format === 'CODE128');
t('unknown type throws', (() => { try { C.Model.createElement('foo'); } catch (e) { return true; } })());
const p = C.Model.createProject('P');
t('migrate keeps/fills', C.Model.migrate({ schema: 1, label: { width: 70 } }).label.height === 50);
t('newer schema rejected', (() => { try { C.Model.migrate({ schema: 99 }); } catch (e) { return true; } })());

// Store + history
C.Store.init({ app: {}, project: p, data: {} });
let ev = 0; C.Bus.on('project:changed', () => ev++);
C.Store.commit('w', s => { s.project.label.width = 70; });
C.Store.commit('add', s => { s.project.elements.push(el); });
t('commit mutates + emits', C.Store.state.project.label.width === 70 && ev === 2);
C.Store.undo(); t('undo', C.Store.state.project.elements.length === 0);
C.Store.undo(); t('undo 2', C.Store.state.project.label.width === 100);
C.Store.redo(); t('redo', C.Store.state.project.label.width === 70);
t('new commit clears redo', (C.Store.commit('x', s => { s.project.label.height = 20; }), !C.Store.canRedo()));

// Data model
const ds = C.Data.fromAOA([['Asset ID', 'Name', 'Name', ''], ['A1', 'Pump', 'x', 5], [null, '', '', ''], ['A2', 'Fan']], { fileName: 'a.xlsx' });
t('columns keep headers, unique internal keys', ds.columns.map(c => c.key).join() === 'column_1,column_2,column_3,column_4' && ds.columns.map(c => c.header).join() === 'Asset ID,Name,Name,Column 4');
t('blank rows skipped', ds.totalRecords === 2 && ds.records[1].values.column_3 === '');
const rec0 = ds.records[0], hdrRec = { values: { 'Asset ID': 'A1', Name: 'Pump' } }; // legacy shape: values keyed by name
t('template resolve (legacy, missing -> empty)', C.Data.resolve('ID:{{Asset ID}}/{{Missing}}', hdrRec) === 'ID:A1/');
t('resolveProps no mutation', (() => { const e = C.Model.createElement('qr'); e.bindings.value = '{{Name}}'; const r = C.Data.resolveProps(e, hdrRec); return r.value === 'Pump' && e.props.value === 'https://example.com'; })());

// Stage 07A: dynamic data mapping
(() => {
  const E = C.Elements, err = r => r && r.error;
  C.TextLayout.setMeasurer((f, str) => ({ width: [...str].length * 50, ascent: 80, descent: 20 }));
  const mkDs = () => C.Data.fromAOA([['Asset_Number', 'Asset_Name', 'Location'], ['AST-001', 'Pump A', 'Lobby'], ['AST 002', '', 'Roof'], ['AST-003', 'Fan', '']], { fileName: 'a.xlsx', sheetName: 'S1' });
  const fresh = () => { const pr = C.Model.createProject('D'); const d = mkDs(); C.Store.init({ app: { selection: [], unit: 'mm', activeDatasetId: d.id }, project: pr, data: { [d.id]: d } }); E.init(); return d; };
  let d = fresh();
  const rec = () => C.Data.previewRecord();
  t('07A: preview record = records[previewIndex], decorated by header', rec().byHeader.Asset_Number === 'AST-001' && rec().index === 0 && rec().count === 3);
  t('07A: columns() lists headers', C.Data.columns().join() === 'Asset_Number,Asset_Name,Location');
  const tid = E.add('text'), bid = E.add('code128'), sid = E.add('rect');
  t('07A: new elements are static', C.Data.diagnose(E.get(tid)) === null && Object.keys(E.get(tid).bindings).length === 0);
  // text
  t('07A: setDynamic(text) keeps content as template', E.setDynamic(tid, true) === null && E.get(tid).bindings.text === 'Text');
  E.setBinding(tid, 'text', 'ASSET NO: {{Asset_Number}}\nLOCATION: {{Location}}');
  const r1 = C.Data.resolveProps(E.get(tid), rec());
  t('07A: placeholders mix with static text', r1.text === 'ASSET NO: AST-001\nLOCATION: Lobby' && E.get(tid).props.text === 'Text');
  t('07A: header match is case/space-insensitive', C.Data.resolve('{{ asset_number }}', rec()) === 'AST-001');
  t('07A: unknown column keeps visible placeholder in text', C.Data.resolveProps(Object.assign({}, E.get(tid), { bindings: { text: 'X {{Nope}}' } }), rec()).text === 'X {{Nope}}');
  let dg = C.Data.diagnose(Object.assign({}, E.get(tid), { bindings: { text: '{{Nope}} {{Asset_Number}}' } }));
  t('07A: missing column warned', dg.issues.length === 1 && /Nope/.test(dg.issues[0]) && /not found/.test(dg.issues[0]));
  // barcode
  t('07A: setDynamic(barcode) starts with no column', E.setDynamic(bid, true) === null && E.get(bid).bindings.value === '');
  t('07A: unmapped barcode flagged, not crashing', C.Data.resolveProps(E.get(bid), rec())._bindingIssue === 'No spreadsheet column is selected.');
  E.setBinding(bid, 'value', '{{Asset_Number}}');
  const rb = C.Data.resolveProps(E.get(bid), rec());
  t('07A: barcode takes the record value, keeps its format/props', rb.value === 'AST-001' && rb.format === 'CODE128' && rb.moduleWidth === 0.35 && !rb._bindingIssue && E.get(bid).props.value === 'ASSET-000123');
  t('07A: barcode status ok', C.Data.diagnose(E.get(bid)).issues.length === 0);
  // records
  C.Data.setPreviewIndex(1);
  t('07A: switching record re-resolves, mapping intact', C.Data.resolveProps(E.get(bid), rec()).value === 'AST 002' && E.get(bid).bindings.value === '{{Asset_Number}}' && E.get(tid).bindings.text.includes('{{Location}}'));
  t('07A: empty cell -> empty text + warning', (() => { E.setBinding(tid, 'text', '{{Asset_Name}}'); return C.Data.resolveProps(E.get(tid), rec()).text === '' && /empty/.test(C.Data.diagnose(E.get(tid)).issues[0]); })());
  E.setBinding(bid, 'value', '{{Asset_Name}}');
  t('07A: empty barcode cell flagged', /empty/.test(C.Data.resolveProps(E.get(bid), rec())._bindingIssue));
  C.Data.setPreviewIndex(99);
  t('07A: preview index clamps to last record', rec().index === 2);
  // invalid barcode value
  E.setProp(bid, 'format', 'EAN13'); E.setBinding(bid, 'value', '{{Asset_Number}}'); C.Data.setPreviewIndex(0);
  t('07A: invalid barcode value reported by the panel', /cannot use/.test(C.Data.diagnose(E.get(bid)).issues.join()));
  t('07A: format change allowed while dynamic', E.setProp(bid, 'format', 'CODE39') === null);
  // unavailable data
  C.Store.state.app.activeDatasetId = null;
  t('07A: no dataset -> null record, text keeps placeholders, no throw', rec() === null && C.Data.resolveProps(E.get(tid), null).text === '{{Asset_Name}}' && /No spreadsheet is loaded/.test(C.Data.diagnose(E.get(tid)).issues[0]));
  t('07A: no dataset -> barcode flagged', C.Data.resolveProps(E.get(bid), null)._bindingIssue === 'No spreadsheet record is available.');
  C.Store.state.app.activeDatasetId = d.id;
  // persistence: undo/redo, save, reopen, duplicate
  const saved = JSON.parse(JSON.stringify(C.Model.serializable(C.Store.state.project))), back = C.Model.migrate(saved);
  t('07A: mappings survive save -> reopen', back.elements.find(e => e.id === tid).bindings.text === '{{Asset_Name}}' && back.elements.find(e => e.id === bid).bindings.value === '{{Asset_Number}}');
  t('07A: static elements load unchanged', back.elements.find(e => e.id === sid).bindings && Object.keys(back.elements.find(e => e.id === sid).bindings).length === 0);
  t('07A: old files without bindings / junk bindings load', (() => { const m = C.Model.migrate({ schema: 1, elements: [{ type: 'text', props: { text: 'Hi' } }, { type: 'text', bindings: { text: 5, x: ['a'] }, props: {} }, { type: 'text', bindings: [1] }] }); return m.elements[0].props.text === 'Hi' && Object.keys(m.elements[0].bindings).length === 0 && Object.keys(m.elements[1].bindings).length === 0 && Object.keys(m.elements[2].bindings).length === 0; })());
  t('07A: duplicate copies the mapping', (() => { const n = E.duplicate(tid); return E.get(n).bindings.text === '{{Asset_Name}}'; })());
  E.setBinding(tid, 'text', '{{Location}}'); C.Store.undo(); t('07A: undo restores previous mapping', E.get(tid).bindings.text === '{{Asset_Name}}');
  // static <-> dynamic
  t('07A: back to static removes the mapping, static props untouched', E.setDynamic(tid, false) === null && !('text' in E.get(tid).bindings) && C.Data.resolveProps(E.get(tid), rec()).text === 'Text');
  t('07A: switching modes repeatedly is stable', E.setDynamic(tid, true) === null && E.setDynamic(tid, true) === null && E.setDynamic(tid, false) === null && E.setDynamic(tid, false) === null);
  t('07A: rect cannot be bound; wrong prop rejected', err(E.setDynamic(sid, true)) && err(E.setBinding(tid, 'fontSize', '{{x}}')) && err(E.setBinding(tid, 'text', 5)));
  E.setMeta(tid, { locked: true }); t('07A: locked element refuses mapping', err(E.setBinding(tid, 'text', '{{Location}}')));
  // renderer smoke: draws bound elements with and without a record without throwing
  const calls = []; const cx = new Proxy({}, { get: (_, k) => k === 'measureText' ? (() => ({ width: 5, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 2 })) : (k === 'canvas' ? {} : (...a) => calls.push(k)), set: () => true });
  t('07A: Renderer.draw with record / null record / missing data does not throw', (() => { try { C.TextLayout.setMeasurer((f, str) => ({ width: [...str].length * 50, ascent: 80, descent: 20 })); E.setMeta(tid, { locked: false }); C.Renderer.draw(cx, C.Store.state.project, rec(), 4, {}); C.Renderer.draw(cx, C.Store.state.project, null, 4, {}); return true; } catch (e) { console.log(e); return false; } })());
})();

// Print planner: A4, 10mm margins, 100x50 labels, gap 2 -> cols floor(192/102)=1, rows floor(279/52)=5
const pg = C.Model.createProject().page, lay = C.PrintPlanner.layout(pg, { width: 100, height: 50 });
t('A4 layout 1x5', lay.cols === 1 && lay.rows === 5 && lay.perPage === 5 && lay.cells.length === 5);
const l2 = C.PrintPlanner.layout(Object.assign({}, pg, { orientation: 'landscape' }), { width: 60, height: 30 });
t('landscape layout', l2.sheet.w === 297 && l2.cols === 4 && l2.rows === 6);
t('paginate', JSON.stringify(C.PrintPlanner.paginate(7, 3)) === '[[0,1,2],[3,4,5],[6]]');
t('label larger than sheet -> 0', C.PrintPlanner.layout(pg, { width: 500, height: 500 }).perPage === 0);

// Stage 09: print configuration (physical layout)
(() => {
  const P = C.PrintPlanner, L = { width: 50, height: 30 };
  const page = () => C.PrintPlanner.normalize(Object.assign({}, C.Model.createProject().page));
  t('09: default page is A4 sheet, top-left, 1:1 scale', (() => { const p = page(); return p.size === 'A4' && p.layout === 'sheet' && p.alignX === 'left' && p.alignY === 'top' && p.scale === 1 && p.copies === 1 && p.scope === 'all'; })());
  const a4 = P.layout(page(), { width: 100, height: 50 });
  t('09: first cell sits on the 10 mm margins', a4.cells[0].x === 10 && a4.cells[0].y === 10 && a4.cells[0].w === 100 && a4.cells[0].h === 50);
  let p = page(); P.setPaper(p, 'Letter');
  t('09: Letter portrait sheet is 215.9 × 279.4 mm', (() => { const s = P.sheet(p); return near(s.w, 215.9) && near(s.h, 279.4); })());
  P.setOrientation(p, 'landscape');
  t('09: Letter landscape swaps to 279.4 × 215.9 mm', (() => { const s = P.sheet(p); return near(s.w, 279.4) && near(s.h, 215.9); })());
  P.setCustomSize(p, 80, 40); P.setOrientation(p, 'landscape'); P.setMargin(p, 'top', 0); P.setMargin(p, 'bottom', 0); P.setMargin(p, 'left', 0); P.setMargin(p, 'right', 0);
  t('09: custom thermal-size paper is used as-is when already landscape', (() => { const s = P.sheet(p); return s.w === 80 && s.h === 40; })());
  p = page(); P.setPaper(p, 'A4'); P.setGap(p, 'x', 2); P.setGap(p, 'y', 2);
  const g = P.layout(p, L); // 50×30 on A4, 10 mm margins, gap 2 → 3×8
  t('09: 50×30 mm labels on A4 fill 3×8', g.cols === 3 && g.rows === 8 && g.perPage === 24 && near(g.cells[1].x, 62) && near(g.cells[3].y, 42));
  P.setAlign(p, 'x', 'center'); P.setAlign(p, 'y', 'middle');
  const c = P.layout(p, L);
  t('09: centre alignment offsets leftover millimetres', near(c.used.w, 154) && near(c.used.h, 254) && near(c.cells[0].x, 10 + (190 - 154) / 2) && near(c.cells[0].y, 10 + (277 - 254) / 2));
  P.setAlign(p, 'x', 'right'); P.setAlign(p, 'y', 'bottom');
  const rgt = P.layout(p, L);
  t('09: bottom-right alignment', near(rgt.cells[0].x, 10 + 190 - 154) && near(rgt.cells[0].y, 10 + 277 - 254));
  p = page(); P.setLayout(p, 'single');
  t('09: single-label layout is 1×1', P.layout(p, { width: 100, height: 50 }).perPage === 1 && P.layout(p, { width: 100, height: 50 }).cols === 1);
  p = page(); P.setLayout(p, 'continuous');
  t('09: continuous defaults to one column, as many rows as fit', (() => { const l = P.layout(p, { width: 100, height: 50 }); return l.cols === 1 && l.rows === 5 && l.mode === 'continuous'; })());
  p = page(); P.setLayout(p, 'thermal', { width: 100, height: 50, orientation: 'landscape' });
  t('09: thermal uses a custom sheet equal to the label', (() => { const l = P.layout(p, { width: 100, height: 50 }); return p.size === 'Custom' && l.sheet.w === 100 && l.sheet.h === 50 && l.perPage === 1 && l.fit; })());
  p = page(); P.setScale(p, 0.5);
  t('09: 50% print scale doubles how many 100×50 labels fit on A4', (() => { const l = P.layout(p, { width: 100, height: 50 }); return near(l.footprint.w, 50) && near(l.footprint.h, 25) && l.cols === 3 && l.rows === 10; })());
  t('09: sequence repeats each label N times', JSON.stringify(P.sequence([4, 7], 3)) === '[4,4,4,7,7,7]');
  p = page(); P.setCopies(p, 2);
  t('09: plan paginates copies onto sheets', (() => { const j = P.plan(p, { width: 100, height: 50 }, [0, 1, 2]); return j.count === 6 && j.pageCount === 2 && j.pages[0].map(x => x.index).join() === '0,0,1,1,2' && j.pages[1].map(x => x.index).join() === '2'; })());
  p = page(); P.setColumns(p, 2); P.setRows(p, 2);
  t('09: manual 2×2 is capped by what physically fits', (() => { const l = P.layout(p, { width: 100, height: 50 }); return l.cols === 1 && l.rows === 2; })());
  const old = C.Model.migrate({ schema: 1, page: { size: 'A4' } });
  t('09: old projects gain align/layout/scale/copies/scope', old.page.alignX === 'left' && old.page.layout === 'sheet' && old.page.scale === 1 && old.page.copies === 1 && old.page.scope === 'all');
  t('09: invalid scale/copies/grid rejected', P.validateScale(0) && P.validateScale(5) && !P.validateScale(1) && P.validateCopies(0) && !P.validateCopies(2) && P.validateGrid(0) && !P.validateGrid('auto'));
})();

// Barcode registry (no libs here -> graceful error)
t('registry unknown', C.Barcodes.render('NOPE', '1').error === 'Unknown format NOPE');

// Storage
const q = C.Model.createProject('S'); C.Store.init({ app: {}, project: q, data: {} });
C.Storage.save(q); const back = C.Storage.loadLast();
t('storage roundtrip', back && back.id === q.id && back.meta.name === 'S');
t('storage list', C.Storage.list().length === 1);
C.Storage.remove(q.id); t('storage remove', C.Storage.list().length === 0);

// ---------- Stage 03: design elements ----------
(() => {
  const SPc = C.ElementSpec, E = C.Elements, TL = C.TextLayout;
  TL.setMeasurer((font, str) => ({ width: [...str].length * (/bold/.test(font) ? 60 : 50), ascent: 80, descent: 20 })); // deterministic: 0.5em per char (0.6 bold)
  const fresh = () => { const p = C.Model.createProject('T'); C.Store.init({ app: { selection: [], unit: 'mm' }, project: p, data: {} }); E.init(); return p; };
  const els = () => C.Store.state.project.elements;
  const err = (r) => r && r.error;

  // validators
  t('prop validate ok', SPc.validateProp('text', 'fontSize', 12).value === 12);
  t('font size 0 / 501 / NaN rejected', ['0', 0, 501, NaN, '12'].slice(1).every(v => SPc.validateProp('text', 'fontSize', v).error));
  t('colour must be #rrggbb', SPc.validateProp('text', 'color', 'red').error && SPc.validateProp('text', 'color', '#ABCDEF').value === '#abcdef');
  t('"none" only where allowed', SPc.validateProp('rect', 'fill', '').value === '' && SPc.validateProp('text', 'color', '').error && SPc.validateProp('line', 'stroke', '').error);
  t('enum + bool + unknown key', SPc.validateProp('text', 'align', 'justify').error && SPc.validateProp('text', 'bold', 1).error && SPc.validateProp('text', 'nope', 1).error && SPc.validateProp('text', 'align', 'center').value === 'center');
  t('line width > 0', SPc.validateProp('line', 'strokeWidth', 0).error && SPc.validateProp('line', 'strokeWidth', 0.05).value === 0.05 && SPc.validateProp('rect', 'strokeWidth', 0).value === 0);
  t('geometry range', SPc.validateGeometry('w', 0).error && SPc.validateGeometry('w', 0.1).value === 0.1 && SPc.validateGeometry('x', -5).value === -5 && SPc.validateGeometry('x', 1e6).error);
  t('rotation normalised to [0,360)', SPc.validateRotation(-90).value === 270 && SPc.validateRotation(450).value === 90 && SPc.validateRotation(360).value === 0 && SPc.validateRotation(NaN).error);
  t('opacity 0..100 -> 0..1', SPc.validateOpacity(50).value === 0.5 && SPc.validateOpacity(101).error);
  t('describe formats lengths via callback', /between 1 mm and 5 mm/.test(SPc.describe({ label: 'X', min: 1, max: 5, len: true }, (a, b) => a + ' mm and ' + b + ' mm')));

  // repair of hand-edited / old files
  const bad = C.Model.migrate({ schema: 1, elements: [
    { type: 'rect', x: 'a', w: -4, h: 1e9, rotation: 725, opacity: 7, props: { fill: 'blue', strokeWidth: 999 } },
    { type: 'bogus' }, null, { type: 'line', h: 12, w: 10 }, { type: 'text', props: { fontSize: 'big', align: 'diagonal', color: 'x' } }] });
  t('unknown/null elements dropped, rest kept', bad.elements.length === 3);
  const r0 = bad.elements[0];
  t('rect repaired', r0.x === 0 && r0.w === 0.1 && r0.h === 5000 && r0.rotation === 5 && r0.opacity === 1 && r0.props.fill === '#ffffff' && r0.props.strokeWidth === 50 && !!r0.id && !!r0.name);
  t('line height forced to 0', bad.elements[1].h === 0);
  t('text props fall back to defaults', bad.elements[2].props.fontSize === 10 && bad.elements[2].props.align === 'left' && bad.elements[2].props.color === '#000000');
  t('old project gains assets {}', JSON.stringify(C.Model.migrate({ schema: 1 }).assets) === '{}');

  // hit testing (rotation, lines)
  const box = { type: 'rect', x: 10, y: 10, w: 20, h: 10, rotation: 0, props: {} };
  t('hit inside / outside', SPc.hit(box, 15, 15) && !SPc.hit(box, 5, 15));
  const rot = Object.assign({}, box, { rotation: 90 }); // centre (20,15): becomes 10 wide x 20 tall
  t('rotated 90: tall footprint', SPc.hit(rot, 20, 6) && !SPc.hit(rot, 12, 15));
  const cs = SPc.corners(rot); t('corners rotate about centre', Math.abs(cs[0].x - 25) < 1e-9 && Math.abs(cs[0].y - 5) < 1e-9);
  const ln = { type: 'line', x: 0, y: 5, w: 20, h: 0, rotation: 0, props: { strokeWidth: 0.4 } };
  t('thin line hit needs tolerance', !SPc.hit(ln, 10, 6) && SPc.hit(ln, 10, 5.1) && SPc.hit(ln, 10, 6, 1.2));

  // text layout (fake measurer: size 10pt = 3.5278mm, 0.5em/char = 1.7639mm per char)
  const tp = Object.assign({}, C.Model.TYPE_DEFAULTS.text.props), cw = 10 * TL.PT * 0.5;
  tp.text = 'aaaa bbbb cccc'; let lay = TL.layout(tp, cw * 8.5);
  t('wraps at word boundaries', lay.lines.map(l => l.text).join('|') === 'aaaa|bbbb|cccc');
  lay = TL.layout(tp, cw * 10); t('two words fit on a line at exact width', lay.lines.map(l => l.text).join('|') === 'aaaa bbbb|cccc');
  tp.text = 'a\n\nb'; t('explicit newlines + blank line kept', TL.layout(tp, 100).lines.length === 3);
  tp.text = 'abcdefghij'; lay = TL.layout(tp, cw * 4); t('over-long word breaks by character', lay.lines.map(l => l.text).join('|') === 'abcd|efgh|ij');
  tp.text = 'abcd'; const w0 = TL.layout(tp, 100).lines[0].width; tp.letterSpacing = 2; const w1 = TL.layout(tp, 100).lines[0].width;
  t('letter spacing adds (n-1) gaps', Math.abs((w1 - w0) - 3 * 2 * TL.PT) < 1e-9); tp.letterSpacing = 0;
  tp.bold = true; t('bold measures wider', TL.layout(tp, 100).lines[0].width > w0); tp.bold = false;
  tp.text = 'a\nb\nc'; tp.lineHeight = 1.5; lay = TL.layout(tp, 100);
  t('content height = lines × size × line-height', Math.abs(lay.contentH - 3 * 10 * TL.PT * 1.5) < 1e-9 && Math.abs(TL.fitHeight(Object.assign({}, tp, { padding: 1 }), 100) - (lay.contentH + 2)) < 1e-9);

  // adding elements
  let p = fresh();
  const kinds = { heading: ['text', 'Heading 1'], text: ['text', 'Text 1'], rect: ['rect', 'Rectangle 1'], rrect: ['rect', 'Rounded rectangle 1'], circle: ['ellipse', 'Circle 1'], ellipse: ['ellipse', 'Ellipse 1'], line: ['line', 'Line 1'], dashed: ['line', 'Dashed line 1'] };
  Object.keys(kinds).forEach(k => E.add(k));
  t('all 8 kinds added in order', els().length === 8 && els().every((e, i) => e.type === Object.values(kinds)[i][0] && e.name === Object.values(kinds)[i][1]), els().map(e => e.name));
  const by = n => els().find(e => e.name === n);
  t('heading bold 18pt', by('Heading 1').props.bold === true && by('Heading 1').props.fontSize === 18);
  t('rounded rect has radius, rect does not', by('Rounded rectangle 1').props.radius === 3 && by('Rectangle 1').props.radius === 0);
  t('circle is square + aspect-locked; ellipse is not', by('Circle 1').w === by('Circle 1').h && by('Circle 1').props.lockAspect === true && by('Ellipse 1').props.lockAspect === false);
  t('dashed line is a line with dash=dashed; line is solid', by('Dashed line 1').props.dash === 'dashed' && by('Line 1').props.dash === 'solid' && by('Line 1').h === 0);
  t('new element is selected', C.Store.state.app.selection[0] === els()[7].id);
  const c0 = by('Circle 1'); t('centred on label (100×50)', Math.abs(c0.x + c0.w / 2 - 50) < 0.01 && Math.abs(c0.y + c0.h / 2 - 25) < 0.01 || c0.x > 50 - c0.w / 2); // later ones cascade
  t('cascade avoids exact overlap', new Set(els().map(e => e.x + ',' + e.y)).size >= 6);
  t('heading auto-height matches layout', Math.abs(by('Heading 1').h - TL.fitHeight(by('Heading 1').props, by('Heading 1').w)) < 1e-3);
  C.Store.undo(); t('undo removes last add', els().length === 7); C.Store.redo(); t('redo restores', els().length === 8);
  t('every element is in app state with full schema', els().every(e => e.id && e.name && 'x' in e && 'rotation' in e && e.props && e.bindings && typeof e.opacity === 'number'));

  // small label: size is capped
  p = fresh(); C.Store.commit('s', s => { C.LabelSpec.setSize(s.project.label, 20, 10); }); E.add('heading'); E.add('rect');
  t('elements never exceed 90% of the label width (text wraps instead)', els().every(e => e.w <= 18 + 1e-9) && els().filter(e => e.type !== 'text').every(e => e.h <= 9 + 1e-9), els().map(e => [e.w, e.h]));

  // editing
  p = fresh(); const id = E.add('rect'), rid = id, R = () => E.get(id);
  t('set x/y', E.setGeometry(id, { x: 12.5, y: 3 }) === null && R().x === 12.5 && R().y === 3);
  t('bad width rejected, nothing changes', err(E.setGeometry(id, { w: 0 })) && R().w === 30);
  t('NaN rejected', err(E.setGeometry(id, { x: NaN })) && R().x === 12.5);
  t('no aspect lock: width alone', E.setGeometry(id, { w: 40 }) === null && R().w === 40 && R().h === 15);
  E.setProp(id, 'lockAspect', true); E.setGeometry(id, { w: 80 }); t('aspect lock: height follows width (40:15)', Math.abs(R().h - 30) < 1e-3);
  E.setGeometry(id, { h: 15 }); t('aspect lock: width follows height', Math.abs(R().w - 40) < 1e-3);
  t('aspect lock cannot push the other side out of range', err(E.setGeometry(id, { w: 6000 })) && R().w === 40);
  E.setGeometry(id, { w: 20, h: 20 }); t('both sides given: lock ignored', R().w === 20 && R().h === 20);
  t('rotation stored normalised', E.setRotation(id, -90) === null && R().rotation === 270 && E.setRotation(id, 'x') && R().rotation === 270);
  t('opacity %', E.setOpacity(id, 25) === null && R().opacity === 0.25 && err(E.setOpacity(id, 120)));
  t('prop validation through setProp', err(E.setProp(id, 'fill', 'nope')) && R().props.fill === '#ffffff' && E.setProp(id, 'fill', '') === null && R().props.fill === '');
  t('unknown prop rejected', err(E.setProp(id, 'bogus', 1)) && err(E.setProp(id, 'assetId', 'x')));
  t('radius', E.setProp(id, 'radius', 4) === null && R().props.radius === 4);
  // coalescing: typing in one field = one undo step
  const n0 = els().length; C.Store.commit('x', () => {}); // fence so earlier edits are separate
  E.setProp(id, 'strokeWidth', 1); E.setProp(id, 'strokeWidth', 2); E.setProp(id, 'strokeWidth', 3);
  t('3 quick edits of one field = 1 undo step', (() => { C.Store.undo(); return R().props.strokeWidth === 0.3; })());
  C.Store.redo();
  E.setProp(id, 'stroke', '#ff0000'); E.setProp(id, 'strokeWidth', 5); C.Store.undo(); t('different fields are separate steps', R().props.strokeWidth === 3 && R().props.stroke === '#ff0000');
  // line
  const lid = E.add('line'); E.setGeometry(lid, { h: 9 }); t('line height stays 0', E.get(lid).h === 0);
  t('line has no aspect lock', E.get(lid).props.lockAspect === undefined && E.setGeometry(lid, { w: 55 }) === null && E.get(lid).w === 55);
  E.setProp(lid, 'dash', 'dotted'); t('line style', E.get(lid).props.dash === 'dotted' && err(E.setProp(lid, 'dash', 'wavy')));
  // text
  const tid = E.add('text'), T = () => E.get(tid), h0 = T().h;
  E.setProp(tid, 'text', 'one\ntwo\nthree'); t('auto height grows with lines', Math.abs(T().h - 3 * 10 * TL.PT * 1.2) < 1e-3 && T().h > h0);
  E.setProp(tid, 'fontSize', 20); t('auto height follows font size', Math.abs(T().h - 3 * 20 * TL.PT * 1.2) < 1e-3);
  E.setProp(tid, 'text', 'aaaa bbbb cccc dddd'); E.setGeometry(tid, { w: 12 }); t('auto height follows width (re-wrap)', T().h > 20 * TL.PT * 1.2 * 1.5);
  E.setGeometry(tid, { h: 99 }); t('height input ignored while auto height is on', T().h < 99);
  E.setProp(tid, 'autoHeight', false); E.setGeometry(tid, { h: 40 }); t('manual height when auto height off', T().h === 40);
  E.setProp(tid, 'fontSize', 30); t('manual height kept when text grows', T().h === 40);
  E.setProp(tid, 'autoHeight', true); t('turning auto height on refits', T().h !== 40);
  E.setProp(tid, 'padding', 2); const hp = T().h; E.setProp(tid, 'padding', 0); t('padding counts in auto height', hp > T().h);
  t('text props: letter spacing / line height / colour / bg / align', E.setProp(tid, 'letterSpacing', 1.5) === null && E.setProp(tid, 'lineHeight', 2) === null && E.setProp(tid, 'color', '#112233') === null && E.setProp(tid, 'background', '#ffff00') === null && E.setProp(tid, 'align', 'right') === null && T().props.align === 'right' && T().props.background === '#ffff00');
  t('line height 0 rejected', err(E.setProp(tid, 'lineHeight', 0)) && T().props.lineHeight === 2);
  // locking / visibility
  E.setMeta(tid, { locked: true }); t('locked element refuses edits', err(E.setGeometry(tid, { x: 1 })) && err(E.setProp(tid, 'text', 'z')) && err(E.setRotation(tid, 5)) && !E.remove(tid));
  t('locked element can be unlocked/renamed', E.setMeta(tid, { name: ' Title ', locked: false }) === null && T().name === 'Title' && !T().locked);
  // structure
  const order = () => els().map(e => e.id), a0 = order();
  t('reorder up/down/top/bottom', (() => { E.reorder(a0[0], 'up'); const o1 = order(); E.reorder(a0[0], 'down'); const o2 = order(); E.reorder(a0[0], 'top'); const o3 = order(); E.reorder(a0[0], 'bottom'); return o1[1] === a0[0] && o2[0] === a0[0] && o3[o3.length - 1] === a0[0] && order()[0] === a0[0]; })());
  t('reorder at the edge is a no-op', E.reorder(order()[0], 'down') === false && E.reorder(order()[order().length - 1], 'up') === false);
  const dn = els().length, d = E.duplicate(tid);
  t('duplicate: new id, same props, offset, selected', els().length === dn + 1 && d !== tid && E.get(d).props.text === T().props.text && Math.abs(E.get(d).x - T().x - 2) < 1e-9 && C.Store.state.app.selection[0] === d && E.get(d).props !== T().props);
  E.remove(d); t('delete + selection pruned', !E.get(d) && C.Store.state.app.selection.length === 0);
  C.Store.undo(); t('undo delete brings it back', !!E.get(d));
  // hit test order
  p = fresh(); const b1 = E.add('rect'), b2 = E.add('rect'); E.setGeometry(b1, { x: 10, y: 10, w: 20, h: 20 }); E.setGeometry(b2, { x: 20, y: 10, w: 20, h: 20 });
  t('topmost wins where they overlap', E.hitTest(25, 20, 0) === b2 && E.hitTest(15, 20, 0) === b1 && E.hitTest(80, 40, 0) === null);
  E.setMeta(b2, { locked: true }); t('locked skipped by canvas picking', E.hitTest(25, 20, 0) === b1);
  E.setMeta(b2, { locked: false, visible: false }); t('hidden skipped by canvas picking', E.hitTest(25, 20, 0) === b1);

  // images: assets are shared (not cloned) by undo snapshots and pruned on save
  p = fresh(); C.Store.commit('img', s => { s.project.assets.a1 = { name: 'a', mime: 'image/png', dataUrl: 'data:x', w: 4, h: 2 }; s.project.assets.orphan = { name: 'o', mime: 'image/png', dataUrl: 'data:y', w: 1, h: 1 }; s.project.elements.push(C.Model.createElement('image', { w: 20, h: 10, props: { assetId: 'a1', naturalW: 4, naturalH: 2 } })); });
  const iid = els()[0].id, assetsRef = C.Store.state.project.assets;
  C.Store.commit('move', s => { s.project.elements[0].x = 3; }); C.Store.undo();
  t('undo snapshots share assets by reference', C.Store.state.project.assets === assetsRef);
  const ser = C.Model.serializable(C.Store.state.project); t('save drops unused assets, keeps used', !!ser.assets.a1 && !ser.assets.orphan && !!C.Store.state.project.assets.orphan);
  E.setGeometry(iid, { w: 40 }); t('image: lock aspect on by default (4:2 keeps 2:1)', E.get(iid).props.lockAspect === true && Math.abs(E.get(iid).h - 20) < 1e-3);
  E.setGeometry(iid, { h: 5 }); t('image: height edit moves width', Math.abs(E.get(iid).w - 10) < 1e-3);
  E.setProp(iid, 'lockAspect', false); E.setGeometry(iid, { w: 30 }); t('image: unlocked stretches freely', E.get(iid).w === 30 && E.get(iid).h === 5);
  E.resetAspect(iid); t('image: reset restores 2:1 keeping width', Math.abs(E.get(iid).h - 15) < 1e-3);
  E.setRotation(iid, 45); t('image rotation', E.get(iid).rotation === 45);
  t('image fit enum', E.setProp(iid, 'fit', 'cover') === null && err(E.setProp(iid, 'fit', 'tile')));
  const round = JSON.parse(JSON.stringify(ser)), back = C.Model.migrate(round); t('project with image survives save → load', back.elements[0].props.assetId === 'a1' && back.assets.a1.dataUrl === 'data:x');
})();

// Stage 07B: live preview & record navigation
(() => {
  const E = C.Elements, D = C.Data;
  C.TextLayout.setMeasurer((f, str) => ({ width: [...str].length * 50, ascent: 80, descent: 20 }));
  const rows = [['Asset_Number', 'Asset_Name', 'Location']]; for (let i = 1; i <= 2000; i++) rows.push(['AST-' + String(i).padStart(4, '0'), i === 2 ? '' : 'Pump ' + i, i === 3 ? '' : 'Loc ' + i]);
  const d = D.fromAOA(rows, { fileName: 'big.xlsx', sheetName: 'S' });
  C.Store.init({ app: { selection: [], unit: 'mm', activeDatasetId: d.id, previewIndex: 0 }, project: C.Model.createProject('N'), data: { [d.id]: d } }); E.init();
  const tid = E.add('text'), bid = E.add('code128'), sid = E.add('text'), rid = E.add('rect');
  E.setDynamic(tid, true); E.setBinding(tid, 'text', '{{Asset_Name}} @ {{Location}}'); E.setDynamic(bid, true); E.setBinding(bid, 'value', '{{Asset_Number}}');
  const staticText = E.get(sid).props.text, before = JSON.stringify(C.Store.state.project), dataBefore = JSON.stringify(d.records.slice(0, 50));
  const rp = id => D.resolveProps(E.get(id), D.previewRecord());
  t('07B: count + index', D.recordCount() === 2000 && D.previewIndex() === 0);
  t('07B: record 1 resolves text + barcode', rp(tid).text === 'Pump 1 @ Loc 1' && rp(bid).value === 'AST-0001');
  let projEvents = 0; C.Bus.on('project:changed', () => projEvents++);
  t('07B: next -> record 2, barcode follows', D.stepPreview(1) === 1 && rp(bid).value === 'AST-0002' && rp(tid).text === ' @ Loc 2');
  t('07B: previous -> record 1', D.stepPreview(-1) === 0 && rp(bid).value === 'AST-0001');
  t('07B: cannot go before first', D.stepPreview(-1) === 0 && D.previewIndex() === 0);
  t('07B: jump + cannot pass last', D.setPreviewIndex(5000) === 1999 && D.stepPreview(1) === 1999 && rp(bid).value === 'AST-2000');
  t('07B: junk index is safe', D.setPreviewIndex('abc') === 0 && D.setPreviewIndex(NaN) === 0 && D.setPreviewIndex(-4) === 0 && D.setPreviewIndex(2.9) === 2);
  t('07B: empty cell -> empty text, no throw', (D.setPreviewIndex(2), rp(tid).text === 'Pump 3 @ ') && (D.setPreviewIndex(1), rp(tid).text === ' @ Loc 2'));
  t('07B: empty cell in barcode column flagged', (E.setBinding(bid, 'value', '{{Location}}'), D.setPreviewIndex(2), /empty/.test(rp(bid)._bindingIssue)));
  t('07B: missing column flagged, no throw', (E.setBinding(bid, 'value', '{{Nope}}'), /not found/.test(rp(bid)._bindingIssue)));
  E.setBinding(bid, 'value', '{{Asset_Number}}'); D.setPreviewIndex(0);
  const stamp2 = C.Store.state.project.meta.modified; projEvents = 0; let appEvents = 0; C.Bus.on('app:changed', () => appEvents++);
  D.stepPreview(1); D.stepPreview(1); D.stepPreview(-1);
  t('07B: record switches emit no project event, no modified stamp, no undo step', projEvents === 0 && appEvents === 3 && C.Store.state.project.meta.modified === stamp2);
  t('07B: no-op navigation emits nothing', (appEvents = 0, D.setPreviewIndex(D.previewIndex()), appEvents === 0));
  D.setPreviewIndex(0);
  t('07B: template unchanged after navigation (bindings, static text, props)', JSON.stringify(C.Store.state.project).replace(/"modified":"[^"]*"/, '') === before.replace(/"modified":"[^"]*"/, '') && E.get(sid).props.text === staticText);
  t('07B: imported rows unchanged', JSON.stringify(d.records.slice(0, 50)) === dataBefore);
  t('07B: previewIndex is not stored in the project', C.Store.state.project.dataBinding.previewIndex === 0 && C.Store.state.app.previewIndex === 0);
  t('07B: static elements still resolve unchanged', rp(sid).text === staticText && rp(rid).fill === E.get(rid).props.fill);
  let n = 0; const t0 = Date.now(); for (let i = 0; i < 2000; i++) { D.setPreviewIndex(i); n += rp(bid).value.length; } const ms = Date.now() - t0;
  t('07B: 2000 record switches + resolves fast (' + ms + ' ms)', ms < 1500 && n > 0);
  C.Store.state.app.activeDatasetId = null;
  t('07B: no dataset -> count 0, step is a no-op, no throw', D.recordCount() === 0 && D.stepPreview(1) === 0 && D.previewRecord() === null);
  C.Store.state.app.activeDatasetId = d.id; D.setPreviewIndex(10);
  const d2 = D.fromAOA([['Asset_Number'], ['X-1']], {}); C.Store.state.data[d2.id] = d2; C.Store.state.app.activeDatasetId = d2.id;
  t('07B: shrinking dataset clamps the index', D.previewIndex() === 0 && D.previewRecord().index === 0);
})();

// Stage 08: bulk label generator (engine)
const stage08 = async () => {
  const E = C.Elements, G = C.Generator, D = C.Data;
  C.TextLayout.setMeasurer((f, str) => ({ width: [...str].length * 50, ascent: 80, descent: 20 }));
  const build = n => { const rows = [['Asset_Number', 'Asset_Name', 'Location']]; for (let i = 1; i <= n; i++) rows.push([i === 5 ? '' : i === 11 ? 'AST-00010' : 'AST-' + String(i).padStart(5, '0'), i === 3 ? '' : 'Pump ' + i, 'Loc ' + (i % 7)]); return D.fromAOA(rows, { fileName: 'g.xlsx', sheetName: 'S' }); };
  const setup = n => { const d = build(n); C.Store.init({ app: { selection: [], unit: 'mm', activeDatasetId: d.id, previewIndex: 0 }, project: C.Model.createProject('G'), data: { [d.id]: d } }); E.init();
    const ids = { t: E.add('text'), b: E.add('code128'), q: E.add('qr'), s: E.add('text') };
    E.setDynamic(ids.t, true); E.setBinding(ids.t, 'text', '{{Asset_Name}} / {{Location}}'); E.setDynamic(ids.b, true); E.setBinding(ids.b, 'value', '{{Asset_Number}}'); E.setDynamic(ids.q, true); E.setBinding(ids.q, 'value', '{{Asset_Number}}');
    return { d, ids }; };
  const gen = (d, mode, cb) => G.run(C.Store.state.project, d, mode, cb).promise;
  let { d, ids } = setup(100);
  // scope: all / selected / excluded
  t('08: all = every record', G.scope(d, 'all').length === 100 && G.scope(d, 'selected').length === 100);
  d.records[0].excluded = true; d.records[0].selected = false; d.records[1].selected = false; d.records[2].selected = false;
  t('08: excluded never generated; selected honours the ticks', G.scope(d, 'all').length === 99 && G.scope(d, 'selected').length === 97 && !G.scope(d, 'all').includes(0) && !G.scope(d, 'selected').includes(1) && G.scope(d, 'all').includes(1));
  d.records[0].excluded = false; d.records.forEach(r => { r.selected = true; });
  // all-record generation with missing data, duplicates, barcode validity
  const before = JSON.stringify([C.Store.state.project.elements, d.records.slice(0, 40)]);
  let progress = 0, r = await gen(d, 'all', () => progress++);
  t('08: every record processed, none lost', r.total === 100 && r.counts.done === 100 && r.counts.ok + r.counts.warn + r.counts.fail === 100 && !r.cancelled);
  t('08: empty barcode cell (row 5) FAILS, not an invalid barcode', r.status[4] === G.FAIL && /empty/.test(r.issues.get(4).join()));
  t('08: empty text cell (row 3) completes with a warning', r.status[2] === G.WARN && /empty/.test(r.issues.get(2).join()));
  t('08: duplicate barcode values flagged on both records, still completed', r.status[9] === G.WARN && r.status[10] === G.WARN && /value shared/.test(r.issues.get(9).join()) && r.issues.get(9).length === 2 && r.duplicates === 2);
  t('08: counts: 1 failed, completed = 99', r.counts.fail === 1 && r.counts.ok + r.counts.warn === 99 && r.counts.warn === 3);
  t('08: template and dataset never modified', JSON.stringify([C.Store.state.project.elements, d.records.slice(0, 40)]) === before);
  t('08: each label resolves to its own values (one template, no copies)', (() => { const e = C.Store.state.project.elements.length; const v = i => D.resolveProps(E.get(ids.b), D.recordView(i, d)).value; return e === 4 && v(0) === 'AST-00001' && v(1) === 'AST-00002' && v(99) === 'AST-00100'; })());
  // selected-record generation
  d.records.forEach((x, i) => { x.selected = i % 10 === 0; });
  r = await gen(d, 'selected', null); t('08: selected-record generation', r.total === 10 && r.order.every(i => i % 10 === 0) && r.status[1] === 0);
  d.records[10].selected = true; d.records[10].excluded = true;
  r = await gen(d, 'selected', null); t('08: excluded beats selected', r.total === 9 && r.status[10] === 0);
  d.records[10].excluded = false; d.records.forEach(x => { x.selected = true; });
  // barcode formats
  E.setProp(ids.b, 'format', 'EAN13'); r = await gen(d, 'all', null);
  t('08: invalid values for EAN13 fail with a validation message', r.counts.fail === 100 && /Cannot encode/.test(r.issues.get(0).join()));
  const d2 = D.fromAOA([['Asset_Number', 'Asset_Name', 'Location'], ['5901234123457', 'a', 'b'], ['4006381333931', 'c', 'd'], ['12', 'e', 'f']], {}); C.Store.state.data[d2.id] = d2; C.Store.state.app.activeDatasetId = d2.id;
  r = await gen(d2, 'all', null); t('08: valid EAN13 passes (check digit auto), bad length fails', r.status[0] !== G.FAIL && r.status[1] !== G.FAIL && r.status[2] === G.FAIL);
  E.setProp(ids.b, 'format', 'CODE128'); C.Store.state.app.activeDatasetId = d.id;
  // missing column
  E.setBinding(ids.b, 'value', '{{Nope}}'); r = await gen(d, 'all', null);
  t('08: missing mapped column reported once + every barcode fails, no throw', r.templateIssues.length === 1 && /Nope/.test(r.templateIssues[0]) && r.counts.fail === 100);
  E.setBinding(ids.b, 'value', '{{Asset_Number}}');
  { const dq = D.fromAOA([['Asset_Number', 'Asset_Name', 'Location'], ['x'.repeat(3000), 'a', 'b'], ['ok', 'c', 'd']], {}); C.Store.state.data[dq.id] = dq; r = await gen(dq, 'all', null);
    t('08: QR content over capacity fails without encoding every code', r.status[0] === G.FAIL && /too long/.test(r.issues.get(0).join()) && r.status[1] !== G.FAIL); }
  // signature = regenerate-when-source-changes
  const sig = () => G.signature(C.Store.state.project, d, 'all'), s0 = sig();
  D.setPreviewIndex(7); t('08: signature ignores the preview record', sig() === s0);
  d.records[3].excluded = true; t('08: signature changes when a record is excluded', sig() !== s0); d.records[3].excluded = false; t('08: ... and returns when restored', sig() === s0);
  E.setBinding(ids.t, 'text', '{{Location}}'); t('08: signature changes when the template changes', sig() !== s0); E.setBinding(ids.t, 'text', '{{Asset_Name}} / {{Location}}');
  t('08: signature changes with scope', G.signature(C.Store.state.project, d, 'selected') !== s0);
  // search
  t('08: search by asset number', d.records.filter(x => G.matches(d, x, 'ast-00042')).length === 1 && d.records.filter(x => G.matches(d, x, 'AST-0001')).length === 10 && G.matches(d, d.records[0], '') && G.primaryColumn(d).header === 'Asset_Number');
  // big dataset + cancellation + yielding
  ({ d, ids } = setup(30000)); let slices = 0; const t0 = Date.now(); r = await gen(d, 'all', () => slices++); const ms = Date.now() - t0;
  t('08: 30,000 records validated (' + ms + ' ms, ' + slices + ' slices, ' + (ms / 30000).toFixed(3) + ' ms/record)', r.counts.done === 30000 && slices > 1 && r.counts.fail === 1 && ms < 8000);
  t('08: memory is per-record bytes, not label copies', r.status.length === 30000 && r.status.BYTES_PER_ELEMENT === 1 && r.issues.size < 30000);
  const job = G.run(C.Store.state.project, d, 'all', n => { if (n >= 1) job.cancel(); }); r = await job.promise;
  t('08: cancel stops early and reports it', r.cancelled === true && r.counts.done < 30000);
  C.Store.state.app.activeDatasetId = null; t('08: no dataset -> empty scope, no throw', G.scope(null, 'all').length === 0 && G.signature(C.Store.state.project, null, 'all') === 'none');
};

stage08().catch(e => { fails++; console.log('FAIL stage08 threw', e); }).then(() => { console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0); });
// fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
