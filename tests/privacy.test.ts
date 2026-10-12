import {test} from 'node:test';
import assert from 'node:assert/strict';
import {redactText,sanitizeOutbound} from '../src/main/privacy';

test('outbound state and fix text redact configured opaque credentials without mutating source evidence',()=>{
  const credential='f'.repeat(64);
  const source={report:{findings:[{id:'finding-id',file:'src/auth.ts',evidence:`db.query(\`SELECT ${credential} \${req.params.id}\`);`}],previousFindings:[]},muted:false};
  const outbound=sanitizeOutbound(source,[credential]);
  assert.ok(!JSON.stringify(outbound).includes(credential));
  assert.ok(outbound.report.findings[0].evidence.includes('[REDACTED]'));
  assert.equal(outbound.report.findings[0].id,'finding-id');assert.equal(outbound.muted,false);
  assert.ok(source.report.findings[0].evidence.includes(credential));
  assert.ok(!redactText(`Inspect ${source.report.findings[0].evidence}; password="synthetic-private"`,[credential]).includes('synthetic-private'));
});
