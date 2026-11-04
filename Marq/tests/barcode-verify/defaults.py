import os; URL='file://'+os.path.abspath(os.path.join(os.path.dirname(__file__),'../../index.html'))
import base64, json, cv2, numpy as np
import os
from playwright.sync_api import sync_playwright
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"decode.py")).read().split("bd=cv2.barcode")[0])  # reuse decoders
import os; CH=os.environ.get('CHROME_PATH')
with sync_playwright() as p:
    b=p.chromium.launch(**({'executable_path':CH} if CH else {})); pg=b.new_page(viewport={'width':1500,'height':900}); pg.goto(URL); pg.wait_for_timeout(400)
    out=pg.evaluate("""()=>{ const res=[]; MARQ.Store.commit('x',s=>{s.project.label.width=100;s.project.label.height=60;s.project.elements=[];});
      for (const kind of ['code128','code39','ean13','ean8','itf14','qr']) {
        MARQ.Store.commit('x',s=>{s.project.elements=[];}); MARQ.Elements.add(kind); const e=MARQ.Elements.selected();
        const P=MARQ.Store.state.project, k=20, c=document.createElement('canvas'); c.width=100*k; c.height=60*k; const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height);
        MARQ.Renderer.draw(x,P,{},k,{}); res.push({kind,v:e.props.value,w:e.w,h:e.h,px:e.x*k,py:e.y*k,png:c.toDataURL()}); }
      return res; }""")
    b.close()
bd=cv2.barcode.BarcodeDetector(); qd=cv2.QRCodeDetector(); bad=0
for o in out:
    open('d_%s.png'%o['kind'],'wb').write(base64.b64decode(o['png'].split(',')[1])); img=cv2.imread('d_%s.png'%o['kind']); got=None
    try:
        if o['kind']=='qr': got,_,_=qd.detectAndDecode(img)
        elif o['kind']=='ean13' or o['kind']=='ean8':
            for sc in (0.35,0.3,0.4,0.5,0.25):
                r=bd.detectAndDecodeWithType(cv2.resize(img,None,fx=sc,fy=sc,interpolation=cv2.INTER_AREA))
                if r[0] and len(r[1]): got=r[1][0]; break
        else:
            g=cv2.cvtColor(img,cv2.COLOR_BGR2GRAY); y=int(o['py']+o['h']*20*0.35); 
            row=g[y]<128; rr=[];cur=row[0];n=0
            for v in row:
                if v==cur:n+=1
                else:rr.append((cur,n));cur=v;n=1
            rr.append((cur,n)); 
            while rr and not rr[0][0]: rr.pop(0)
            while rr and not rr[-1][0]: rr.pop()
            rr=[n for _,n in rr]; got={'code128':dec128,'code39':dec39,'itf14':decitf}[o['kind']](rr)
    except Exception as e: got='EXC %r'%e
    ok=got==o['v']; bad+=not ok; print('PASS' if ok else 'FAIL',o['kind'],'%gx%g mm'%(o['w'],o['h']),o['v'],'->',got)
print('failures',bad)
