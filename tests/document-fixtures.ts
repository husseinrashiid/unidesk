// Small real PDF/OOXML fixtures; no external fixture downloads or cloud services.
export function pdfFixture(texts:string[]) {
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Count ${texts.length} /Kids [${texts.map((_,i)=>`${4+i*2} 0 R`).join(' ')}] >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 texts.forEach((text,i)=>{objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`);const stream=`BT /F1 12 Tf 50 700 Td ${text.split(/\r?\n/).map((line,index)=>`${index ? '0 -16 Td ' : ''}(${line.replace(/[()\\]/g,'\\$&')}) Tj`).join(' ')} ET`;objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);});
 let result='%PDF-1.4\n';const offsets:number[]=[];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(result));result+=`${i+1} 0 obj\n${o}\nendobj\n`;});const start=Buffer.byteLength(result);result+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return Buffer.from(result);
}
function crc32(data:Buffer){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
export function zipFixture(parts:Record<string,string>){
 const locals:Buffer[]=[],central:Buffer[]=[];let offset=0;
 for(const [name,text] of Object.entries(parts)){
  const filename=Buffer.from(name),data=Buffer.from(text),crc=crc32(data);const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(filename.length,26);
  locals.push(local,filename,data);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(filename.length,28);c.writeUInt32LE(offset,42);central.push(c,filename);offset+=local.length+filename.length+data.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(parts).length,8);end.writeUInt16LE(Object.keys(parts).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,directory,end]);
}
export const docxFixture=()=>zipFixture({'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Objections</w:t></w:r></w:p><w:p><w:r><w:t>Cultural disagreement does not establish moral relativism.</w:t></w:r></w:p></w:body></w:document>'});
export const pptxFixture=()=>zipFixture({'ppt/presentation.xml':'<p:presentation xmlns:p="urn:p" xmlns:r="urn:r"><p:sldIdLst><p:sldId id="5" r:id="slideA"/></p:sldIdLst></p:presentation>','ppt/_rels/presentation.xml.rels':'<Relationships><Relationship Id="slideA" Target="slides/slide9.xml"/></Relationships>','ppt/slides/slide9.xml':'<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>Ethical egoism considers personal interest.</a:t></a:r></a:p></p:sld>'});


const p=(t:string)=>`<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const row=(...cells:string[])=>`<w:tr>${cells.map(c=>`<w:tc>${p(c)}</w:tc>`).join('')}</w:tr>`;
const heading=(t:string)=>`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
export function representativeSyllabus(){return zipFixture({'word/document.xml':`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${p('PHIL 210 - Ethics')}${p('Fall 2026')}<w:tbl>${row('Section','3')}${row('Instructor','Dr. Sam Example')}${row('Email','sam@example.edu')}${row('Office hours','MW 2:00-3:00 PM')}${row('Class schedule','Mon / Wed 12:30–1:45 PM')}${row('Room','Post Hall 203')}</w:tbl>${heading('Grading')}<w:tbl>${row('Participation','15%')}${row('Reading quizzes','10%')}${row('Midterm','30%')}${row('Final','45%')}</w:tbl>${heading('Course Calendar')}<w:tbl>${row('Midterm','October 20, 2026')}${row('Final exam','December 15, 2026')}${row('Reflection paper','14/10/2026')}</w:tbl>${heading('Attendance Policies')}${p('Missing 20% of classes results in failure.')}</w:body></w:document>`});}
