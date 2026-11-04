# Barcode verification (independent decoders)
Needs: python3, playwright (+ a Chromium; set CHROME_PATH to use a specific binary), opencv-contrib-python, reportlab, numpy.
Run from this folder, in order:
1. `python3 ui.py`       drives the real editor (add/edit/validate/undo/reload) and renders fixtures to case_*.png + cases.json
2. `python3 decode.py`   decodes those PNGs: Code128/39/ITF with tables taken from reportlab, EAN and QR with OpenCV
3. `python3 defaults.py` renders and decodes the default-size elements created by the Add cards
Every line must say PASS.
