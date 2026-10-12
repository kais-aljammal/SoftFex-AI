import {randomUUID} from 'node:crypto';
import type {AppState,ReviewReport} from '../shared/types';
import {WorkspaceWatcher,readSource} from './watcher';
import {captureSnapshot} from './snapshot';
import {scanRules} from './rules';
import {reviewAI,redactSource} from './llm';
import {dedupeFindings,previousStatuses} from './findings';
import {gatherReviewContext,type ReviewContextFile} from './review-context';
type Trigger=ReviewReport['trigger'];
export class ReviewCoordinator {
  private busy=false;private queued?:{trigger:Trigger;taskContext?:string};private closed=false;private controller?:AbortController;
  constructor(private watcher:WorkspaceWatcher,private state:AppState,private publish:()=>void,private key:()=>string|undefined,private sanitize:(text:string)=>string=redactSource){}
  get active(){return this.busy;}
  cancelAI(){this.controller?.abort();}
  close(){this.closed=true;this.queued=undefined;this.controller?.abort();}
  async request(trigger:Trigger,taskContext?:string){
    if(this.closed)return;
    if(this.busy){this.queued={trigger,taskContext:taskContext?.slice(0,1600)};return;}
    if(trigger==='codex_turn_complete'&&this.watcher.pending.size===0)return;
    this.busy=true;this.controller=new AbortController();
    const startedAt=Date.now();const previous=this.state.report;
    this.state.phase='reviewing';this.state.error=undefined;this.publish();
    let deadline:ReturnType<typeof setTimeout>|undefined;
    try{
      const snapshot=await captureSnapshot(this.watcher,this.controller.signal);
      if(this.closed)return;
      const prior=[...(previous?.findings??[]),...(previous?.previousFindings??[]).map(p=>p.finding)];
      const local=scanRules(snapshot.files,prior);const key=this.key();
      let aiStatus:ReviewReport['aiStatus']=!key?'not_configured':'skipped';let aiFindings:ReviewReport['findings']=[];let note:string|undefined;
      let relatedFiles:ReviewContextFile[]=[];
      if(this.state.aiEnabled&&key&&snapshot.files.length){
        deadline=setTimeout(()=>this.controller?.abort(),90_000);
        try{
          relatedFiles=await gatherReviewContext(this.watcher.root,snapshot.files,await this.watcher.listFiles(),this.controller.signal);
          const ai=await reviewAI(key,snapshot.files,local,this.controller.signal,{relatedFiles,taskContext,sanitize:this.sanitize});
          aiStatus=ai.ok?'completed':'failed';aiFindings=ai.findings;note=ai.note;
          if(relatedFiles.length)note=[note,'Related context is bounded and excluded from reviewed-file coverage.'].filter(Boolean).join(' ');
        }catch{
          aiStatus='failed';note='AI review could not complete context gathering. Local findings remain available; retry when the project is stable.';
        }
      }
      if(this.closed)return;
      if(!snapshot.files.length)note='No eligible source files were reviewed. Removed or skipped files are not re-verified.';
      let outdated=this.watcher.revision!==snapshot.revision;
      for(const file of [...snapshot.files,...relatedFiles]){const now=await readSource(this.watcher.root,file.file);if(!now.ok||now.source.hash!==file.hash)outdated=true;}
      const findings=dedupeFindings([...local,...aiFindings]);
      const partial=!!snapshot.skippedFiles.length||snapshot.overflow||aiStatus==='failed'||snapshot.files.length===0;
      const report:ReviewReport={reviewId:randomUUID(),workspace:this.watcher.root,trigger,revision:snapshot.revision,startedAt,finishedAt:Date.now(),status:outdated?'outdated':partial?'partial':'complete',changedFiles:snapshot.changedFiles,reviewedFiles:snapshot.files.map(f=>f.file),skippedFiles:snapshot.skippedFiles,localChecksPassed:true,aiStatus,findings,previousFindings:previousStatuses(previous,findings,outdated||aiStatus==='failed'?[]:snapshot.files,aiStatus==='completed'),note,mode:snapshot.mode};
      if(!outdated&&aiStatus!=='failed')await this.watcher.checkpoint(snapshot.files);
      if(this.closed)return;
      // Recheck content too: the watcher may not have emitted a just-written file yet.
      let changedAfterCheckpoint=this.watcher.revision!==snapshot.revision;
      for(const file of [...snapshot.files,...relatedFiles]){const now=await readSource(this.watcher.root,file.file);if(!now.ok||now.source.hash!==file.hash)changedAfterCheckpoint=true;}
      if(changedAfterCheckpoint){report.status='outdated';report.previousFindings=previousStatuses(previous,findings,[],false);}
      this.state.report=report;this.state.changedFiles=this.watcher.pending.size;this.state.revision=this.watcher.revision;
      this.state.phase=report.status==='outdated'?'report_outdated':report.status==='partial'?'report_partial':'report_ready';this.publish();
    }catch(error){
      if(!this.closed){this.state.phase='review_failed';this.state.error=error instanceof Error&&error.message.startsWith('Changes still arriving')?error.message:'Review could not capture a stable source snapshot. Try again.';this.publish();}
    }finally{
      if(deadline)clearTimeout(deadline);this.busy=false;
      const queued=this.queued;this.queued=undefined;if(queued&&!this.closed)void this.request(queued.trigger,queued.taskContext);
    }
  }
}
