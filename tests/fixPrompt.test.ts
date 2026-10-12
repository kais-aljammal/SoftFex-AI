import {test} from 'node:test';import assert from 'node:assert/strict';import {fixPrompt} from '../src/shared/prompts';import {scanRules} from '../src/main/rules';import {source} from './helpers';
test('fix prompt contains actual evidence and correction guardrails without fabricated checks',()=>{
 const finding=scanRules([source('db.query(`SELECT ${req.params.id}`);')])[0];const prompt=fixPrompt(finding);
 for(const text of ['src/auth.ts:1-1',finding.evidence,finding.recommendation,'First verify','Preserve unrelated behavior','regression test','available checks'])assert.ok(prompt.includes(text),text);
 assert.ok(!prompt.includes('tests passed'));assert.ok(prompt.includes('potential security'));
});
