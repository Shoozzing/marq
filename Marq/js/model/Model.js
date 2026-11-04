(function (MARQ) {
  'use strict';
  const seq = { value: 0 };
  const uid = (prefix = 'id') => (prefix + '_' + Date.now().toString(36) + (seq.value++).toString(36) + Math.random().toString(36).slice(2, 5));
  const TYPES = ['text', 'rect', 'ellipse', 'line', 'image', 'barcode', 'qr'];
  const TYPE_DEFAULTS = {
    text: {
      w: 30,
      h: 5,
      props: {
        text: 'Text',
        fontFamily: 'Arial',
        fontSize: 10,
        bold: false,
        italic: false,
        align: 'left',
        valign: 'top',
        color: '#000000',
        letterSpacing: 0,
        lineHeight: 1.2,
        background: '',
        padding: 0,
        autoHeight: true
      }
    },
    rect: {
      w: 20,
      h: 10,
      props: {
        fill: '#ffffff',
        stroke: '#000000',
        strokeWidth: 0.3,
        radius: 0,
        lockAspect: false
      }
    },
    ellipse: {
      w: 20,
      h: 10,
      props: {
        fill: '#ffffff',
        stroke: '#000000',
        strokeWidth: 0.3,
        lockAspect: false
      }
    },
    line: {
      w: 20,
      h: 0,
      props: {
        stroke: '#000000',
        strokeWidth: 0.3,
        dash: 'solid',
        dashLength: 2,
        dashGap: 1.5,
        cap: 'butt'
      }
    },
    image: {
      w: 20,
      h: 20,
      props: {
        assetId: '',
        fit: 'fill',
        lockAspect: true,
        naturalW: 0,
        naturalH: 0
      }
    },
    barcode: {
      w: 48,
      h: 18,
      props: {
        format: 'CODE128',
        value: '123456',
        moduleWidth: 0.35,
        color: '#000000',
        background: '#ffffff',
        showText: true,
        textSize: 10,
        margin: 1
      }
    },
    qr: {
      w: 22,
      h: 22,
      props: {
        value: 'https://example.com',
        ecLevel: 'M',
        lockAspect: true,
        color: '#000000',
        background: '#ffffff',
        margin: 1
      }
    }
  };

  function createElement(type, over) {
    if (!TYPES.includes(type)) throw new Error('Unknown element type: ' + type);
    const defaultSpec = TYPE_DEFAULTS[type];
    const element = {
      id: uid('el'),
      type,
      name: type,
      x: 0,
      y: 0,
      w: defaultSpec.w,
      h: defaultSpec.h,
      rotation: 0,
      locked: false,
      visible: true,
      opacity: 1,
      props: Object.assign({}, defaultSpec.props),
      bindings: {}
    };
    if (over) {
      // Merge props onto the type defaults. (Assigning `over` wholesale used to replace the defaults with the partial props.)
      const { props, ...rest } = over;
      Object.assign(element, rest);
      if (props) Object.assign(element.props, props);
    }
    return element;
  }

  function createProject(name) {
    const now = new Date().toISOString();
    return {
      schema: 1,
      id: uid('prj'),
      meta: { name: name || 'Untitled Label', created: now, modified: now },
      label: {
        width: 100,
        height: 50,
        preset: '100x50',
        orientation: 'landscape',
        background: '#ffffff',
        cornerRadius: 0,
        borderWidth: 0,
        borderColor: '#000000',
        margin: { top: 0, right: 0, bottom: 0, left: 0 }
      },
      page: {
        size: 'A4',
        width: 210,
        height: 297,
        orientation: 'portrait',
        margin: { top: 10, right: 10, bottom: 10, left: 10 },
        gap: { x: 2, y: 2 },
        columns: 'auto',
        rows: 'auto',
        alignX: 'left',
        alignY: 'top',
        layout: 'sheet',
        scale: 1,
        copies: 1,
        scope: 'all',
        cropMarks: false
      },
      elements: [],
      assets: {},
      dataBinding: { datasetId: null, previewIndex: 0, rowFilter: null }
    };
  }

  function cleanBindings(b) { // saved mappings: { prop: '{{Column}}' template }; anything else is dropped
    const out = {};
    if (b && typeof b === 'object' && !Array.isArray(b)) for (const k in b) if (typeof b[k] === 'string') out[k] = b[k];
    return out;
  }

  function normalize(project) {
    if (!project || typeof project !== 'object') throw new Error('Invalid project file');
    const base = createProject(project && project.meta && project.meta.name ? project.meta.name : 'Untitled Label');
    const safe = Object.assign({}, base, project);
    safe.label = Object.assign({}, base.label, project.label || {});
    safe.label.margin = Object.assign({}, base.label.margin, (project.label && project.label.margin) || {});
    safe.page = Object.assign({}, base.page, project.page || {});
    safe.page.margin = Object.assign({}, base.page.margin, (project.page && project.page.margin) || {});
    safe.page.gap = Object.assign({}, base.page.gap, (project.page && project.page.gap) || {});
    if (MARQ.LabelSpec) MARQ.LabelSpec.normalize(safe.label);
    if (MARQ.PrintPlanner) MARQ.PrintPlanner.normalize(safe.page);
    safe.assets = project.assets && typeof project.assets === 'object' ? project.assets : {};
    safe.elements = Array.isArray(project.elements) ? project.elements.filter(Boolean).map(element => {
      if (!element || !TYPES.includes(element.type)) return null;
      const defaults = TYPE_DEFAULTS[element.type];
      const normalized = Object.assign({}, element, {
        id: element.id || uid('el'),
        type: element.type,
        name: element.name || element.type,
        x: Number(element.x) || 0,
        y: Number(element.y) || 0,
        w: Number(element.w) || defaults.w,
        h: Number(element.h) || defaults.h,
        rotation: Number(element.rotation) || 0,
        locked: !!element.locked,
        visible: element.visible !== false,
        opacity: Number(element.opacity) || 1,
        props: Object.assign({}, defaults.props, element.props || {}),
        bindings: cleanBindings(element.bindings)
      });
      return normalized;
    }).filter(Boolean) : [];
    return safe;
  }

  MARQ.Model = Object.assign(MARQ.Model || {}, {
    TYPES,
    TYPE_DEFAULTS,
    uid,
    createElement,
    createProject,
    normalize,
    migrate: normalize, // ProjectStorage loads/imports through Model.migrate
    serializable(project) {
      if (!project) return project;
      const used = new Set((project.elements || []).filter(el => el && el.props && el.props.assetId).map(el => el.props.assetId));
      const assets = {};
      used.forEach(id => {
        if (project.assets && project.assets[id]) assets[id] = project.assets[id];
      });
      return Object.assign({}, project, { assets });
    }
  });
})(window.MARQ = window.MARQ || {});
