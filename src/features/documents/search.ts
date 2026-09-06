import {query} from '../../services/platform';
import type {SqlValue} from '../../types';
import type {MaterialResult} from './types';
export interface SearchScope {courseId:string;category?:string;fileId?:string;offset?:number}
export function materialSearchQuery(text:string,scope:SearchScope){
 const terms=(text.match(/[\p{L}\p{N}]+/gu)??[]).slice(0,20);
 const clauses=['d.course_id=?',"d.status='Indexed'",'d.enabled=1'];const params:SqlValue[]=[scope.courseId];
 if(scope.category){clauses.push('f.category=?');params.push(scope.category);}
 if(scope.fileId){clauses.push('f.id=?');params.push(scope.fileId);}
 // Literal words cannot execute FTS operators. All terms must occur in a passage.
 if(terms.length){clauses.push('document_chunks_fts MATCH ?');params.push(terms.map(t=>`"${t}"`).join(' AND '));}
 else if(text.trim())clauses.push('0');
 const from=terms.length?'document_chunks_fts JOIN document_chunks c ON c.rowid=document_chunks_fts.rowid':'document_chunks c';
 const excerpt=terms.length?"snippet(document_chunks_fts,0,'','',' … ',48)":"substr(c.text,1,350)";
 return {sql:`SELECT c.*,d.file_id,d.content_hash,f.filename,f.category,${excerpt} AS excerpt FROM ${from} JOIN documents d ON d.id=c.document_id JOIN files f ON f.id=d.file_id WHERE ${clauses.join(' AND ')} ORDER BY ${terms.length?'bm25(document_chunks_fts,1,2),':''}f.filename,c.chunk_index LIMIT 31 OFFSET ?`,params:[...params,Math.max(0,Math.floor(scope.offset??0))]};
}
// Retrieval boundary also serves future cloud AI; search itself is entirely local.
export const DocumentSearchService={search(text:string,scope:SearchScope){const q=materialSearchQuery(text,scope);return query<MaterialResult>(q.sql,q.params);}};
