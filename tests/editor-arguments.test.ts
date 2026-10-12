import {test} from 'node:test';import assert from 'node:assert/strict';
import {editorArguments} from '../src/main/editor-arguments';
test('source navigation opens the actual workspace and exact file/line as separate safe arguments',()=>{
 const root='C:\\Projects with spaces\\selected project',file=root+'\\src\\auth.ts';
 assert.deepEqual(editorArguments(root,file,23),['--new-window',root,'--goto',file+':23:1']);
});
