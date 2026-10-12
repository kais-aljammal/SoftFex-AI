import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {Finding,ReviewReport} from '../shared/types';
import type {SnapshotFile} from './snapshot';
export const CandidateSchema=z.object({
  severity:z.enum(['critical','high','medium','low']),confidence:z.enum(['high','medium','low']),
  category:z.enum(['security','correctness','reliability','quality']),title:z.string().min(1).max(160),
  file:z.string().min(1).max(400),startLine:z.number().int().min(1),endLine:z.number().int().min(1),
  evidence:z.string().min(1).max(1200),explanation:z.string().min(1).max(1500),impact:z.string().min(1).max(1200),recommendation:z.string().min(1).max(1500),
}).strict();
const ReverificationSchema=z.object({findingId:z.string().min(1).max(64),status:z.enum(['no_longer_detected','still_detected','uncertain']),startLine:z.number().int().min(1),endLine:z.number().int().min(1),evidence:z.string().max(1200),explanation:z.string().min(1).max(1200)}).strict();
export type Reverification=z.infer<typeof ReverificationSchema>;
export const OutputSchema=z.object({findings:z.array(CandidateSchema).max(12),reverification:z.array(ReverificationSchema).max(12).optional()}).strict();
export function fingerprint(finding:Pick<Finding,'origin'|'ruleId'|'category'|'file'|'evidence'>){
  return createHash('sha256').update([finding.ruleId||finding.category,finding.file.toLowerCase(),finding.evidence.replace(/\s+/g,' ').trim()].join('|')).digest('hex').slice(0,24);
}
export function validateCandidates(raw:unknown,files:SnapshotFile[]):{findings:Finding[];rejected:number}{
  if(typeof raw!=='object'||raw===null||Object.keys(raw).some(key=>!['findings','reverification'].includes(key))||!Array.isArray((raw as {findings?:unknown}).findings))return {findings:[],rejected:1};
  const input=(raw as {findings:unknown[]}).findings;const findings:Finding[]=[];let rejected=Math.max(0,input.length-12);
  for(const item of input.slice(0,12)){
    const parsed=CandidateSchema.safeParse(item);if(!parsed.success){rejected++;continue;}
    const candidate=parsed.data;const file=files.find(f=>f.file===candidate.file);const lines=file?.content.split(/\r?\n/);
    if(!file||!lines||![candidate.title,candidate.evidence,candidate.explanation,candidate.impact,candidate.recommendation].every(text=>text.trim())||candidate.endLine<candidate.startLine||candidate.endLine>lines.length||!lines.slice(candidate.startLine-1,candidate.endLine).join('\n').includes(candidate.evidence)||!Array.from({length:candidate.endLine-candidate.startLine+1},(_,i)=>candidate.startLine+i).every(line=>file.coveredLines.has(line))){rejected++;continue;}
    const finding:Finding={...candidate,origin:'ai',id:'',snapshotHash:file.hash};finding.id=fingerprint(finding);findings.push(finding);
  }
  return {findings,rejected};
}
export function validateReverifications(raw:unknown,files:SnapshotFile[],prior:Finding[]){
  const result:Reverification[]=[];let rejected=0;
  const input=(raw as {reverification?:unknown})?.reverification;
  if(input===undefined)return {assessments:result,rejected};
  if(!Array.isArray(input))return {assessments:result,rejected:1};
  const counts=new Map<string,number>();for(const item of input)if(typeof item?.findingId==='string')counts.set(item.findingId,(counts.get(item.findingId)??0)+1);
  rejected+=Math.max(0,input.length-12);
  for(const item of input.slice(0,12)){
    const parsed=ReverificationSchema.safeParse(item);if(!parsed.success){rejected++;continue;}
    const assessment=parsed.data,old=prior.find(f=>f.id===assessment.findingId&&f.origin==='ai');
    const file=files.find(f=>f.file===old?.file&&f.reverificationIds?.includes(assessment.findingId));
    if(!old||!file||counts.get(assessment.findingId)!==1){rejected++;continue;}
    const lines=file.content.split(/\r?\n/);
    if(!assessment.explanation.trim()||assessment.status!=='uncertain'&&(!assessment.evidence.trim()||file.coveredLines.size!==lines.length||assessment.endLine<assessment.startLine||assessment.endLine>lines.length||!lines.slice(assessment.startLine-1,assessment.endLine).join('\n').includes(assessment.evidence)||!Array.from({length:assessment.endLine-assessment.startLine+1},(_,i)=>assessment.startLine+i).every(line=>file.coveredLines.has(line)))){rejected++;continue;}
    if(assessment.status==='uncertain'){result.push(assessment);continue;}
    // Normalize to the actual excerpt, not a broad claimed range that happens to
    // contain it. Only current correction evidence can establish changed coverage.
    const region=lines.slice(assessment.startLine-1,assessment.endLine).join('\n');
    const offset=region.indexOf(assessment.evidence);
    const actualStart=assessment.startLine+region.slice(0,offset).split('\n').length-1;
    result.push({...assessment,startLine:actualStart,endLine:actualStart+assessment.evidence.split('\n').length-1});
  }
  return {assessments:result,rejected};
}
const rank={critical:0,high:1,medium:2,low:3};
export function dedupeFindings(findings:Finding[]){
  const results:Finding[]=[];
  for(const finding of [...findings].sort((a,b)=>Number(a.origin==='ai')-Number(b.origin==='ai')||rank[a.severity]-rank[b.severity])){
    const evidence=finding.evidence.replace(/\s+/g,' ').trim();
    if(results.some(old=>old.id===finding.id||(old.file===finding.file&&old.category===finding.category&&old.evidence.replace(/\s+/g,' ').trim()===evidence)))continue;
    results.push(finding);
  }
  return results.sort((a,b)=>rank[a.severity]-rank[b.severity]).slice(0,12);
}
export function previousStatuses(previous:ReviewReport|undefined,findings:Finding[],files:SnapshotFile[],aiSucceeded:boolean,assessments:Reverification[]=[]):ReviewReport['previousFindings']{
  if(!previous)return [];
  const all=[...previous.findings,...previous.previousFindings.filter(p=>p.status==='not_reverified').map(p=>p.finding)];
  return [...new Map(all.map(f=>[f.id,f])).values()].filter(f=>!findings.some(n=>n.id===f.id||
    (n.file===f.file&&n.category===f.category&&n.evidence.replace(/\s+/g,' ').trim()===f.evidence.replace(/\s+/g,' ').trim()))).map(f=>{
    const file=files.find(n=>n.file===f.file);
    const full=file&&file.coveredLines.size===file.content.split(/\r?\n/).length;
    const assessment=assessments.find(a=>a.findingId===f.id);
    const scoped=!!file?.reverificationIds?.includes(f.id)&&!!full;
    const correctionCovered=!!file&&!!assessment&&assessment.startLine<=file.changedEnd&&assessment.endLine>=file.changedStart;
    const resolved=!!file&&(f.origin==='rule'||(aiSucceeded&&scoped&&assessment?.status==='no_longer_detected'&&correctionCovered));
    const reason=resolved?undefined:f.origin==='ai'&&!aiSucceeded?'AI review did not complete; no resolution established.':!file?'Affected file was not covered by this current review.':!scoped?'Corrected scope exceeded or was outside bounded review coverage.':!assessment?'AI returned no explicit assessment of this prior issue.':assessment.status==='uncertain'?assessment.explanation:assessment.status==='still_detected'?'Issue remains present in reviewed code.':'Unchanged evidence is outside the edited scope; correction not established.';
    return {finding:f,status:resolved?'resolved_in_latest_snapshot' as const:'not_reverified' as const,reason};
  });
}
