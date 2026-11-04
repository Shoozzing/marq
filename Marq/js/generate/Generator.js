(function (MARQ) {
  'use strict';
  // Stage 08 - bulk label generator. ONE template, N records: nothing is duplicated. A "generated label" is the template resolved against one
  // record through the existing Renderer + dynamic-mapping engine. The bulk pass only VALIDATES every record (cheap, time-sliced, cancellable);
  // pixels are drawn on demand for the label being previewed, so thousands of records cost almost nothing to hold.
  // Engine = pure (no DOM, unit-tested in node). UI = the "Generate Labels" dialog (reuses the shared #modal).
  const OK = 1, WARN = 2, FAIL = 3, SLICE_MS = 12, PAGE = 100;
  const QR_BYTES = { L: 2953, M: 2331, Q: 1663, H: 1273 }; // QR version 40, byte mode: the only failure QrEncoder can add to Barcodes.validate()
  const D = () => MARQ.Data, S = () => MARQ.Store.state;
  const bound = project => project.elements.filter(el => el.visible && D().BOUND[el.type] && el.bindings && typeof el.bindings[D().BOUND[el.type]] === 'string');
  const hash = str => { let h = 5381; for (let i = 0; i < str.length; i++) h = (h * 33 + str.charCodeAt(i)) | 0; return h; };

  /* ---------------- engine ---------------- */
  // Record indices to generate. 'selected' = ticked and not excluded; 'all' = every record that is not excluded. Excluded records are never generated.
  function scope(ds, mode) {
    const out = []; if (!ds) return out;
    for (let i = 0; i < ds.records.length; i++) { const r = ds.records[i]; if (!r.excluded && (mode === 'all' || r.selected)) out.push(i); }
    return out;
  }
  // Changes whenever anything a generated label depends on changes: dataset, record flags, scope, or the template itself.
  function signature(project, ds, mode) {
    if (!ds) return 'none';
    let h = 7; for (let i = 0; i < ds.records.length; i++) { const r = ds.records[i]; h = (h * 31 + (r.selected ? 1 : 0) + (r.excluded ? 2 : 0)) | 0; }
    return [ds.id, ds.records.length, ds.columns.map(c => c.header).join('\u0001'), mode, h, hash(JSON.stringify([project.elements, project.label]))].join('|');
  }
  // Problems that hit EVERY record (a mapped column that is not in the spreadsheet), reported once instead of N times.
  function templateIssues(project, ds) {
    const out = [], headers = new Set(ds.columns.map(c => String(c.header).trim().toLocaleLowerCase()));
    bound(project).forEach(el => D().tokens(el.bindings[D().BOUND[el.type]]).forEach(name => { if (!headers.has(name.trim().toLocaleLowerCase())) out.push('“' + el.name + '” uses column “' + name + '”, which is not in the spreadsheet.'); }));
    return out;
  }
  // -> { status: OK|WARN|FAIL, issues[], keys[] } for one record. Never throws.
  function inspect(project, ds, index, els) {
    const issues = [], keys = []; let status = OK; const bump = s => { if (s > status) status = s; };
    try {
      const view = D().recordView(index, ds);
      (els || bound(project)).forEach(el => {
        const prop = D().BOUND[el.type], res = D().resolveTemplate(el.bindings[prop], view, { blank: el.type !== 'text' });
        if (el.type === 'text') {
          res.missing.forEach(n => { issues.push('“' + el.name + '”: column “' + n + '” not found.'); bump(WARN); });
          res.empty.forEach(n => { issues.push('“' + el.name + '”: “' + n + '” is empty.'); bump(WARN); });
          return;
        }
        const p = D().resolveProps(el, view);
        let err = p._bindingIssue || '';
        if (!err) { // linear codes are encoded (cheap). QR is NOT encoded here (~1 ms each): validate() + the exact capacity limit are checked instead; the full matrix is built when the label is drawn.
          let msg = el.type === 'qr' ? MARQ.Barcodes.validate('QR', p.value) : (MARQ.Barcodes.encode(p.format, p.value) || {}).error;
          if (!msg && el.type === 'qr' && typeof TextEncoder !== 'undefined' && new TextEncoder().encode(String(p.value)).length > (QR_BYTES[p.ecLevel] || QR_BYTES.M)) msg = 'Content is too long for a QR code at this error-correction level.';
          if (msg) err = 'Cannot encode “' + p.value + '”: ' + msg; }
        if (err) { issues.push('“' + el.name + '”: ' + err); bump(FAIL); } else keys.push(el.id + '\u0000' + p.value);
      });
    } catch (e) { issues.push('Unexpected error: ' + (e && e.message || e)); status = FAIL; }
    return { status, issues, keys };
  }
  // Time-sliced validation of every in-scope record. -> { promise, cancel }. onProgress(done, total, partialCounts) is called between slices.
  function run(project, ds, mode, onProgress) {
    const order = scope(ds, mode), total = order.length, els = bound(project), res = {
      order, mode, total, signature: signature(project, ds, mode), status: new Uint8Array(ds ? ds.records.length : 0), issues: new Map(),
      counts: { ok: 0, warn: 0, fail: 0, done: 0 }, duplicates: 0, templateIssues: ds ? templateIssues(project, ds) : [], ms: 0, cancelled: false
    };
    let pos = 0, stop = false, timer = 0; const seen = new Map(), t0 = Date.now(), names = new Map(els.map(el => [el.id, el.name]));
    const promise = new Promise(resolve => {
      const finish = () => {
        // duplicate barcode/QR values across the generated set are legal but suspicious: flag every record involved (once per record), naming the element
        const flagged = new Set();
        seen.forEach((list, k) => { if (list.length < 2) return; const name = (names.get(k.split('\u0000')[0]) || 'Barcode');
          list.forEach(i => { const other = ds.records[list[0] === i ? list[1] : list[0]].sourceRow; res.issues.set(i, (res.issues.get(i) || []).concat('“' + name + '”: value shared with ' + (list.length - 1) + ' other record' + (list.length > 2 ? 's' : '') + ' (e.g. row ' + other + ').'));
            flagged.add(i); if (res.status[i] === OK) { res.status[i] = WARN; res.counts.ok--; res.counts.warn++; } }); });
        res.duplicates = flagged.size;
        res.ms = Date.now() - t0; res.cancelled = stop; resolve(res);
      };
      const step = () => {
        if (stop) return finish();
        const until = Date.now() + SLICE_MS;
        while (pos < total && Date.now() < until) {
          const i = order[pos++], r = inspect(project, ds, i, els);
          res.status[i] = r.status; if (r.issues.length) res.issues.set(i, r.issues);
          res.counts[r.status === OK ? 'ok' : r.status === WARN ? 'warn' : 'fail']++; res.counts.done++;
          r.keys.forEach(k => { const l = seen.get(k); if (l) l.push(i); else seen.set(k, [i]); });
        }
        if (onProgress) try { onProgress(res.counts.done, total, res.counts); } catch (e) { /* UI problems must not stop generation */ }
        if (pos < total) timer = setTimeout(step, 0); else finish();
      };
      step();
    });
    return { promise, cancel() { stop = true; clearTimeout(timer); } , result: res };
  }
  // Search by asset number (or any value): case-insensitive substring over every column of the record.
  const matches = (ds, record, query) => { if (!query) return true; const q = query.toLocaleLowerCase(); return ds.columns.some(c => String(record.values[c.key] == null ? '' : record.values[c.key]).toLocaleLowerCase().includes(q)); };
  const primaryColumn = ds => ds.columns.find(c => /asset.*(no|num|id)|^(id|number|no)$/i.test(c.header)) || ds.columns[0];

  /* ---------------- UI ---------------- */
  const ui = { cache: null, mode: 'selected', search: '', filter: 'all', page: 0, cur: -1, job: null, res: null, timer: 0, raf: 0, open: false };
  const $ = id => document.getElementById(id);
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (label, fn, title) => { const b = mk('button', 'chip act', label); b.type = 'button'; if (title) b.title = title; b.onclick = fn; return b; };
  const dataset = () => D().active();
  const GLYPH = { 1: '✓', 2: '⚠', 3: '✕' }, WORD = { 1: 'Completed', 2: 'Completed with warnings', 3: 'Failed' };

  // rows of the record list (after search + status filter) and the navigable subset (generated ones). Cached: navigation must not re-filter thousands of records
  // on every click. The cache is dropped by anything that can change the lists (search, filter, regeneration, record flags) via paintAll().
  function lists(ds) {
    if (ui.cache && ui.cache.ds === ds && ui.cache.res === ui.res) return ui.cache;
    const r = ui.res, rows = [], nav = [];
    for (let i = 0; i < ds.records.length; i++) {
      if (!matches(ds, ds.records[i], ui.search)) continue;
      const st = r ? r.status[i] : 0;
      if (ui.filter === 'failed' && st !== FAIL) continue; if (ui.filter === 'warn' && st !== WARN) continue; if (ui.filter === 'generated' && !st) continue;
      rows.push(i); if (st) nav.push(i);
    }
    return (ui.cache = { ds, res: r, rows, nav });
  }
  const visible = ds => lists(ds).rows, navList = ds => lists(ds).nav;

  function commitRecords(label, mutate) {
    const ds = dataset(); if (!ds) return;
    MARQ.Store.commit(label, s => { mutate(s.data[ds.id]); D().recount(s.data[ds.id]); }, 'data');
  }
  function start() {
    const ds = dataset(); if (!ds || !ds.records.length) return;
    if (ui.job) ui.job.cancel();
    const job = run(S().project, ds, ui.mode, (done, total) => { if (ui.job === job) paintProgress(done, total); });
    ui.job = job; ui.res = job.result; paintProgress(0, job.result.total); paintAll();
    job.promise.then(res => { if (ui.job !== job) return; ui.job = null; paintProgress(res.counts.done, res.total, true); paintAll(); });
  }
  const stale = ds => !ui.res || ui.res.signature !== signature(S().project, ds, ui.mode);
  function onSource() { // selection / exclusion / import / template changed while the dialog is open -> regenerate (debounced)
    if (!ui.open) return; clearTimeout(ui.timer);
    ui.timer = setTimeout(() => { const ds = dataset(); if (ds && stale(ds)) start(); else paintAll(); }, 150);
  }

  function paintProgress(done, total, finished) {
    const bar = $('gen-bar'), txt = $('gen-prog'), sum = $('gen-sum'), r = ui.res; if (!bar) return;
    bar.max = Math.max(1, total); bar.value = done;
    const c = r ? r.counts : { ok: 0, warn: 0, fail: 0 };
    txt.textContent = finished || (r && !ui.job) ? (r && r.cancelled ? 'Cancelled at ' : 'Finished ') + done + ' of ' + total + (r ? ' · ' + r.ms + ' ms' : '') : 'Generating ' + done + ' of ' + total + '…';
    sum.textContent = ''; const stat = (label, value, cls) => { const s = mk('span', 'gen-stat' + (cls ? ' ' + cls : '')), n = mk('b', null, value); s.append(n, document.createTextNode(' ' + label)); sum.appendChild(s); };
    stat('total labels', total); stat('completed', c.ok + c.warn, 'ok'); if (c.warn) stat('with warnings', c.warn, 'warn'); stat('failed', c.fail, c.fail ? 'bad' : '');
    $('gen-cancel').hidden = !ui.job;
  }

  function paintAll() { const ds = dataset(); if (!ds || !$('gen-list')) return; ui.cache = null; paintNotes(ds); paintList(ds); paintPreview(); paintProgress(ui.res ? ui.res.counts.done : 0, ui.res ? ui.res.total : 0, !ui.job); }
  function paintNotes(ds) {
    const box = $('gen-notes'); box.textContent = '';
    const excluded = ds.records.filter(r => r.excluded).length, dyn = bound(S().project).length;
    box.appendChild(mk('div', 'note', ds.fileName + ' · ' + ds.sheetName + ' · ' + ds.records.length + ' records · ' + excluded + ' excluded · ' + dyn + ' dynamic element' + (dyn === 1 ? '' : 's') + ' in the template'));
    if (!dyn) box.appendChild(mk('div', 'hint warn', 'The template has no dynamic elements, so every label will look the same. Map text or barcode elements to columns first.'));
    (ui.res ? ui.res.templateIssues : []).forEach(t => box.appendChild(mk('div', 'hint warn', t)));
    if (ui.res && ui.res.duplicates) box.appendChild(mk('div', 'hint warn', ui.res.duplicates + ' labels share a barcode/QR value with another label (kept; look for ⚠ rows marked “value shared”).'));
  }

  function paintList(ds) {
    const host = $('gen-list'), keep = host.scrollTop, rows = visible(ds), pages = Math.max(1, Math.ceil(rows.length / PAGE));
    ui.page = Math.min(Math.max(0, ui.page), pages - 1);
    const col = primaryColumn(ds), shown = rows.slice(ui.page * PAGE, (ui.page + 1) * PAGE), t = mk('table', 'stage06-table gen-table'), thead = mk('thead'), hr = mk('tr');
    ['Use', 'Skip', '#', col.header, 'Result'].forEach(h => hr.appendChild(mk('th', null, h))); thead.appendChild(hr); t.appendChild(thead);
    const tb = mk('tbody');
    shown.forEach(i => {
      const r = ds.records[i], st = ui.res ? ui.res.status[i] : 0, tr = mk('tr', (i === ui.cur ? 'on ' : '') + (r.excluded ? 'stage06-excluded' : '')); tr.dataset.i = i;
      const cb = (checked, label, fn) => { const td = mk('td'), c = mk('input'); c.type = 'checkbox'; c.checked = checked; c.setAttribute('aria-label', label + ' record ' + (i + 1)); c.onchange = fn; c.onclick = e => e.stopPropagation(); td.appendChild(c); return td; };
      tr.append(cb(r.selected && !r.excluded, 'Generate', ev => commitRecords('select record', d => { const x = d.records[i]; x.selected = ev.target.checked; if (x.selected) x.excluded = false; })),
        cb(r.excluded, 'Exclude', ev => commitRecords('exclude record', d => { const x = d.records[i]; x.excluded = ev.target.checked; if (x.excluded) x.selected = false; })));
      tr.appendChild(mk('td', null, i + 1)); const a = mk('td', null, r.values[col.key] == null ? '' : String(r.values[col.key])); if (r.duplicate) a.title = 'Duplicate row retained from the source file'; tr.appendChild(a);
      const s = mk('td', 'gen-st st' + st, st ? GLYPH[st] : r.excluded ? 'skipped' : ''); if (st) s.title = WORD[st] + (ui.res.issues.has(i) ? ': ' + ui.res.issues.get(i).join(' ') : ''); tr.appendChild(s);
      tr.onclick = () => { if (st) { ui.cur = i; paintList(ds); paintPreview(); } };
      tb.appendChild(tr);
    });
    t.appendChild(tb); host.textContent = ''; host.appendChild(t); host.scrollTop = keep;
    const pg = $('gen-paging'); pg.textContent = '';
    const prev = btn('Previous', () => { ui.page--; paintList(ds); }), next = btn('Next', () => { ui.page++; paintList(ds); });
    prev.disabled = ui.page === 0; next.disabled = ui.page >= pages - 1;
    pg.append(prev, mk('span', null, rows.length + ' record' + (rows.length === 1 ? '' : 's') + ' · page ' + (ui.page + 1) + ' of ' + pages), next);
  }

  function paintPreview() {
    const ds = dataset(), cv = $('gen-canvas'); if (!ds || !cv) return;
    const nav = navList(ds), info = $('gen-info'), num = $('gen-num');
    let pos = nav.indexOf(ui.cur); if (pos < 0 && nav.length) { pos = 0; ui.cur = nav[0]; }
    $('gen-nav').hidden = !nav.length;
    if (!nav.length) { info.textContent = ui.job ? 'Generating…' : ui.res && ui.res.total ? 'No generated labels match the current search or filter.' : 'Nothing to generate. Tick records in the list or switch to “All records”.'; const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); cv.hidden = true; return; }
    cv.hidden = false; $('gen-count').textContent = nav.length; num.max = nav.length; if (document.activeElement !== num) num.value = pos + 1;
    $('gen-prev').disabled = pos <= 0; $('gen-next').disabled = pos >= nav.length - 1;
    cancelAnimationFrame(ui.raf); ui.raf = requestAnimationFrame(() => drawLabel(ds, ui.cur));
    const st = ui.res.status[ui.cur], issues = ui.res.issues.get(ui.cur) || [];
    info.textContent = ''; info.append(mk('div', 'gen-line st' + st, GLYPH[st] + ' ' + WORD[st] + ' · record ' + (ui.cur + 1) + ' · spreadsheet row ' + ds.records[ui.cur].sourceRow)); issues.forEach(m => info.appendChild(mk('div', 'hint warn', m)));
  }
  function drawLabel(ds, index) { // draws ONE label from the shared template; the template and the dataset are only read
    const cv = $('gen-canvas'); if (!cv || !ds.records[index]) return;
    const L = S().project.label, box = cv.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const k = Math.max(0.5, Math.min((box.width - 16) / L.width, (box.height - 16) / L.height)), w = Math.max(1, Math.round(L.width * k)), h = Math.max(1, Math.round(L.height * k));
    cv.style.width = w + 'px'; cv.style.height = h + 'px'; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    try { MARQ.Renderer.draw(g, S().project, D().recordView(index, ds), w / L.width, {}); }
    catch (e) { g.fillStyle = '#fff4f4'; g.fillRect(0, 0, w, h); g.fillStyle = '#b00'; g.font = '12px sans-serif'; g.fillText('Render error: ' + (e && e.message || e), 8, 20); if (ui.res && ui.res.status[index] !== FAIL) { ui.res.counts[ui.res.status[index] === WARN ? 'warn' : 'ok']--; ui.res.counts.fail++; ui.res.status[index] = FAIL; ui.res.issues.set(index, ['Render error: ' + (e && e.message || e)]); paintProgress(ui.res.counts.done, ui.res.total, true); } }
  }
  function go(delta) {
    const ds = dataset(), L = lists(ds), nav = L.nav, pos = nav.indexOf(ui.cur), next = nav[Math.min(Math.max(0, pos + delta), nav.length - 1)]; if (next === undefined) return;
    ui.cur = next; const page = Math.floor(L.rows.indexOf(next) / PAGE);
    if (page !== ui.page) { ui.page = page; paintList(ds); } else { const host = $('gen-list'); host.querySelectorAll('tr.on').forEach(r => r.classList.remove('on')); const row = host.querySelector('tr[data-i="' + next + '"]'); if (row) { row.classList.add('on'); row.scrollIntoView({ block: 'nearest' }); } }
    paintPreview();
  }
  function jump(n) { const ds = dataset(), nav = navList(ds); if (!nav.length) return; const v = Math.min(Math.max(1, Math.trunc(n) || 1), nav.length); go(nav.indexOf(nav[v - 1]) - nav.indexOf(ui.cur)); }

  function show() {
    const dialog = $('modal'), body = $('modal-body'), ds = dataset(); ui.open = true;
    if (ds && ds.id !== ui.dsId) { ui.dsId = ds.id; ui.cur = -1; ui.page = 0; ui.search = ''; ui.filter = 'all'; ui.res = null; ui.cache = null; } // a different spreadsheet starts from its first label
    $('modal-title').textContent = 'Generate Labels'; body.textContent = ''; dialog.classList.add('gen-wide');
    if (!ds || !ds.records.length) { body.appendChild(mk('div', 'empty', 'Import a spreadsheet (Import Excel), map your elements to its columns, then generate labels here.')); dialog.showModal(); return; }
    const top = mk('div', 'gen-top');
    const scopeSel = mk('select'); scopeSel.setAttribute('aria-label', 'Records to generate'); scopeSel.add(new Option('Selected records', 'selected')); scopeSel.add(new Option('All records (except excluded)', 'all')); scopeSel.value = ui.mode; scopeSel.onchange = () => { ui.mode = scopeSel.value; start(); };
    const search = mk('input'); search.type = 'search'; search.placeholder = 'Search asset number or any value…'; search.setAttribute('aria-label', 'Search records'); search.id = 'gen-search'; search.value = ui.search; search.oninput = () => { ui.search = search.value; ui.page = 0; paintAll(); };
    const filt = mk('select'); filt.setAttribute('aria-label', 'Filter by result'); [['all', 'All rows'], ['generated', 'Generated only'], ['warn', 'Warnings'], ['failed', 'Failed only']].forEach(([v, l]) => filt.add(new Option(l, v))); filt.value = ui.filter; filt.onchange = () => { ui.filter = filt.value; ui.page = 0; paintAll(); };
    const go1 = btn('Regenerate', start, 'Validate every record again'); go1.id = 'gen-run'; const cancel = btn('Cancel', () => { if (ui.job) ui.job.cancel(); }); cancel.id = 'gen-cancel'; cancel.hidden = true;
    top.append(scopeSel, search, filt, go1, cancel); body.appendChild(top);
    const bulk = mk('div', 'gen-top'); const shownAct = (label, fn, title) => btn(label, () => { const rows = visible(ds); commitRecords(label, d => rows.forEach(i => fn(d.records[i]))); }, title);
    bulk.append(mk('span', 'note', 'Shown rows:'), shownAct('Use all', r => { if (!r.excluded) r.selected = true; }, 'Tick every row that matches the search/filter'), shownAct('Clear', r => { r.selected = false; }), shownAct('Skip', r => { r.selected = false; r.excluded = true; }, 'Exclude every shown row'), shownAct('Unskip', r => { r.excluded = false; }));
    body.appendChild(bulk);
    const prog = mk('div', 'gen-progress'), bar = mk('progress'); bar.id = 'gen-bar'; bar.max = 1; bar.value = 0; const pt = mk('span', 'note', ''); pt.id = 'gen-prog'; prog.append(bar, pt); body.appendChild(prog);
    const sum = mk('div', 'gen-stats'); sum.id = 'gen-sum'; body.appendChild(sum); const notes = mk('div'); notes.id = 'gen-notes'; body.appendChild(notes);
    const grid = mk('div', 'gen-grid'), left = mk('div', 'gen-left'), list = mk('div', 'stage06-table-wrap gen-listwrap'); list.id = 'gen-list'; const pg = mk('div', 'stage06-paging'); pg.id = 'gen-paging'; left.append(list, pg);
    const right = mk('div', 'gen-right'), stage = mk('div', 'gen-stage'), cv = mk('canvas'); cv.id = 'gen-canvas'; stage.appendChild(cv);
    const nav = mk('div', 'recnav'); nav.id = 'gen-nav';
    const prev = mk('button', 'chip ico', '◀'); prev.id = 'gen-prev'; prev.type = 'button'; prev.setAttribute('aria-label', 'Previous label'); prev.onclick = () => go(-1);
    const next = mk('button', 'chip ico', '▶'); next.id = 'gen-next'; next.type = 'button'; next.setAttribute('aria-label', 'Next label'); next.onclick = () => go(1);
    const lab = mk('label', 'recnum'), num = mk('input'); num.id = 'gen-num'; num.type = 'number'; num.min = 1; num.setAttribute('aria-label', 'Current label number'); const total = mk('span', null, '0'); total.id = 'gen-count';
    num.onchange = () => jump(parseInt(num.value, 10)); num.onkeydown = e => { if (e.key === 'Enter') { jump(parseInt(num.value, 10)); num.blur(); } };
    lab.append(document.createTextNode('Label '), num, document.createTextNode(' of '), total); nav.append(prev, lab, next);
    const info = mk('div', 'gen-infobox'); info.id = 'gen-info'; right.append(stage, nav, info); grid.append(left, right); body.appendChild(grid);
    dialog.showModal(); if (ui.cur < 0 || !ds.records[ui.cur]) ui.cur = -1;
    if (stale(ds)) start(); else paintAll();
  }
  function init() {
    const b = $('btn-generate'); if (b) b.onclick = show;
    const dialog = $('modal'); if (dialog) dialog.addEventListener('close', () => { ui.open = false; clearTimeout(ui.timer); cancelAnimationFrame(ui.raf); if (ui.job) { ui.job.cancel(); ui.job = null; ui.res = null; } dialog.classList.remove('gen-wide'); });
    MARQ.Bus.on('data:changed', onSource); MARQ.Bus.on('project:changed', onSource); MARQ.Bus.on('images:loaded', () => { if (ui.open && ui.cur >= 0 && dataset()) paintPreview(); });
    window.addEventListener('resize', () => { if (ui.open && ui.cur >= 0 && dataset()) paintPreview(); });
  }
  MARQ.Generator = { scope, signature, inspect, run, matches, primaryColumn, templateIssues, init, show, ui, FAIL, WARN, OK };
})(window.MARQ = window.MARQ || {});
