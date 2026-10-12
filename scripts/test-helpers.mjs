export async function waitState(page,predicate,timeout=15000){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){const state=await page.evaluate(()=>window.softfex.getState());if(predicate(state))return state;await new Promise(r=>setTimeout(r,80));}
 const state=await page.evaluate(()=>window.softfex.getState());throw new Error(`State wait timed out: phase=${state.phase}, error=${state.error||state.report?.note||'none'}`);
}

// Settings are deliberately secondary in the product, but smoke tests exercise
// the same visible consent and voice controls rather than bypassing them.
export async function openSettings(page){
 const summary=page.locator('summary').filter({hasText:'Review settings'});
 if(await summary.count()){
  const open=await summary.evaluate(node=>node.parentElement.open);
  if(!open)await summary.click();
 }
}
