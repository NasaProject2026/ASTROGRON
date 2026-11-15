// Installed Edge only. Reports and PDF verification never fetch network assets.
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const moduleRoot=process.env.ASTRAGRON_NODE_MODULES;
if(!moduleRoot) throw Error('Set ASTRAGRON_NODE_MODULES to bundled node_modules');
const {chromium}=require(path.join(moduleRoot,'playwright'));

(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--no-first-run','--disable-extensions']});
 const results=[];
 try{
  for(const directory of process.argv.slice(2)){
   const root=path.resolve(directory);
   const requests=[];
   const page=await browser.newPage({viewport:{width:1280,height:960}});
   await page.route('**/*',route=>{
    if(/^https?:/.test(route.request().url())){requests.push(route.request().url());return route.abort();}
    return route.continue();
   });
   await page.goto(pathToFileURL(path.join(root,'Farm_Decision_Summary.html')).href,{waitUntil:'load'});
   await page.evaluate(()=>document.fonts.ready);
   async function check(){return page.evaluate(()=>({
    lang:document.documentElement.lang,dir:document.documentElement.dir,
    horizontalOverflow:document.documentElement.scrollWidth>innerWidth,
    overflowingCells:[...document.querySelectorAll('td,th')].filter(x=>x.scrollWidth>x.clientWidth+2).length,
    internalTokens:/EVIDENCE_BLOCKED|NOT_VERIFIED|NOT_MODELED|[a-f0-9]{64}|research:AU:/.test(document.body.innerText),
    arabic:/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/.test(document.body.innerText),
    numericBindings:[...document.querySelectorAll('.numeric')].map(x=>({pointer:x.dataset.source,raw:JSON.parse(x.dataset.value),display:x.innerText})),
    sectionHeights:[...document.querySelectorAll('.page')].map(x=>x.getBoundingClientRect().height)
   }));}
   const desktop=await check();
   await page.screenshot({path:path.join(root,'Desktop_Preview.png'),fullPage:true});
   await page.setViewportSize({width:390,height:844});
   const mobile=await check();
   await page.screenshot({path:path.join(root,'Mobile_Preview.png'),fullPage:true});
   for(const state of [desktop,mobile]){
    if(state.lang!=='en'||state.dir!=='ltr'||state.horizontalOverflow||state.overflowingCells||state.internalTokens||state.arabic)throw Error('Customer layout or language failed: '+JSON.stringify(state));
   }
   await page.emulateMedia({media:'print'});
   await page.pdf({path:path.join(root,'Farm_Decision_Summary_Mobile_Print.pdf'),format:'A4',printBackground:true,preferCSSPageSize:true});
   await page.setViewportSize({width:1280,height:960});
   const printState=await check();
   await page.pdf({path:path.join(root,'Farm_Decision_Summary.pdf'),format:'A4',printBackground:true,preferCSSPageSize:true,
    displayHeaderFooter:true,headerTemplate:'<span></span>',
    footerTemplate:'<div style="font:8px Arial;width:100%;text-align:center;color:#52676d">ASTRAGRON | Research comparison | <span class="pageNumber"></span> / <span class="totalPages"></span></div>'});
   results.push({directory:root,browser:await browser.version(),desktop,mobile,printSectionHeights:printState.sectionHeights,
    blockedExternalRequests:requests,createdAt:new Date().toISOString()});
   await page.close();
  }
 }finally{await browser.close();}
 const destination=path.resolve('evidence/BROWSER_PRINT_VERIFICATION.json');
 fs.writeFileSync(destination,JSON.stringify(results,null,2)+'\n');
 console.log(JSON.stringify(results.map(r=>({directory:r.directory,desktopOverflow:r.desktop.horizontalOverflow,mobileOverflow:r.mobile.horizontalOverflow,numericBindings:r.desktop.numericBindings.length}))));
})().catch(error=>{console.error(error);process.exitCode=1});
