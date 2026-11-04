# MARQ — Architecture (Stage 03)

**Constraints:** plain scripts (no ES modules: they are blocked on `file://`), one global namespace `window.MARQ`, no build step. Each file = one IIFE that attaches to `MARQ`. Load order in index.html = dependency order.

## Layers & communication
UI (Shell, CanvasView) → **Store.commit()** → mutates `state` → emits on **Bus** (`state:changed`, `project:changed`, `app:changed`, `data:changed`) → subscribers (UI refresh, CanvasView redraw, Storage autosave).
Modules never call each other's UI; they only read `MARQ.Store.state` and emit/listen on `MARQ.Bus`.

| Module | Responsibility | Depends on |
|---|---|---|
| core/EventBus | pub/sub | – |
| core/Units | mm/cm/in/px conversion, parse/format | – |
| core/Store | state, commit scopes, undo/redo (project only) | Bus |
| elements/ElementSpec | element rules: per-type property schema, validation, repair of loaded files, rotated-box hit/corner maths (pure, no DOM) | – |
| elements/Elements | the only code that mutates `project.elements`: add/edit/delete/duplicate/reorder, aspect lock, auto text height, selection, image upload | Store, Model, ElementSpec, TextLayout |
| render/TextLayout | text measuring, word wrap, letter spacing, line height, drawing (shared by drawer and auto-height) | ElementSpec |
| render/ImageCache | decoded `<img>` per asset id, async-safe for the sync renderer | Bus |
| render/ElementDrawers | drawers for text, rect, ellipse, line, image (registered into Renderer) | Renderer, TextLayout, ImageCache |
| ui/ElementPanel | right-sidebar editor for the selected element + Layers list | Elements, ElementSpec |
| canvas/LabelSpec | label rules: presets, orientation, size/margin/border validation, repair of old files (pure, no DOM) | – |
| model/Model | project + element schema, factory, migrations | – |
| canvas/Viewport | mm⇄screen math, zoom/fit, pixel-snapped origin | – |
| canvas/Rulers | unit-aware rulers: tick maths, label extent, margin markers, cursor indicator | Units, Viewport |
| render/LabelRenderer | shared draw pipeline (editor + print); per-type drawers registered | Data |
| barcode/* | registry + adapters → bitmap canvas | libs |
| data/DataModel | dataset model, `{{Column}}` templates | Model |
| print/PrintPlanner | sheet grid math, pagination | – |
| storage/ProjectStorage | localStorage, autosave, .marq.json import/export | Model, Store |
| canvas/CanvasView, ui/Shell | editor canvas (grid, margin guides, fit), toolbar/panels/status | all above |

## State
`{ app, project, data }` — `app` transient UI (unit, view, grid, selection, tool); `project` persisted + undoable; `data` runtime datasets (not undoable, persisted separately).

## Data model
Project: `{schema, id, meta, label{width,height,...}, page{size,orientation,margin,gap,columns,rows}, elements[], dataBinding{datasetId,previewIndex}}`.
Element: `{id,type,name,x,y,w,h,rotation,locked,visible,opacity,props{},bindings{prop:'{{Col}}'}}`. Types: text, rect, ellipse, line, image, barcode, qr. Z-order = array order. New element types = add defaults in Model + register a drawer; no other change.

## Coordinates & units
Stored in **mm**, origin label top-left, +y down, rotation° clockwise about centre. Screen = `pan + mm × (96/25.4) × zoom`. Display/input in mm|cm|in|px via `Units`; px = CSS px @96 dpi. Print rasterises at 300–600 dpi via `Units.mmToPx(mm, dpi)`.

## Excel
SheetJS (later `ExcelImporter`) → array-of-arrays → `Data.fromAOA` → `{id,fileName,sheetName,columns[{key,header,index}],rows[{key:string}],rowCount}`. Duplicate/blank headers made unique; blank rows dropped. Elements bind via `{{Column}}`; `resolveProps` yields per-record props without mutating the model.

## Barcodes
No vendor libraries. `barcode/LinearEncoder.js` (Code 128 auto A/B/C-switching, Code 39, EAN-13, EAN-8, ITF-14 -> bar/space module widths) and `barcode/QrEncoder.js` (QR, UTF-8 byte mode, v1-40, L/M/Q/H, auto mask) are pure functions. `JsBarcodeAdapter.js` / `QrAdapter.js` wrap them for `MARQ.Barcodes` (`validate`, `encode`, `matrix`, bitmap `render`). `render/BarcodeDrawers.js` draws both element types as vectors in mm (shared by editor and print), with mandatory quiet zones and an on-canvas error box for invalid values. Adding DataMatrix/PDF417 = new encoder + adapter only.

## Printing
`PrintPlanner.layout` → grid cells; `paginate` → record indices per sheet. Print stage builds `#print-root` sheets sized in mm with `@page`, renders each label with `MARQ.Renderer` into a hi-dpi canvas → `<img>`, then `window.print()`.

**Print setup (Stage 09)** — `print/PrintConfig.js` is the dialog (paper, label, margins, layout, print options + a canvas preview drawn by the same `MARQ.Renderer`); `print/PrintPlanner.js` is the pure mm math. Everything is stored in millimetres on `project.page` / `project.label`; the dialog shows up to 4 decimals in the chosen display unit. Fit decisions use a small tolerance (`EPS_*`) so labels that exactly fill a row (3 × 2.5 in on Letter) are never dropped by float error. In `thermal` mode the sheet is *derived* from the scaled label + margins, so it can never go stale. Verified by `tests/browser-test-print-layout.js` (independent 0.1 µm integer model compared against both planner output and drawn pixels).

## Storage
localStorage `marq.project.<id>` + `marq.index` + `marq.last` (autosave 600 ms after any project change). Portable `.marq.json` export/import with `schema` versioning (`Model.migrate`). Large datasets → IndexedDB (Excel stage).

## Canvas engine (Stage 02)
**Label** (`project.label`, all mm): `{width,height,preset,orientation,background,borderWidth,borderColor,margin{top,right,bottom,left}}`. `width/height` are the real, already-oriented size; `orientation` is derived (portrait ⇔ height > width; a square keeps its flag). `preset` is `'custom'` or one of `50x30, 60x40, 70x50, 100x50, A4`; a non-custom preset always equals the current size in either orientation. Presets keep the current orientation. Every change goes through `LabelSpec.setSize/setPreset/setOrientation/setMargin` inside `Store.commit`, so it is undoable and autosaved. `Model.migrate` runs `LabelSpec.normalize`, so Stage 01 files open (schema stays 1: only optional fields were added).
**Limits:** size 1–2000 mm (stored to 0.1 µm so unit round-trips stay clean); margins ≥ 0 and leave ≥ 1 mm drawable; border ≤ half the short side. Shrinking the label re-fits margins/border.
**Physical size:** screen px = mm × 96/25.4 × zoom (CSS px; 100% = true size only to the extent the display reports a true CSS-px density). Only the *origin* is rounded to whole px (`Viewport.snap`, shared by canvas and rulers) – sizes are never rounded. Hi-dpi: backing store = CSS size × devicePixelRatio.
**View:** `app.view = {zoom,panX,panY,fitted}`. `fitted` views refit on window/panel resize and on label-size change; a zoomed view keeps its zoom and label centre instead. Zoom 5 %–3200 %. Shortcuts: Ctrl +/−, Ctrl 0 (fit), Ctrl 1 (100 %), Ctrl+wheel (zoom at cursor), wheel (pan).
**Grid** (`app.grid.size` mm): thinned ×2/×5/×10… when dense (<8 px), only the visible part is stroked, colour adapts to the label background. **Margin guide** is editor-only (CanvasView), never in `Renderer`, so it cannot reach print.
**Rulers** (`app.rulers`): drawn in the display unit, 0 = label top-left, 1/2/5×10ⁿ steps ≥ 56 px apart, label extent shaded, margin markers, live cursor tag. CanvasView emits `cursor:moved {x,y}|null` (mm); Rulers and the status bar listen – it is not state, so it never touches undo or autosave.
**Tests:** `node tests/run-tests.js` (logic) and `NODE_PATH=$(npm root -g) node tests/browser-test.js` (real page; sizes are measured from canvas pixels at 100 % in mm/in/px/cm, also at dpr 2).

## Design tools (Stage 03)
**Elements** are plain objects in `project.elements` (see Data model); every user-visible property is state, nothing lives only in the DOM. Props per type (units: mm, text sizes pt):
| type | props |
|---|---|
| text | `text, fontFamily, fontSize(pt), bold, italic, align(left/center/right), valign(top/middle/bottom), color, letterSpacing(pt), lineHeight(×), background('' = none), padding, autoHeight` |
| rect | `fill/stroke('' = none), strokeWidth, radius, lockAspect` — *Rounded rectangle* is a rect with radius > 0 |
| ellipse | `fill, stroke, strokeWidth, lockAspect` — *Circle* is an ellipse created with `w = h` and `lockAspect: true` |
| line | `stroke, strokeWidth, dash(solid/dashed/dotted), dashLength, dashGap, cap(butt/round)` — `h` is always 0, `w` is the length; *Dashed line* is a line with `dash: 'dashed'` |
| image | `assetId, fit(fill/contain/cover), lockAspect, naturalW, naturalH` |
Common: `x,y,w,h,rotation,opacity,locked,visible,name`. Rotation is stored in [0,360) clockwise about the centre. Opacity 0–1 (shown as %).
**Assets:** image bytes live in `project.assets[id] = {name,mime,dataUrl,w,h}`, never in elements. Assets are immutable and identical uploads are de-duplicated. Undo snapshots share `assets` by reference (no megabyte clones per step); `Model.serializable` writes only assets still in use (save, autosave, export). Rasters over 2400 px or 1.5 MB are downscaled on upload; SVG is kept as is. Types: PNG, JPG, GIF, WebP, BMP, SVG, max 15 MB.
**Editing rules:** `Elements.setGeometry/setProp/setRotation/setOpacity/setMeta` validate through `ElementSpec` and return `null` or `{error}` (nothing changes on error; the sidebar explains it and restores the field). Locked elements refuse everything except name/lock/visibility. With `lockAspect`, changing only width or only height moves the other so the current ratio holds; both given = lock ignored. Text with `autoHeight` always has the height of its wrapped content (re-fitted on any text/font/width change); height is derived, not editable. Typing/dragging in one field is coalesced into one undo step (`Store.commit(..., mergeKey)`, 1.2 s window).
**Rendering:** one pipeline for editor and print. Shapes are stroked *inside* the box (the box is the outer edge, like the label border). Text is measured and drawn at a 100 px reference size and scaled, so layout is identical at every zoom and in print; letter spacing draws glyph by glyph (no kerning when non-zero). Image drawer shows a placeholder for missing assets and repaints on `images:loaded`; `Images.ready(project)` is the promise the print stage must await.
**Selection** is `app.selection` (not undoable, pruned when an element disappears). Click on canvas picks the topmost visible *unlocked* element by its rotated box (lines get a ~5 px reach); empty space deselects. The outline/corner marks are drawn only by `CanvasView`, never by `Renderer`. Keys: Delete, Esc, Ctrl+D. Layers list: select, show/hide, lock, reorder, delete.
**Not in this stage:** drag/resize/rotate handles on the canvas, multi-select, barcode/QR elements, `{{Column}}` bindings (the `bindings` field exists and `resolveProps` already honours it), Excel.
**Tests:** `node tests/run-tests.js` (logic incl. ElementSpec, TextLayout with an injected measurer, Elements) and `NODE_PATH=$(npm root -g) node tests/browser-test-elements.js` (needs playwright + sharp; drives the real UI and checks rendered pixels for every tool).

## Dynamic data mapping (Stage 07A)
**Binding model:** `element.bindings[prop] = '{{Column}}…'` (already in the schema; no migration). Bindable: text → `text` (template mixing static words and several placeholders), barcode/QR → `value`. A string value, even `''`, means *dynamic*; no key means *static*. Static props are never overwritten, so switching back restores the original content. `Model.normalize` drops non-string bindings on load; old files without bindings are unchanged.
**Resolution (`data/DataModel.js`):** placeholders match a column **header** (exact → case/space-insensitive → internal key), so a mapping survives re-importing the same sheet. `previewRecord()` = `records[app.previewIndex]` (clamped), decorated with a header map; `Renderer.draw(…, record)` → `resolveProps(el, record)` is unchanged. Unknown column / no record: text keeps the visible `{{placeholder}}`; a bound barcode gets `props._bindingIssue` and the existing on-canvas error box. Empty cell → `''`. `diagnose(el)` feeds the panel's preview + warnings; `Data.setPreviewIndex(i)` is the only record-switching API.
**Editing:** `Elements.setDynamic / setBinding` (validated, locked-aware, undoable; typing coalesces, mode/column picks are separate undo steps). Dynamic text auto-height is sized from its template, so the box never changes with the record. A bound barcode's static value/format check is skipped (the spreadsheet value is validated per record). **Panel:** `Data source` section (Static/Dynamic, column dropdown, preview + warnings); dynamic text adds a template box and an "insert column" dropdown. The panel rebuilds when the mode or the loaded spreadsheet changes.
**Limits:** imported datasets are runtime-only (not persisted), so after reopening a project mappings stay but values appear after re-importing. Duplicate headers resolve to the first column.
**Tests:** `node tests/run-tests.js` (30 `07A:` checks) and `NODE_PATH=$(npm root -g) node tests/browser-test-stage07a.js` (real UI flow; uses a CSV-backed XLSX stand-in only when `vendor/xlsx.full.min.js` is absent).

## Live preview & record navigation (Stage 07B)
**State:** the previewed record is `app.previewIndex` (transient, like selection/zoom) - NOT in `project`. Switching records is a `'app'`-scope commit: no undo step, no `modified` stamp, no autosave, template and dataset rows are never touched. `project.dataBinding.previewIndex` is no longer read. Reset to 0 on every import.
**API (`MARQ.Data`):** `setPreviewIndex(i)` (clamps to 0..n-1, ignores NaN/junk, emits nothing when unchanged, returns the effective index), `stepPreview(±1)`, `previewIndex()`, `recordCount()`. Shrinking/removing the dataset clamps automatically.
**UI:** `#rec-nav` in the canvas dock (`◀  Record [n] of N  ▶`), hidden until a dataset with records exists. The number box is the direct-selection control (Enter/blur applies, Esc cancels, out-of-range clamps, empty/invalid keeps the current record). Alt+←/→ steps (not while typing or in a dialog). `Shell.syncRecordNav` writes the DOM only when a value changed.
**Update path:** `app:changed` -> `state:changed` -> CanvasView repaints (one rAF) through the unchanged `Renderer.draw(..., previewRecord())`; the properties panel only refreshes its preview/warning text (no rebuild). `previewRecord()` is memoised per record, so repainting for pan/zoom does no extra work.
**Missing data:** unchanged 07A rules (empty cell -> '' text / flagged barcode; unknown column -> visible `{{x}}` in text, error box for barcodes; invalid value -> encoder error box + panel warning). Nothing can throw into the editor (`CanvasView.currentRecord` also guards).
**Tests:** `node tests/run-tests.js` (19 `07B:` checks incl. 2000 switches) and `NODE_PATH=$(npm root -g) node tests/browser-test-stage07b.js` (real UI, 300 records, pixel comparisons).

## Bulk label generator (Stage 08)
**Idea:** one template, N records, no duplicated elements. A "generated label" = the template resolved against one record through the unchanged `Renderer.draw(…, Data.recordView(i))`. The bulk pass only *validates* every in-scope record; pixels are drawn on demand for the label being previewed, so thousands of records cost one byte each (`Uint8Array` status + a sparse `Map` of issue texts).
**Module:** `generate/Generator.js` = engine (pure, node-tested) + the "Generate Labels" dialog (shared `#modal`, class `gen-wide`). Button `#btn-generate`. `Data.recordView(index, ds)` (new, in DataModel) is the decorated read-only record used by preview, validation and drawing; header lookup tables are cached per column list.
**Scope:** `Selected records` = ticked and not excluded; `All records` = everything not excluded. Excluded records are never generated. Tick/Skip checkboxes and the shown-rows buttons (Use all / Clear / Skip / Unskip) edit the same `record.selected/excluded` flags as the Data Preview dialog (`'data'` scope, no undo).
**Validation (`inspect`)** per record, per visible bound element: text -> *warning* for an empty cell or unknown column; barcode -> *fail* for no column, unknown column, empty value or an encoder/validator error (linear codes are really encoded); QR -> *fail* for empty/over-long content (validate + exact v40 byte capacity; the matrix itself is built only when drawn, ~1 ms each, which would dominate a bulk run). After the run, barcode/QR values shared by several records give a *warning* on each (kept, never dropped). Mapped columns missing from the sheet are reported once (`templateIssues`), not per record.
**Run:** `run()` is time-sliced (12 ms slices via `setTimeout`), reports progress between slices, is cancellable, and never throws. Results: total, completed (= ok + warnings), warnings, failed, duration.
**Regeneration:** `signature()` hashes dataset id, columns, every record's selected/excluded flag, scope and the template (elements + label). While the dialog is open, `data:changed` / `project:changed` compare signatures (150 ms debounce) and restart the run; reopening after a change regenerates too. The preview record index is deliberately not part of it.
**Preview/navigation:** `Label n of M` + ◀ ▶ + direct number entry, over the generated labels that match the search/filter; clicking a row previews it. Search matches any column (asset number included, case-insensitive). Filter: all / generated / warnings / failed. The list is paged (100 rows) and the filtered lists are cached, so navigation does not re-filter thousands of records. A different spreadsheet resets position, search and filter.
**Perf note:** `dialog.gen-wide::backdrop` has the blur removed: `backdrop-filter` re-rasterised the page behind the dialog on every repaint (~40 ms/frame while stepping through labels); without it a navigation is one frame.
**Not in this stage:** bulk printing/export (labels are previewed, not output), persistence of results.
**Tests:** `node tests/run-tests.js` (25 `08:` checks incl. 30,000 records) and `NODE_PATH=$(npm root -g) node tests/browser-test-stage08.js` (real UI, 400- and 5000-record imports).
