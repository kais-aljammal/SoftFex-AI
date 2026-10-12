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
