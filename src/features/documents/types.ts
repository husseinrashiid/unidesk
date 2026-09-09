export interface Segment {cells?:string[]|null;text:string;page:number|null;slide:number|null;heading:string|null;line_start:number|null;line_end:number|null}
export interface Extraction {content_hash:string;extractor_version:string;segments:Segment[];word_count:number;page_count:number|null;slide_count:number|null;status:'Extracted'|'Text unavailable'}
export interface ExtractedFile {file_id:string;fingerprint:string;extraction:Extraction}
export interface DocumentRecord {id:string;file_id:string;course_id:string;status:string;enabled:number;content_hash:string;fingerprint:string;word_count:number;page_count:number|null;slide_count:number|null;last_error:string;indexed_at:string|null;filename:string;category:string}
export interface Chunk {id:string;document_id:string;course_id:string;chunk_index:number;text:string;page_start:number|null;page_end:number|null;slide_start:number|null;slide_end:number|null;heading:string|null;line_start:number|null;line_end:number|null}
export interface MaterialResult extends Chunk {file_id:string;filename:string;category:string;excerpt:string;content_hash:string}
export const supportedDocument=(extension:string)=>/^(pdf|docx|pptx|txt|md|markdown)$/i.test(extension.replace(/^\./,''));
export function sourceLocation(s:Pick<Chunk,'page_start'|'page_end'|'slide_start'|'slide_end'|'heading'|'line_start'|'line_end'>) {
 const range=(a:number,b:number|null)=>b && b!==a ? `${a}–${b}`:String(a);
 if(s.page_start)return `Page ${range(s.page_start,s.page_end)}`;
 if(s.slide_start)return `Slide ${range(s.slide_start,s.slide_end)}`;
 return [s.heading ? `Section: ${s.heading}`:'',s.line_start ? `Lines ${range(s.line_start,s.line_end)}`:''].filter(Boolean).join(' · ') || 'Document text';
}
