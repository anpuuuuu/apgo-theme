// Actual cart component + Component refs/events + section renderer + morph,
// with a local Cart Ajax server. --baseline reads the affected pre-fix production commit.
const assert=require('assert/strict');
const fs=require('fs');
const path=require('path');
const {execFileSync}=require('child_process');
const {Liquid}=require('liquidjs');
const {chromium,webkit}=require('playwright');
const ROOT=path.join(__dirname,'..');
const baseline=process.argv.includes('--baseline');
const BASELINE='c394f7a176d5492707c39db3194712ebfff94e00';
const source=file=>baseline&&['snippets/cart-products.liquid','assets/component-cart-items.js'].includes(file)
  ?execFileSync('git',['show',BASELINE+':'+file],{cwd:ROOT,encoding:'utf8'})
  :fs.readFileSync(path.join(ROOT,file),'utf8');
const snippet=source('snippets/cart-products.liquid');
const rowStart=snippet.lastIndexOf('<tr',snippet.indexOf('ref="cartItemRows[]"'));
const rowTemplate=snippet.slice(rowStart).match(/^[\s\S]*?\r?\n\s*>/)[0];
const rowCss=snippet.match(/\.cart-items__table-row\.removing \{[\s\S]*?@keyframes removeRow \{[\s\S]*?\n  \}/)[0];
const liquid=new Liquid();
const item=(id,key,quantity=1)=>({variant_id:id,key,quantity,original_price:6000,original_line_price:6000*quantity,final_line_price:6000*quantity,variant:{compare_at_price:6000},product:{metafields:{apgo:{}}}});
const MY=[item(47521770668186,'pwp:marked'),item(67976724512922,'aurora:bundle')];
const SG=[item(48995858120858,'lavender:gift'),item(48952581619866,'cotton:paid'),item(48952581587098,'freesia:paid'),item(48952581488794,'rose:paid')];

async function run(){
 const browser=await(process.argv.includes('--webkit')?webkit:chromium).launch();
 const results=[];
 async function setup(items,{delay=20,failure=false,networkFailure=false,reduced=false,drawer=false}={}){
  const context=await browser.newContext({viewport:{width:393,height:852},reducedMotion:reduced?'reduce':'no-preference'});
  const state={items:structuredClone(items),posts:0,reads:0,errors:[]};
  const page=await context.newPage();page.on('pageerror',e=>state.errors.push(e.message));
  const section=async sectionId=>{
   const rows=await Promise.all(state.items.map(async(it,index)=>{
    const open=await liquid.parseAndRender(rowTemplate,{item:it,section:{id:sectionId},show_selection:sectionId==='main'});
    return `${open}<td>${it.key}</td><td><quantity-selector-component ref="quantitySelectors[]"><input type="number" name="updates[]" value="${it.quantity}"></quantity-selector-component><button type="button" on:click="/onLineItemRemove/${index+1}">Remove ${it.key}</button></td><td ref="cartItemErrorContainer-${index+1}" class="hidden"><span ref="cartItemError-${index+1}"></span></td></tr>`;
   }));
   return `<section class="shopify-section" id="shopify-section-${sectionId}"><cart-items-component data-section-id="${sectionId}"><span ref="cartItemCount">${state.items.reduce((n,i)=>n+i.quantity,0)}</span><table><tbody>${rows.join('')}</tbody></table></cart-items-component></section>`;
  };
  const sections=async()=>Object.fromEntries(await Promise.all((drawer?['main','drawer']:['main']).map(async id=>[id,await section(id)])));
  const documentHtml=async()=>`<!doctype html><html><head><style>:root{--animation-speed:120ms;--animation-easing:linear}.cart-items__table-row{display:grid;grid-template-columns:1fr 1fr;min-height:60px}.hidden{display:none}${rowCss}</style><script type="importmap">{"imports":{"@theme/component":"/assets/component.js","@theme/utilities":"/assets/utilities.js","@theme/morph":"/assets/morph.js","@theme/events":"/assets/events.js","@theme/performance":"/assets/performance.js","@theme/section-renderer":"/assets/section-renderer.js"}}</script><script>window.DeclarativeShadowElement=class extends HTMLElement{connectedCallback(){}disconnectedCallback(){}};window.Theme={routes:{cart_change_url:'/cart/change.js',cart_update_url:'/cart/update.js'}};window.Shopify={designMode:false};window.apgoCartToastEnsure=()=>document.getElementById('toast');</script><script type="module" src="/assets/component-cart-items.js"></script></head><body>${Object.values(await sections()).join('')}<div id="toast" role="alert"></div></body></html>`;
  await context.route('https://cart-removal.test/**',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.pathname.startsWith('/assets/'))return route.fulfill({contentType:'application/javascript',body:source(u.pathname.slice(1))});
   if(u.pathname==='/cart/change.js'){
    state.posts++;const body=req.postDataJSON();await new Promise(r=>setTimeout(r,delay));
    if(failure)return route.fulfill({contentType:'application/json',body:JSON.stringify({errors:'Unable to remove test item'})});
    if(networkFailure)return route.fulfill({status:503,body:'Service unavailable'});
    assert.equal(body.quantity,0);state.items.splice(body.line-1,1);
    return route.fulfill({contentType:'application/json',body:JSON.stringify({item_count:state.items.reduce((n,i)=>n+i.quantity,0),sections:await sections()})});
   }
   if(u.searchParams.has('section_id')){
    state.reads++;if(networkFailure)return route.fulfill({status:503,body:'Service unavailable'});
    return route.fulfill({contentType:'text/html',body:await section(u.searchParams.get('section_id'))});
   }
   return route.fulfill({contentType:'text/html',body:await documentHtml()});
  });
  await page.goto('https://cart-removal.test/cart');
  await page.waitForFunction(()=>!!customElements.get('cart-items-component'));
  const remove=key=>page.locator('[data-section-id="main"]').getByRole('button',{name:'Remove '+key,exact:true}).click();
  const settled=async()=>{await page.waitForFunction(()=>!document.querySelector('.cart-items-disabled'));await page.waitForTimeout(480);};
  const keys=()=>page.locator('[data-section-id="main"] tr[data-line-key]').evaluateAll(rows=>rows.map(r=>r.dataset.lineKey));
  return{context,page,state,remove,settled,keys};
 }
 const pass=name=>{results.push({ok:true,detail:name});console.log('PASS '+name);};
 try{
  for(const [label,items,key]of[['MY first row',MY,'pwp:marked'],['SG middle row',SG,'cotton:paid'],['same variant different properties',[item(47521770668186,'set:normal'),item(47521770668186,'set:pwp')],'set:normal']]){
   const t=await setup(items);await t.remove(key);await t.settled();
   assert.deepEqual(await t.keys(),items.filter(i=>i.key!==key).map(i=>i.key),label+' must retain every remaining line after the old animation settles');
   assert.deepEqual(t.state.errors,[]);pass(label+': fast section morph retains all remaining rows');await t.context.close();
  }
  {
   const t=await setup(MY,{delay:850});await t.remove('pwp:marked');await t.page.waitForTimeout(480);
   assert.deepEqual(await t.keys(),MY.map(i=>i.key),'Pending removal must not delete rows before the server confirms');
   await t.settled();assert.deepEqual(await t.keys(),['aurora:bundle']);
   await t.remove('aurora:bundle');await t.settled();assert.deepEqual(await t.keys(),[]);pass('slow response: rows await server confirmation, then repeated removal reaches empty cart');await t.context.close();
  }
  for(const networkFailure of [false,true]){
   const t=await setup(MY,{failure:!networkFailure,networkFailure});await t.remove('pwp:marked');await t.settled();
   assert.deepEqual(await t.keys(),MY.map(i=>i.key));
   const row=t.page.locator('[data-section-id="main"] tr').first();assert.equal(await row.isVisible(),true);
   assert.equal(await row.evaluate(el=>el.classList.contains('removing')),false);
   assert.equal(await row.evaluate(el=>getComputedStyle(el).opacity),'1');
   assert.match(await t.page.locator(networkFailure?'#toast':'[ref="cartItemError-1"]').innerText(),/remove|reload|refresh/i);
   pass(networkFailure?'network and refresh failures preserve original rows with error feedback':'server refusal restores original rows and quantity input');await t.context.close();
  }
  {
   const t=await setup(MY,{reduced:true});await t.remove('pwp:marked');await t.settled();assert.deepEqual(await t.keys(),['aurora:bundle']);pass('reduced motion retains remaining row');await t.context.close();
  }
  {
   const t=await setup(MY,{drawer:true});const ids=await t.page.locator('tr[data-line-key]').evaluateAll(rows=>rows.map(r=>r.id));assert(ids.every(Boolean));assert.equal(new Set(ids).size,ids.length,'Cart page and drawer must not duplicate row IDs');
   await t.remove('pwp:marked');await t.settled();assert.deepEqual(await t.keys(),['aurora:bundle']);
   assert.deepEqual(await t.page.locator('[data-section-id="drawer"] tr[data-line-key]').evaluateAll(rows=>rows.map(r=>r.dataset.lineKey)),['aurora:bundle']);
   assert.deepEqual(t.state.errors,[]);pass('cart page and drawer stay in sync with distinct stable IDs');await t.context.close();
  }
 }finally{await browser.close();}
 return results;
}
module.exports={run};
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
