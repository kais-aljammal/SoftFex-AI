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
export const OutputSchema=z.object({findings:z.array(CandidateSchema).max(12)}).strict();
export function fingerprint(finding:Pick<Finding,'origin'|'ruleId'|'category'|'file'|'evidence'>){
  return createHash('sha256').update([finding.ruleId||finding.category,finding.file.toLowerCase(),finding.evidence.replace(/\s+/g,' ').trim()].join('|')).digest('hex').slice(0,24);
}
export function validateCandidates(raw:unknown,files:SnapshotFile[]):{findings:Finding[];rejected:number}{
  if(typeof raw!=='object'||raw===null||!Array.isArray((raw as {findings?:unknown}).findings))return {findings:[],rejected:1};
  const input=(raw as {findings:unknown[]}).findings;const findings:Finding[]=[];let rejected=Math.max(0,input.length-12);
  for(const item of input.slice(0,12)){
    const parsed=CandidateSchema.safeParse(item);if(!parsed.success){rejected++;continue;}
    const candidate=parsed.data;const file=files.find(f=>f.file===candidate.file);const lines=file?.content.split(/\r?\n/);
    if(!file||!lines||candidate.endLine<candidate.startLine||candidate.endLine>lines.length||!lines.slice(candidate.startLine-1,candidate.endLine).join('\n').includes(candidate.evidence)||!Array.from({length:candidate.endLine-candidate.startLine+1},(_,i)=>candidate.startLine+i).every(line=>file.coveredLines.has(line))){rejected++;continue;}
    const finding:Finding={...candidate,origin:'ai',id:'',snapshotHash:file.hash};finding.id=fingerprint(finding);findings.push(finding);
  }
  return {findings,rejected};
}
const rank={critical:0,high:1,medium:2,low:3};
export function dedupeFindings(findings:Finding[]){
  const results:Finding[]=[];
  for(const finding of [...findings].sort((a,b)=>Number(a.origin==='ai')-Number(b.origin==='ai')||rank[a.severity]-rank[b.severity])){
    if(results.some(old=>old.id===finding.id||(old.file===finding.file&&old.category===finding.category&&old.startLine<=finding.endLine&&finding.startLine<=old.endLine)))continue;
    results.push(finding);
  }
  return results.sort((a,b)=>rank[a.severity]-rank[b.severity]).slice(0,12);
}
export function previousStatuses(previous:ReviewReport|undefined,findings:Finding[],files:SnapshotFile[],aiSucceeded:boolean):ReviewReport['previousFindings']{
  if(!previous)return [];
  const all=[...previous.findings,...previous.previousFindings.filter(p=>p.status==='not_reverified').map(p=>p.finding)];
  return [...new Map(all.map(f=>[f.id,f])).values()].filter(f=>!findings.some(n=>n.id===f.id)).map(f=>{
    const file=files.find(n=>n.file===f.file);
    // An AI finding is only re-verified if its original evidence region was supplied again,
    // or the entire current file was supplied. Removed/moved scope remains uncertain.
    const location=file?.content.indexOf(f.evidence)??-1;
    const line=location>=0?file!.content.slice(0,location).split(/\r?\n/).length:undefined;
    const full=file&&file.coveredLines.size===file.content.split(/\r?\n/).length;
    const aiCovered=full||(line!==undefined&&file?.coveredLines.has(line));
    const resolved=!!file&&(f.origin==='rule'||(aiSucceeded&&aiCovered));
    return {finding:f,status:resolved?'resolved_in_latest_snapshot' as const:'not_reverified' as const};
  });
}
