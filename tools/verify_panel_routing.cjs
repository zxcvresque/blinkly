// Focused regression check: current-page Settings and visible gradient borders.
const fs=require('node:fs'), path=require('node:path'), os=require('node:os'), http=require('node:http'), assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const ROOT=path.resolve(process.env.BLINKLY_EXTENSION_ROOT||path.join(__dirname,'..'));
const reportDir='/private/tmp/blinkly-panel-route-qa'; fs.mkdirSync(reportDir,{recursive:true});
let context,server,profile; const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function shadow(page) {
  const client = await context.newCDPSession(page);
  await client.send('DOM.enable');
  const { root } = await client.send('DOM.getDocument', { depth: -1, pierce: true });
  function search(node) {
    if (node.attributes?.includes('blinkly-root')) return node.shadowRoots?.[0];
    for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
      const found = search(child); if (found) return found;
    }
  }
  const node = search(root); assert.ok(node, 'Blinkly closed shadow root was injected');
  const { object } = await client.send('DOM.resolveNode', { nodeId: node.nodeId });
  return async (fn, arg) => {
    const result = await client.send('Runtime.callFunctionOn', {
      objectId: object.objectId, functionDeclaration: fn.toString(),
      arguments: [{ value: arg }], returnByValue: true, awaitPromise: true, userGesture: true
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
}
(async()=>{
 server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'none'; script-src 'none'; connect-src 'none'; style-src 'unsafe-inline'");res.end('<!doctype html><title>Blinkly panel test</title><h1>Existing webpage</h1><p>Settings should open on the right of this page.</p>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 profile=fs.mkdtempSync(path.join(os.tmpdir(),'blinkly-routing-'));
 context=await chromium.launchPersistentContext(profile,{executablePath:'/Applications/Helium.app/Contents/MacOS/Helium',headless:true,ignoreDefaultArgs:['--disable-extensions'],viewport:{width:1365,height:900},args:['--disable-extensions-except='+ROOT,'--load-extension='+ROOT]});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const page=await context.newPage(); await page.goto('http://127.0.0.1:'+server.address().port); await wait(300); await page.bringToFront();
 const ui=await shadow(page);
 const tab=await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});return {id:tab.id};});
 const popup=await context.newPage();await popup.goto(worker.url().replace('background.js','popup.html')); await wait(150);
 // A real action popup is not a browser tab. Keep its active-tab query aimed at the webpage,
 // while still sending the actual runtime message through the extension to that page.
 await popup.evaluate(id=>{chrome.tabs.query=async()=>[{id}];window.__didClose=false;window.close=()=>{window.__didClose=true;};},tab.id);
 const before=context.pages().length;
 await popup.locator('#b-set').click(); await wait(400);
 assert.equal(await popup.evaluate(()=>window.__didClose),true,'Popup closes after page acknowledgment');
 assert.equal(context.pages().length,before,'No new settings tab created');
 const panel=await ui(function(){const p=this.querySelector('#panel'),r=p.getBoundingClientRect(),s=getComputedStyle(p);return {open:p.classList.contains('on'),standalone:p.classList.contains('page'),left:r.left,right:r.right,width:r.width,border:s.borderTopWidth,background:s.backgroundImage};});
 assert.equal(panel.open,true); assert.equal(panel.standalone,false);assert.ok(Math.abs(panel.right-1353)<2);assert.equal(panel.border,'2px');
 assert.match(panel.background,/rgb\(233, 186, 216\)/);
 await popup.locator('#b-set').click();await wait(100);assert.equal(await ui(function(){return this.querySelector('#panel').classList.contains('on');}),true,'Repeated Settings keeps panel open');
 await page.bringToFront();await wait(400);await page.screenshot({path:path.join(reportDir,'right-panel-gradient.png')});
 const popupCss=await popup.evaluate(()=>({rootBackground:getComputedStyle(document.documentElement).backgroundColor,rootRadius:getComputedStyle(document.documentElement).borderRadius,rootOverflow:getComputedStyle(document.documentElement).overflow,border:getComputedStyle(document.body,'::after').paddingTop,background:getComputedStyle(document.body,'::after').backgroundImage}));
 assert.equal(popupCss.rootBackground,'rgb(29, 29, 29)');assert.equal(popupCss.rootRadius,'0px');assert.equal(popupCss.rootOverflow,'hidden');assert.equal(popupCss.border,'2px');
 await popup.locator('body').screenshot({path:path.join(reportDir,'popup-gradient.png'),omitBackground:true});
 await page.bringToFront();
 const brand=await ui(function(){const canvas=this.querySelector('canvas.brand-icon');return {loaded:canvas.dataset.loaded,pixels:Array.from(canvas.getContext('2d').getImageData(0,0,96,96).data).filter((v,i)=>i%4===3&&v>0).length};});
 assert.equal(brand.loaded,'true','Real Blinkly logo loads despite img-src none');assert.ok(brand.pixels>1000);
 await ui(function(){this.querySelector('[data-t="voice"]').click();this.querySelector('.body').scrollTop=0;});await wait(200);
 const hit=await ui(function(){const r=this.querySelector('[data-k="flirty"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height};});
 assert.equal(hit.width,44);assert.equal(hit.height,32);
 await page.mouse.click(hit.x,hit.y);await wait(250);
 const checked=await ui(function(){const input=this.querySelector('[data-k="flirty"]'),track=input.nextElementSibling,style=getComputedStyle(track,'::after'),r=track.getBoundingClientRect(),matrix=new DOMMatrixReadOnly(style.transform);return {checked:input.checked,label:input.getAttribute('aria-label'),insetRight:r.width-(parseFloat(style.left)+matrix.e+parseFloat(style.width)),insetTop:parseFloat(style.top),insetBottom:r.height-(parseFloat(style.top)+parseFloat(style.height))};});
 assert.equal(checked.checked,true);assert.equal(checked.label,'Flirty lines');assert.equal(checked.insetRight,3);assert.equal(checked.insetTop,3);assert.equal(checked.insetBottom,3);
 assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('cfg')).cfg.flirty),true);
 await page.screenshot({path:path.join(reportDir,'logo-and-toggle.png')});
 await ui(function(){this.querySelector('[data-k="flirty"]').focus();});await page.keyboard.press('Space');await wait(250);
 assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('cfg')).cfg.flirty),false,'Keyboard toggling persists');

 // A missing/stale receiver must keep guidance in the popup, never open options in a new tab.
 await popup.evaluate(()=>{window.__didClose=false;chrome.tabs.sendMessage=async()=>{throw new Error('Receiving end does not exist');};});
 await popup.locator('#b-set').click();await wait(100);assert.equal(await popup.evaluate(()=>window.__didClose),false);assert.equal(context.pages().length,before);assert.equal(await popup.locator('#settings-status').isVisible(),true);
 const report={panel,popupCss,brand,toggle:checked,noNewTab:true,missingReceiverShowsInlineGuidance:true,checks:['current-page right panel','message acknowledgment','repeated click keeps open','visible full-opacity 2px gradient','rectangular charcoal popup root','no automatic new tab fallback','real header logo under restrictive CSP','toggle pointer and keyboard interaction','centered toggle knob']};
 fs.writeFileSync(path.join(reportDir,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(context)await context.close();if(server)await new Promise(resolve=>server.close(resolve));if(profile)fs.rmSync(profile,{recursive:true,force:true});});
