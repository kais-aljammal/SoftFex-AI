import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dedupeFindings,validateCandidates,previousStatuses} from '../src/main/findings';
import type {ReviewReport} from '../src/shared/types';
import {source} from './helpers';

function separateDefects(){
  const file=source('export const firstNumbers = (values: number[], limit: number) => values.slice(0, limit - 1).sort();');
  const base={severity:'medium',confidence:'high',category:'correctness',file:file.file,startLine:1,endLine:1};
  const input=[
    {...base,title:'Requested count is reduced by one',evidence:'values.slice(0, limit - 1)',explanation:'The exclusive slice endpoint subtracts one from the requested limit.',impact:'Requesting two values from [2, 10] returns only one.',recommendation:'Use the requested limit as the exclusive endpoint.'},
    {...base,title:'Numeric values are sorted lexicographically',evidence:'.sort()',explanation:'Array.sort without a comparator orders numeric values as strings.',impact:'Values [2, 10] are returned as [10, 2] instead of numeric ascending order.',recommendation:'Use a numeric ascending comparator.'},
  ];
  const validated=validateCandidates({findings:input},[file]);assert.equal(validated.rejected,0);return {file,findings:validated.findings};
}
test('independent correctness defects on the same source line are both retained',()=>{
  const {findings}=separateDefects();assert.notEqual(findings[0].id,findings[1].id);
  // Independently reproduce the two observable JavaScript behaviors.
  assert.deepEqual([2,10].slice(0,2-1).sort(),[2]);
  assert.deepEqual([2,10].slice(0,3-1).sort(),[10,2]);
  assert.equal(dedupeFindings(findings).length,2);
});
test('exact equivalent evidence is deduplicated without relying on line overlap',()=>{
  const {findings}=separateDefects();const first=findings[0];
  assert.equal(dedupeFindings([first,{...first,id:'different-id',evidence:`  ${first.evidence}\n`}]).length,1);
  assert.equal(dedupeFindings([first,{...first}]).length,1);
});
test('a different current defect on the same line does not erase unresolved prior history',()=>{
  const {findings}=separateDefects();const previous={findings:[findings[1]],previousFindings:[]} as unknown as ReviewReport;
  const history=previousStatuses(previous,[findings[0]],[],false);
  assert.equal(history.length,1);assert.equal(history[0].finding.id,findings[1].id);assert.equal(history[0].status,'not_reverified');
});
