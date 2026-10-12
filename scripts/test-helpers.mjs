export async function waitState(page,predicate,timeout=15000){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){const state=await page.evaluate(()=>window.softfex.getState());if(predicate(state))return state;await new Promise(r=>setTimeout(r,80));}
 const state=await page.evaluate(()=>window.softfex.getState());throw new Error(`State wait timed out: phase=${state.phase}, error=${state.error||state.report?.note||'none'}`);
}
