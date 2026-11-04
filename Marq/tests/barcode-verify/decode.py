import json, numpy as np, cv2
from reportlab.graphics.barcode import code128 as c128, code39 as c39
cases=json.load(open('cases.json'))
M={'a':1,'b':2,'c':3,'d':4}
P128={''.join(str(M[ch.lower()]) for ch in c128._patterns[i]):i for i in range(106)}
P39={ ''.join('w' if ch.isupper() else 'n' for ch in v[0]):k for k,v in c39._patterns.items()}
ITF={'nnwwn':0,'wnnnw':1,'nwnnw':2,'wwnnn':3,'nnwnw':4,'wnwnn':5,'nwwnn':6,'nnnww':7,'wnnwn':8,'nwnwn':9}
def runs(img,yfrac):
    g=cv2.cvtColor(img,cv2.COLOR_BGR2GRAY); y=int(g.shape[0]*yfrac); row=g[y]<128
    r=[];cur=row[0];n=0
    for v in row:
        if v==cur:n+=1
        else:r.append((cur,n));cur=v;n=1
    r.append((cur,n))
    while r and not r[0][0]: r.pop(0)   # drop leading quiet zone (white)
    while r and not r[-1][0]: r.pop()
    return [n for _,n in r]
def dec128(rs):
    mod=sum(rs[:6])/11; w=[max(1,round(x/mod)) for x in rs]
    syms=[''.join(map(str,w[i:i+6])) for i in range(0,len(w)-7,6)]; stop=w[-7:]
    assert stop==[2,3,3,1,1,1,2], stop
    vals=[P128[s] for s in syms]; start=vals[0]; mode={103:'A',104:'B',105:'C'}[start]
    chk=(start+sum(v*i for i,v in enumerate(vals[1:-1],1)))%103; assert chk==vals[-1],'checksum'
    out=''
    for v in vals[1:-1]:
        if mode=='C':
            if v==100: mode='B'
            elif v==101: mode='A'
            else: out+='%02d'%v
        else:
            if v==99: mode='C'
            elif v==100 and mode=='A': mode='B'
            elif v==100: pass
            else: out+=chr(v+32)
    return out
def dec39(rs):
    n=[min(rs)]; th=(min(rs)+max(rs))/2; cls=['w' if x>th else 'n' for x in rs]; out=''
    i=0
    while i+9<=len(cls):
        out+=P39[''.join(cls[i:i+9])]; i+=10
    assert out[0]=='*' and out[-1]=='*'; return out[1:-1]
def decitf(rs):
    th=(min(rs)+max(rs))/2; cls=['w' if x>th else 'n' for x in rs]
    assert cls[:4]==['n']*4; body=cls[4:-3]; assert cls[-3:]==['w','n','n']
    out=''
    for i in range(0,len(body),10):
        g=body[i:i+10]; out+=str(ITF[''.join(g[0::2])])+str(ITF[''.join(g[1::2])])
    return out
bd=cv2.barcode.BarcodeDetector() if hasattr(cv2,'barcode') else None
qd=cv2.QRCodeDetector(); fails=0
for c in cases:
    img=cv2.imread(c['file']); ok=False; got=None; how=''
    try:
        if c['kind']=='barcode':
            f=c['f']; v=c['v']
            r=runs(img,0.4)  # bars region only (text lower)
            if f=='CODE128': got=dec128(r); how='own decoder (reportlab table)'
            elif f=='CODE39': got=dec39(r); how='own decoder (reportlab table)'
            elif f=='ITF14': got=decitf(r); how='own decoder (ITF table)'
            else:
                got=None
                for sc in (0.35,0.3,0.4,0.5,0.25):
                    res=bd.detectAndDecodeWithType(cv2.resize(img,None,fx=sc,fy=sc,interpolation=cv2.INTER_AREA))
                    if res[0] and len(res[1]): got=res[1][0]; break
                how='OpenCV BarcodeDetector'
            ok = got==v or (f=='CODE39' and got==v.upper())
        elif c['kind']=='qr':
            got,_,_=qd.detectAndDecode(img); ok=got==c['v']; how='OpenCV QRCodeDetector'
        else:
            # error placeholder: red-ish pixels present, no black bars
            red=((img[:,:,2]>150)&(img[:,:,1]<80)).sum(); ok=red>200; got='placeholder, red px=%d'%red; how='pixel check'
    except Exception as e: got='EXC %r'%e
    fails+= (not ok)
    print('PASS' if ok else 'FAIL', c['kind'], c['f'], repr(c['v'][:30]), '->', repr(got)[:50], '['+how+']')
print('failures:',fails)
