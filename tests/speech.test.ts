import {test} from 'node:test';import assert from 'node:assert/strict';import {speechSummary,generateSpeech} from '../src/main/speech';import {scanRules} from '../src/main/rules';import {source} from './helpers';import type {ReviewReport} from '../src/shared/types';
test('voice summary is short, qualified, and excludes source/model text',()=>{
 const finding=scanRules([source('db.query(`SELECT ${req.params.id}`);')])[0];const report={status:'complete',findings:[finding]} as ReviewReport;
 const summary=speechSummary(report)!;assert.ok(summary.includes('potential'));assert.ok(summary.length<250);assert.ok(!summary.includes('req.params.id'));assert.equal(speechSummary({...report,status:'outdated'}),undefined);assert.equal(speechSummary({...report,findings:[]}),undefined);
});
test('missing Deepgram credentials uses explicit browser fallback without a request',async()=>{const result=await generateSpeech(undefined,'Test voice',new AbortController().signal);assert.equal(result.provider,'browser');assert.ok(result.notice?.includes('not configured'));});
