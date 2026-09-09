import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {evaluationParser} from '../src/features/degree/parser';
import {degreeProgress} from '../src/features/degree/engine';
const extraction=JSON.parse(execFileSync('src-tauri/target/release/examples/extract_document.exe',['C:/Users/user/Downloads/AUB/Degree evaluation record.pdf'],{encoding:'utf8'}));
const text=extraction.segments.map((s:any)=>s.text).join('\n').replace(/Hussein[^\n]*/g,'[Student redacted]').replace(/202508102/g,'[ID redacted]');
fs.writeFileSync('tests/fixtures/degree-evaluation-pdf-raw.txt',text);
const result=evaluationParser.parse({text,filename:'Degree evaluation record.pdf',hash:'test',path:''});
console.log(result.state.program,degreeProgress(result.state));console.log(result.state.groups.map(g=>[g.name,g.credits_required,g.reported_used_credits]));console.log(result.state.courses.map(c=>[c.subject,c.number,c.credits,c.grade,c.status,c.term,c.excluded]));
