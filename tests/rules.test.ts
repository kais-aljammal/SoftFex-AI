import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {scanRules} from '../src/main/rules';import {source} from './helpers';
test('actual unsafe fixture yields grounded SQL finding, corrected fixture does not',async()=>{
 const unsafe=source(await readFile('tests/fixtures/vulnerable-auth.ts','utf8'));const safe=source(await readFile('tests/fixtures/safe-auth.ts','utf8'));
 const findings=scanRules([unsafe]);assert.equal(findings.length,1);assert.equal(findings[0].startLine,2);assert.ok(unsafe.content.includes(findings[0].evidence));assert.equal(scanRules([safe]).length,0);
});
test('comments, unrelated templates and tagged parameterized query are not findings',()=>{
 for(const text of ['// db.query(`SELECT ${req.params.id}`)','const label = `SELECT ${req.params.id}`;','db.query(sql`SELECT * FROM users WHERE id = ${req.params.id}`);','db.query("SELECT * FROM users WHERE id = ?", [req.params.id]);'])assert.equal(scanRules([source(text)]).length,0,text);
});
test('unchanged existing issue is not attributed to a new unrelated edit',()=>{
 const file=source('db.query(`SELECT ${req.params.id}`);\n\nconst n=2;');file.changedStart=3;file.changedEnd=3;assert.equal(scanRules([file]).length,0);
});
