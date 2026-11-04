import json, base64, sys
from playwright.sync_api import sync_playwright
import os; CH=os.environ.get('CHROME_PATH')
URL='file://'+os.path.abspath(os.path.join(os.path.dirname(__file__),'../../index.html'))
res={}; errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(**({'executable_path':CH} if CH else {})); pg=b.new_page(viewport={'width':1500,'height':900})
    pg.on('pageerror',lambda e:errs.append('PAGEERR '+str(e))); pg.on('console',lambda m: errs.append('CONSOLE '+m.text) if m.type=='error' else None)
    pg.goto(URL); pg.wait_for_timeout(500)
    res['libs_status']=pg.inner_text('#st-libs')
    pg.click('#rail button[title="Barcode"]') if pg.query_selector('#rail button[title="Barcode"]') else None
    pg.wait_for_timeout(200)
    res['flyout_text']=pg.inner_text('#fly-body')
    res['has_missing']= 'missing' in (res['flyout_text']+res['libs_status']).lower() or 'unavailable' in res['flyout_text'].lower()
    # add through UI: each barcode card
    cards=pg.query_selector_all('#fly-body button.card'); res['barcode_cards']=len(cards)
    pg.click('#fly-body button.card >> nth=0')          # Code 128
    pg.wait_for_timeout(300)
    res['sel_after_add']=pg.evaluate("MARQ.Elements.selected() && {type:MARQ.Elements.selected().type, v:MARQ.Elements.selected().props.value, f:MARQ.Elements.selected().props.format}")
    res['panel_has_value']= pg.query_selector('#ep-bc-value') is not None
    res['info']=pg.inner_text('#ep-bc-info')
    pg.screenshot(path='shot_code128.png')
    # edit value through UI
    pg.fill('#ep-bc-value','MARQ-2026/01'); pg.press('#ep-bc-value','Enter'); pg.wait_for_timeout(200)
    res['edited_value']=pg.evaluate("MARQ.Elements.selected().props.value"); res['info_after']=pg.inner_text('#ep-bc-info')
    # invalid edit: switch to EAN13 with non-numeric value must be rejected, element unchanged
    pg.select_option('#ep-bc-format','EAN13'); pg.wait_for_timeout(200)
    res['format_after_invalid']=pg.evaluate("MARQ.Elements.selected().props.format"); res['toast']=pg.inner_text('#status-msg')
    # valid: numeric value then EAN13
    pg.fill('#ep-bc-value','4006381333931'); pg.press('#ep-bc-value','Enter'); pg.select_option('#ep-bc-format','EAN13'); pg.wait_for_timeout(200)
    res['ean13_state']=pg.evaluate("[MARQ.Elements.selected().props.format,MARQ.Elements.selected().props.value]")
    # bar width / text toggle / colour / undo
    pg.fill('#ep-bc-module','0.4'); pg.press('#ep-bc-module','Enter'); pg.uncheck('#ep-bc-text'); pg.wait_for_timeout(150)
    res['showText_off']=pg.evaluate("MARQ.Elements.selected().props.showText===false")
    pg.click('#btn-undo'); pg.wait_for_timeout(150); res['undo_restores_text']=pg.evaluate("MARQ.Elements.selected().props.showText===true")
    # QR via UI
    pg.click('#rail button[title="QR Code"]'); pg.wait_for_timeout(150); pg.click('#fly-body button.card'); pg.wait_for_timeout(300)
    res['qr_added']=pg.evaluate("MARQ.Elements.selected().type"); res['qr_info']=pg.inner_text('#ep-qr-info')
    pg.fill('#ep-qr-value','MARQ asset 42 — ünï'); pg.select_option('#ep-qr-ec','Q'); pg.wait_for_timeout(200)
    res['qr_state']=pg.evaluate("[MARQ.Elements.selected().props.value,MARQ.Elements.selected().props.ecLevel]"); res['qr_info2']=pg.inner_text('#ep-qr-info')
    pg.fill('#ep-qr-value',''); pg.wait_for_timeout(150); res['qr_empty_info']=pg.inner_text('#ep-qr-info'); pg.fill('#ep-qr-value','https://example.com/a'); pg.wait_for_timeout(150)
    # drag/resize/rotate/lock still work (geometry): set width via panel
    pg.fill('#ep-w','30'); pg.press('#ep-w','Enter'); res['qr_w']=pg.evaluate("MARQ.Elements.selected().w"); res['qr_h']=pg.evaluate("MARQ.Elements.selected().h")
    pg.fill('#ep-rot','90'); pg.press('#ep-rot','Enter'); res['rot']=pg.evaluate("MARQ.Elements.selected().rotation")
    pg.screenshot(path='shot_editor.png')
    # save/reload roundtrip
    pg.wait_for_timeout(1200); pg.reload(); pg.wait_for_timeout(700)
    res['after_reload']=pg.evaluate("MARQ.Store.state.project.elements.map(e=>e.type+':'+(e.props.value||''))")
    # ---- render fixtures offscreen for external decoding
    out=pg.evaluate("""() => {
      const cases=[['CODE128','ASSET-000123'],['CODE128','1234567890'],['CODE128','A1234567'],['CODE128','Hello, World! ~'],['CODE128','123456'],['CODE128','12345'],['CODE128','98765432101234'],['CODE128','AB 12345678 CD 99'],['CODE128','a'],['CODE39','ASSET 123-A.$/+%'],['EAN13','5901234123457'],['EAN13','4006381333931'],['EAN8','96385074'],['EAN8','40170725'],['ITF14','15400141288763'],['ITF14','00012345678905']];
      const out=[];
      cases.forEach(([f,v])=>{
        const P=MARQ.Model.createProject('t'); P.label.width=90; P.label.height=30; P.label.background='#ffffff'; P.label.borderWidth=0;
        const e=MARQ.Model.createElement('barcode',{x:2,y:2,w:86,h:26,props:{format:f,value:v,moduleWidth:0.4,margin:1,showText:true,textSize:10}}); P.elements.push(e);
        const k=20, c=document.createElement('canvas'); c.width=90*k; c.height=30*k; const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height); MARQ.Renderer.draw(x,P,{},k,{});
        out.push({kind:'barcode',f,v,png:c.toDataURL('image/png')});
      });
      [['L','A'],['M','https://example.com'],['Q','Wörld ✓ 日本語'],['H','MARQ-ASSET-0001 location: A-12'],['M','x'.repeat(500)]].forEach(([ec,v])=>{
        const P=MARQ.Model.createProject('t'); P.label.width=40; P.label.height=40; P.label.borderWidth=0;
        const e=MARQ.Model.createElement('qr',{x:2,y:2,w:36,h:36,props:{value:v,ecLevel:ec,margin:2}}); P.elements.push(e);
        const k=20, c=document.createElement('canvas'); c.width=40*k; c.height=40*k; const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height); MARQ.Renderer.draw(x,P,{},k,{});
        out.push({kind:'qr',f:ec,v,png:c.toDataURL('image/png')});
      });
      // error placeholder
      const P=MARQ.Model.createProject('t'); P.label.width=60; P.label.height=25; const e=MARQ.Model.createElement('barcode',{x:2,y:2,w:56,h:20,props:{format:'EAN13',value:'123'}}); P.elements.push(e);
      const c=document.createElement('canvas'); c.width=1200; c.height=500; const x=c.getContext('2d'); MARQ.Renderer.draw(x,P,{},20,{}); out.push({kind:'err',f:'EAN13',v:'123',png:c.toDataURL('image/png')});
      return out; }""")
    res['errs']=errs
    b.close()
for i,o in enumerate(out):
    open('case_%02d.png'%i,'wb').write(base64.b64decode(o['png'].split(',')[1])); o['file']='case_%02d.png'%i; del o['png']
json.dump(out,open('cases.json','w'))
print(json.dumps(res,indent=1,ensure_ascii=False))
