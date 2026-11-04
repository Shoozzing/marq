(function (MARQ) {
  'use strict';
  // QR adapter backed by the built-in MARQ.QrEncoder (no vendor library needed).
  const adapter = {
    id: 'native-qr',
    kind: '2d',
    label: 'QR Code',
    formats: [{ id: 'QR', label: 'QR Code' }],
    isAvailable: () => !!MARQ.QrEncoder,
    validate(format, value) {
      if (format !== 'QR') return 'Unsupported QR format: ' + format;
      const text = String(value == null ? '' : value);
      if (!text.trim()) return 'Enter text or a URL for the QR code.';
      if (text.length > 5000) return 'QR contents are limited to 5000 characters.';
      return null;
    },
    matrix(format, value, options) { return MARQ.QrEncoder.create(String(value), (options && options.ecLevel) || 'M'); },
    render(format, value, options) {
      options = options || {};
      const q = MARQ.QrEncoder.create(String(value), options.ecLevel || 'M');
      const px = Math.max(2, Number(options.pixelsPerModule) || 4), margin = Math.max(0, Number(options.margin) || 0);
      const canvas = document.createElement('canvas'), size = (q.size + margin * 2) * px;
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d'); if (!ctx) return { error: 'Canvas rendering is unavailable in this browser.' };
      ctx.fillStyle = options.background || '#ffffff'; ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = options.color || '#000000';
      for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.isDark(y, x)) ctx.fillRect((x + margin) * px, (y + margin) * px, px, px);
      return { canvas };
    }
  };
  MARQ.Barcodes.register(adapter);
})(window.MARQ = window.MARQ || {});
