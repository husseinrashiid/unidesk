import {useEffect,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button,Empty,ErrorText,Field,Modal,Section} from '../../components/ui';
import {query,fileAction} from '../../services/platform';
import {categories} from '../../types';
import {queueDocument,removeDocument} from './indexer';
import {DocumentSearchService} from './search';
import {readingSections} from './reading';
import {sourceLocation,type Chunk,type DocumentRecord} from './types';
import {useWorkspace} from '../../hooks/useWorkspace';

export function useDocuments(courseId:string){return useQuery({queryKey:['documents',courseId],queryFn:()=>query<DocumentRecord>('SELECT d.*,f.filename,f.category FROM documents d JOIN files f ON f.id=d.file_id WHERE d.course_id=? ORDER BY f.filename',[courseId])});}
export function DocumentActions({fileId,onBrowse,onSearch}:{fileId:string;onBrowse:()=>void;onSearch:()=>void}){
 const client=useQueryClient();const [error,setError]=useState('');
 const {navigate}=useWorkspace();
 async function ai(kind:string){try{const [file]=await query<{course_id:string}>('SELECT course_id FROM files WHERE id=?',[fileId]);if(file)navigate(`course/${file.course_id}/Ask/${fileId}/${kind}`);}catch(e){setError((e as Error).message);}}
 async function run(remove:boolean){try{setError('');if(remove)await removeDocument(fileId);else await queueDocument(fileId);await client.invalidateQueries({queryKey:['documents']});await client.invalidateQueries({queryKey:['material-search']});}catch(e){setError((e as Error).message);}}
 return <><button onClick={onSearch}>Search within</button><button onClick={onBrowse}>View extracted text</button><button onClick={()=>void ai('ask')}>Ask about document</button><button onClick={()=>void ai('summary')}>Summarize</button><button onClick={()=>void ai('notes')}>Generate study notes</button><button onClick={()=>void run(false)}>Index / Re-index</button><button onClick={()=>void run(true)}>Remove from index</button>{error && <span role="alert">{error}</span>}</>;
}
export function Materials({courseId,initialFileId=''}:{courseId:string;initialFileId?:string}){
 const [search,setSearch]=useState(''),[debounced,setDebounced]=useState(''),[category,setCategory]=useState(''),[fileId,setFileId]=useState(initialFileId),[offset,setOffset]=useState(0),[error,setError]=useState('');
 const [preview,setPreview]=useState<{fileId:string;index:number}|null>(null);
 const {data:documents=[],error:loadError}=useDocuments(courseId);
 useEffect(()=>{const t=setTimeout(()=>setDebounced(search),180);return()=>clearTimeout(t);},[search]);
 const {data:results=[],isFetching,error:searchError}=useQuery({queryKey:['material-search',courseId,debounced,category,fileId,offset],queryFn:()=>DocumentSearchService.search(debounced,{courseId,category,fileId,offset})});
 function openDocument(id:string,index=0){const doc=documents.find(d=>d.file_id===id);if(doc?.filename.toLowerCase().endsWith('.pdf'))void fileAction(id,'open').catch(e=>setError((e as Error).message));else setPreview({fileId:id,index});}
 const client=useQueryClient();
 async function reindex(id:string){try{await queueDocument(id);await client.invalidateQueries({queryKey:['documents']});}catch(e){setError((e as Error).message);}}
 const indexed=documents.filter(d=>d.status==='Indexed').length,queued=documents.filter(d=>['Pending','Indexing','Stale'].includes(d.status)).length;
 return <div className="material-search">
  <Section title="Search materials"><p className="helper">Search inside your course documents, entirely on this device. PDF pages, slide numbers, and detected sections stay attached to each passage.</p>
   <div className="material-filters"><Field label="Search course materials"><input type="search" value={search} onChange={e=>{setSearch(e.target.value);setOffset(0);}} placeholder="Topic or phrase…"/></Field><Field label="Material category"><select value={category} onChange={e=>{setCategory(e.target.value);setOffset(0);}}><option value="">All material</option>{categories.filter(c=>c!=='Recordings' && c!=='Resources').map(c=><option key={c}>{c}</option>)}</select></Field><Field label="Document scope"><select value={fileId} onChange={e=>{setFileId(e.target.value);setOffset(0);}}><option value="">All course documents</option>{documents.map(d=><option value={d.file_id} key={d.id}>{d.filename}</option>)}</select></Field></div>
   <p className="helper" role="status">{indexed} indexed · {queued ? `${queued} queued or indexing`:'Index up to date'}{isFetching?' · Searching…':''}</p>
   <ErrorText error={(searchError??loadError)?.message || error}/>
   {!debounced.trim() && documents.filter(d=>(!fileId || d.file_id===fileId) && (!category || d.category===category)).map(d=><article className="material-result" key={d.id}><button className="material-result-title" onClick={()=>openDocument(d.file_id)}>{d.filename}</button><p className="helper">{d.page_count ? `${d.page_count} pages` : d.word_count ? `${d.word_count.toLocaleString()} words` : d.status}</p><div className="form-actions"><Button onClick={()=>openDocument(d.file_id)}>Read document</Button><Button variant="ghost" onClick={()=>void fileAction(d.file_id,'open').catch(e=>setError((e as Error).message))}>Open original</Button></div></article>)}
   {debounced.trim() && results.slice(0,30).map(r=><article className="material-result" key={r.id}><button className="material-result-title" onClick={()=>openDocument(r.file_id,r.chunk_index)}>{r.filename}</button><small>{sourceLocation(r)} · {r.category}</small><p>{r.excerpt}</p><Button variant="ghost" onClick={()=>void fileAction(r.file_id,'open').catch(e=>setError((e as Error).message))}>Open original</Button></article>)}
   {!(debounced.trim() ? results.length : documents.filter(d=>(!fileId || d.file_id===fileId) && (!category || d.category===category)).length) && <Empty title={debounced?'No matching passages':'No indexed text yet'} description={debounced?'Try fewer words or a different category. Only successfully indexed material is searched.':'Supported course files index in the background. You can inspect their status below.'}/>}
   {debounced.trim() && (offset>0 || results.length>30) && <div className="form-actions"><Button disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-30))}>Previous results</Button><span className="helper">Page {Math.floor(offset/30)+1}</span><Button disabled={results.length<=30} onClick={()=>setOffset(offset+30)}>Next results</Button></div>}
  </Section>
  <details className="material-index"><summary>Document index · {documents.length} supported files</summary><p className="helper">PDF, DOCX, PPTX, TXT, and Markdown. Scanned PDFs need searchable text; OCR is not included. Removing an index preserves the original and stops automatic indexing until you choose Re-index.</p>{documents.map(d=><div className="material-index-row" key={d.id}><div><strong>{d.filename}</strong><small>{d.status==='Removed'?'Not indexed':d.status} {d.word_count && d.status==='Indexed'?`· ${d.word_count.toLocaleString()} words`:''}</small>{d.last_error && <p className="helper">{d.last_error}</p>}{d.status==='Text unavailable' && <p className="helper">No readable text was found. You can still open this file normally.</p>}</div><div className="form-actions"><Button onClick={()=>openDocument(d.file_id)}>Read document</Button><Button disabled={d.status==='Indexing'} onClick={()=>void reindex(d.file_id)}>Re-index</Button></div></div>)}</details>
  {preview && <DocumentText fileId={preview.fileId} courseId={courseId} initialIndex={preview.index} onClose={()=>setPreview(null)}/>}
 </div>;
}
export function DocumentText({fileId,courseId,initialIndex=0,onClose}:{fileId:string;courseId:string;initialIndex?:number;onClose:()=>void}){
 const {data:documents=[]}=useDocuments(courseId);const document=documents.find(d=>d.file_id===fileId);
 const [error,setError]=useState('');
 const {data:chunks=[],isLoading,error:loadError}=useQuery({queryKey:['document-reading',fileId,document?.indexed_at],queryFn:()=>query<Chunk>('SELECT * FROM document_chunks WHERE document_id=? AND course_id=? ORDER BY chunk_index',[fileId,courseId])});
 const sections=readingSections(chunks);
 useEffect(()=>{if(chunks.length && initialIndex>0){const section=[...sections].reverse().find(s=>s.index<=initialIndex);if(section)window.document.getElementById('reading-section-'+section.index)?.scrollIntoView({block:'start'});}},[chunks,initialIndex]);
 return <Modal title={document?.filename??'Document reader'} wide onClose={onClose}><div className="modal-body"><div className="form-actions"><Button onClick={()=>void fileAction(fileId,'open').catch(e=>setError((e as Error).message))}>Open original file</Button></div><p className="helper">Full extracted text. Open the original to see the exact PDF layout and tables.</p><ErrorText error={error||loadError?.message||document?.last_error||''}/>{isLoading ? <p role="status">Loading document...</p> : document?.status==='Indexed' ? <article className="document-reader">{sections.map(s=><section id={'reading-section-'+s.index} key={s.index}><small className="reading-page">{s.label}</small><div className="reading-text">{s.text}</div></section>)}</article> : <Empty title="Text unavailable" description="Wait for indexing or choose Re-index. The original file remains available."/>}</div><div className="modal-footer"><Button onClick={onClose}>Close</Button></div></Modal>;
}
