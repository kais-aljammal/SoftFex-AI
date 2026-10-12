import {randomUUID} from 'node:crypto';
import type {AppState,ReviewReport} from '../shared/types';
import {WorkspaceWatcher,readSource} from './watcher';
import {captureSnapshot} from './snapshot';
import {scanRules} from './rules';
import {reviewAI,redactSource} from './llm';
import {dedupeFindings,previousStatuses,type Reverification} from './findings';
import {gatherReviewContext,type ReviewContextFile} from './review-context';
type Trigger=ReviewReport['trigger'];
export class ReviewCoordinator {
  private busy=false;private queued?:{trigger:Trigger;taskContext?:string};private closed=false;private controller?:AbortController;
  private latestTaskContext?:string;
  constructor(private watcher:WorkspaceWatcher,private state:AppState,private publish:()=>void,private key:()=>string|undefined,private sanitize:(text:string)=>string=redactSource){}
  get active(){return this.busy;}
  cancelAI(){this.controller?.abort();}
  close(){this.closed=true;this.queued=undefined;this.latestTaskContext=undefined;this.controller?.abort();}
  async request(trigger:Trigger,taskContext?:string){
    if(this.closed)return;
    if(trigger==='codex_turn_complete'&&taskContext)this.latestTaskContext=this.sanitize(taskContext.slice(0,1600)).slice(0,1600);
    taskContext=this.latestTaskContext;
    if(this.busy){this.queued={trigger,taskContext:taskContext?.slice(0,1600)};return;}
    this.busy=true;this.controller=new AbortController();
    const startedAt=Date.now();const previous=this.state.report;
    this.state.phase='reviewing';this.state.error=undefined;this.publish();
    let deadline:ReturnType<typeof setTimeout>|undefined;
    try{
      if(trigger==='codex_turn_complete'){
        await this.watcher.reconcile(this.controller.signal);
        if(this.closed)return;
        if(!this.watcher.pending.size){
          this.state.phase=previous?(previous.status==='outdated'?'report_outdated':previous.status==='partial'?'report_partial':'report_ready'):'watching';
          this.publish();return;
        }
      }
      const prior=[...(previous?.findings??[]),...(previous?.previousFindings??[]).filter(p=>p.status==='not_reverified').map(p=>p.finding)];
      const snapshot=await captureSnapshot(this.watcher,this.controller.signal,prior);
      if(this.closed)return;
      const local=scanRules(snapshot.files,prior);const key=this.key();
      let aiStatus:ReviewReport['aiStatus']=!key?'not_configured':'skipped';let aiFindings:ReviewReport['findings']=[];let note:string|undefined;
      let relatedFiles:ReviewContextFile[]=[];
      let assessments:Reverification[]=[];
      if(this.state.aiEnabled&&key&&snapshot.files.length){
        deadline=setTimeout(()=>this.controller?.abort(),90_000);
        try{
          relatedFiles=await gatherReviewContext(this.watcher.root,snapshot.files,await this.watcher.listFiles(),this.controller.signal);
          const ai=await reviewAI(key,snapshot.files,local,this.controller.signal,{relatedFiles,taskContext,previousFindings:prior,sanitize:this.sanitize});
          assessments=ai.assessments;
          aiStatus=ai.ok?'completed':'failed';aiFindings=ai.findings;note=ai.note;
          if(relatedFiles.length)note=[note,'Related context is bounded and excluded from reviewed-file coverage.'].filter(Boolean).join(' ');
        }catch{
          aiStatus='failed';note='AI review could not complete context gathering. Local findings remain available; retry when the project is stable.';
        }
      }
      if(this.closed)return;
      if(!snapshot.files.length)note='No eligible source files were reviewed. Removed or skipped files are not re-verified.';
      if(snapshot.skippedFiles.length)note=[note,snapshot.mode==='current_snapshot'?'Snapshot limited to eligible source within review limits. Review Again may select the same files; choose a smaller project folder for omitted source.':'Only reviewed changes are checkpointed. Review Again prioritizes remaining pending changes. Oversized or unreadable files remain skipped.'].filter(Boolean).join(' ');
      if(snapshot.overflow)note=[note,'File discovery reached its safety limit or encountered a watcher error; project coverage is incomplete.'].filter(Boolean).join(' ');
      let outdated=this.watcher.revision!==snapshot.revision;
      for(const file of [...snapshot.files,...relatedFiles]){const now=await readSource(this.watcher.root,file.file);if(!now.ok||now.source.hash!==file.hash)outdated=true;}
      const findings=dedupeFindings([...local,...aiFindings]);
      const partial=!!snapshot.skippedFiles.length||snapshot.overflow||aiStatus==='failed'||snapshot.files.length===0;
      const report:ReviewReport={reviewId:randomUUID(),workspace:this.watcher.root,trigger,revision:snapshot.revision,startedAt,finishedAt:Date.now(),status:outdated?'outdated':partial?'partial':'complete',changedFiles:snapshot.changedFiles,reviewedFiles:snapshot.files.map(f=>f.file),skippedFiles:snapshot.skippedFiles,localChecksPassed:true,aiStatus,findings,previousFindings:previousStatuses(previous,findings,outdated||aiStatus==='failed'?[]:snapshot.files,aiStatus==='completed',assessments),note,mode:snapshot.mode};
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
