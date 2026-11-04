(function (MARQ) {
  'use strict';
  MARQ.VERSION = '0.9.0-stage09';
  function boot() {
    let project = null;
    try { project = MARQ.Storage.loadLast(); } catch (error) { console.error(error); }
    MARQ.Store.init({
      app: { unit: 'mm', view: { zoom: 1, panX: 40, panY: 40, fitted: true }, grid: { show: true, size: 5, snap: true }, rulers: true, selection: [], tool: 'select', activeDatasetId: null, previewIndex: 0 },
      project: project || MARQ.Model.createProject(), data: {}
    });
    MARQ.Bus.on('project:changed', MARQ.Storage.scheduleAutosave);
    MARQ.Elements.init();
    MARQ.Shell.init();
    if (MARQ.Stage05) MARQ.Stage05.init();
    MARQ.Stage06.init();
    MARQ.Generator.init();
    MARQ.PrintConfig.init();
    MARQ.Rulers.init();
    MARQ.CanvasView.init();
  }
  document.addEventListener('DOMContentLoaded', boot);
})(window.MARQ = window.MARQ || {});
