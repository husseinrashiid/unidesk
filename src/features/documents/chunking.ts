import type {Chunk,Segment} from './types';
// Keep page/slide boundaries exact. Combine small paragraphs only within the same section.
// A moderate character limit is language-independent and also bounds unbroken OCR-like text.
const TARGET=2200,MAX=3000,OVERLAP=260;
export function chunkDocument(documentId:string,courseId:string,segments:Segment[]):Chunk[] {
 const groups:Segment[]=[];
 for(const source of segments) {
  const text=source.text.replace(/\r\n?/g,'\n').replace(/\u0000/g,'').trim();if(!text)continue;
  const previous=groups.at(-1);
  if(previous && !source.page && !source.slide && !source.line_start && !previous.page && !previous.slide && !previous.line_start && previous.heading===source.heading && previous.text.length+text.length<TARGET) previous.text+='\n\n'+text;
  else groups.push({...source,text});
 }
 const chunks:Chunk[]=[];
 for(const group of groups) {
  let start=0;
  while(start<group.text.length) {
   let end=Math.min(start+MAX,group.text.length);
   if(end<group.text.length) {
    const window=group.text.slice(start+TARGET,end);
    const boundary=Array.from(window.matchAll(/[.!?。！？](?:\s|$)|\n/g)).at(-1);
    if(boundary)end=start+TARGET+boundary.index!+boundary[0].length;
    else {const space=group.text.lastIndexOf(' ',end);if(space>start+TARGET)end=space;}
    // Never cut a UTF-16 surrogate pair.
    if(/[\uD800-\uDBFF]/.test(group.text[end-1]))end--;
   }
   const text=group.text.slice(start,end).trim();
   if(text)chunks.push({id:`${documentId}:${chunks.length}`,document_id:documentId,course_id:courseId,chunk_index:chunks.length,text,page_start:group.page,page_end:group.page,slide_start:group.slide,slide_end:group.slide,heading:group.heading,line_start:group.line_start,line_end:group.line_end});
   if(end>=group.text.length)break;
   let next=Math.max(start+1,end-OVERLAP);const space=group.text.indexOf(' ',next);if(space>=0 && space<end)next=space+1;
   if(/[\uDC00-\uDFFF]/.test(group.text[next]))next++;
   start=next;
  }
 }
 return chunks;
}
