import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chunkDocument} from '../src/features/documents/chunking';
import {readingSections} from '../src/features/documents/reading';
test('full document reading reconstructs long pages without search overlap or truncation',()=>{
  const text=Array.from({length:150},(_,i)=>`Topic ${i}: This syllabus explains assessment requirements and course objectives.`).join('\n');
  const sections=readingSections(chunkDocument('d','c',[{text,page:1,slide:null,heading:null,line_start:null,line_end:null},{text:'Final page with the complete policy.',page:2,slide:null,heading:null,line_start:null,line_end:null}]));
  assert.equal(sections.length,2);
  assert.equal(sections[0].text.replace(/\s+/g,' '),text.replace(/\s+/g,' '));
  assert.equal(sections[1].text,'Final page with the complete policy.');
});
