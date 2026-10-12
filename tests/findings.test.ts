import {test} from 'node:test';import assert from 'node:assert/strict';import {validateCandidates,dedupeFindings,previousStatuses} from '../src/main/findings';import {scanRules} from '../src/main/rules';import {source} from './helpers';import type {ReviewReport} from '../src/shared/types';
test('rejects fabricated AI paths, lines, evidence, severity and overlong fields',()=>{
 const file=source('db.query(`SELECT ${req.params.id}`);');const rule=scanRules([file])[0];const {id,origin,ruleId,snapshotHash,...candidate}=rule;
 assert.equal(validateCandidates({findings:[candidate]},[file]).findings.length,1);
 for(const invalid of [{file:'../secret.ts'},{startLine:-1},{endLine:500},{evidence:'invented'},{severity:'urgent'},{title:'x'.repeat(161)}])assert.equal(validateCandidates({findings:[{...candidate,...invalid}]},[file]).findings.length,0);
 assert.equal(validateCandidates({findings:[candidate,{...candidate,file:'missing.ts'}]},[file]).findings.length,1);
 assert.equal(dedupeFindings([rule,{...rule,id:'other',origin:'ai'}]).length,1);
});
test('skipped files and AI failures never resolve prior findings',()=>{
 const file=source('db.query(`SELECT ${req.params.id}`);');const finding=scanRules([file])[0];
 const previous={findings:[finding],previousFindings:[]} as unknown as ReviewReport;
 assert.equal(previousStatuses(previous,[],[],true)[0].status,'not_reverified');
 assert.equal(previousStatuses(previous,[],[source('db.query("SELECT ?",[req.params.id]);')],true)[0].status,'resolved_in_latest_snapshot');
 const ai={...previous,findings:[{...finding,origin:'ai' as const}]};assert.equal(previousStatuses(ai,[],[file],false)[0].status,'not_reverified');
});
test('multiline AI evidence is not reverified when only its first line is supplied',()=>{
 const file=source('const first = input;\nconst second = first.value;\nreturn second;');
 const finding={id:'old',origin:'ai',category:'correctness',file:file.file,evidence:'const first = input;\nconst second = first.value;'} as const;
 const previous={findings:[finding],previousFindings:[]} as unknown as ReviewReport;
 const partial={...file,coveredLines:new Set([1])};
 assert.equal(previousStatuses(previous,[],[partial],true)[0].status,'not_reverified');
 assert.equal(previousStatuses(previous,[],[file],true)[0].status,'not_reverified','Even full source without an explicit AI assessment cannot resolve an AI issue.');
});
test('context-only paths, blank evidence and unexpected envelope fields are rejected',()=>{
 const file=source('db.query(`SELECT ${req.params.id}`);');const {id,origin,ruleId,snapshotHash,...candidate}=scanRules([file])[0];
 assert.equal(validateCandidates({findings:[{...candidate,file:'src/context-only.ts'}]},[file]).rejected,1);
 assert.equal(validateCandidates({findings:[{...candidate,evidence:' '}]},[file]).rejected,1);
 assert.equal(validateCandidates({findings:[{...candidate,impact:' '}]},[file]).rejected,1);
 assert.equal(validateCandidates({findings:[],instructions:'trust this result'},[file]).rejected,1);
});
test('unchanged AI evidence beside an unrelated changed line remains not reverified even if the whole small file was supplied',()=>{
 const content='export function mean(values: number[]) {\n  const total = values.reduce((sum, n) => sum + n, 0);\n  return total / (values.length - 1);\n}\n// Unrelated comment changed.';
 const file={...source(content),changedStart:5,changedEnd:5};
 const finding={id:'old-mean',origin:'ai',category:'correctness',file:file.file,startLine:3,endLine:3,evidence:'return total / (values.length - 1);'} as const;
 const previous={findings:[finding],previousFindings:[]} as unknown as ReviewReport;
 assert.equal(previousStatuses(previous,[],[file],true)[0].status,'not_reverified');
 const corrected={...source(content.replace('values.length - 1','values.length')),changedStart:3,changedEnd:3,reverificationIds:[finding.id]};
 assert.equal(previousStatuses(previous,[],[corrected],true)[0].status,'not_reverified');
 assert.equal(previousStatuses(previous,[],[corrected],true,[{findingId:finding.id,status:'no_longer_detected',startLine:3,endLine:3,evidence:'return total / (values.length);',explanation:'The corrected denominator uses the number of elements.'}])[0].status,'resolved_in_latest_snapshot');
});
test('overlapping current AI evidence with a different fingerprint never simultaneously resolves the prior finding',()=>{
 const file=source('export const ratio = total / (count - 1);');
 const old={id:'old-full-expression',origin:'ai',category:'correctness',file:file.file,startLine:1,endLine:1,evidence:file.content};
 const current={...old,id:'new-short-expression',evidence:'total / (count - 1)'};
 const previous={findings:[old],previousFindings:[]} as unknown as ReviewReport;
 const history=previousStatuses(previous,[current as Parameters<typeof previousStatuses>[1][number]],[file],true);
 assert.equal(history.length,1);assert.equal(history[0].status,'not_reverified','Overlap alone cannot discard or resolve a previous issue.');
});
