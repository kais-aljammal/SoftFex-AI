import ts from 'typescript';
import type {Finding} from '../shared/types';
import type {SnapshotFile} from './snapshot';
import {fingerprint} from './findings';
export function scanRules(files:SnapshotFile[],previous:Finding[]=[]):Finding[]{
  const findings:Finding[]=[];
  for(const file of files){
    const source=ts.createSourceFile(file.file,file.content,ts.ScriptTarget.Latest,true,file.file.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    function visit(node:ts.Node){
      if(ts.isCallExpression(node)&&node.arguments.length){
        const name=ts.isPropertyAccessExpression(node.expression)?node.expression.name.text:ts.isIdentifier(node.expression)?node.expression.text:'';
        const arg=node.arguments[0];
        if(name==='query'&&ts.isTemplateExpression(arg)&&/\b(?:SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)\b/i.test(arg.getText(source))){
          const startLine=source.getLineAndCharacterOfPosition(node.getStart(source)).line+1;
          const endLine=source.getLineAndCharacterOfPosition(node.getEnd()).line+1;
          const evidence=node.getText(source);
          if(evidence.length<=1200){
            const finding:Finding={id:'',origin:'rule',ruleId:'raw-sql-interpolation',severity:'high',confidence:'medium',category:'security',title:'Potential SQL injection through interpolated query',file:file.file,startLine,endLine,evidence,explanation:'Dynamic values are interpolated directly into a SQL string passed to query(). Verify whether any interpolated value can be influenced by a caller.',impact:'If a value is untrusted and the database executes this raw string, it may alter the intended SQL query.',recommendation:'Verify the database API, then pass values separately using its supported parameter binding. Preserve the intended query and add a regression case for hostile input.',snapshotHash:file.hash};
            finding.id=fingerprint(finding);
            if((startLine<=file.changedEnd&&endLine>=file.changedStart)||previous.some(p=>p.id===finding.id))findings.push(finding);
          }
        }
      }
      ts.forEachChild(node,visit);
    }
    visit(source);
  }
  return findings;
}
