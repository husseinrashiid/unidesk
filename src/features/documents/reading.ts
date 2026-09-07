import type { Chunk } from './types';
import { sourceLocation } from './types';
export function readingSections(chunks: Chunk[]) {
  const sections: {label:string;text:string;index:number}[]=[];
  for(const chunk of chunks) {
    const label=sourceLocation(chunk);
    const previous=sections.at(-1);
    if(previous && previous.label===label) {
      let overlap=0;
      for(let n=Math.min(300,previous.text.length,chunk.text.length);n>=20;n--) {
        if(previous.text.endsWith(chunk.text.slice(0,n))){overlap=n;break;}
      }
      previous.text+=overlap ? chunk.text.slice(overlap) : '\n\n'+chunk.text;
    } else sections.push({label,text:chunk.text,index:chunk.chunk_index});
  }
  return sections;
}
