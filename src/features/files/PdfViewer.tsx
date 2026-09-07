import {useEffect,useRef,useState} from 'react';
import {getDocument,GlobalWorkerOptions,type PDFDocumentLoadingTask} from 'pdfjs-dist';
import {EventBus,PDFViewer,PDFLinkService,PDFFindController} from 'pdfjs-dist/web/pdf_viewer.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import {Button,Modal,ErrorText} from '../../components/ui';
import {command} from '../../services/platform';
GlobalWorkerOptions.workerSrc=workerUrl;
type PdfFile={id:string;filename:string};
export function PdfHost(){
 const [file,setFile]=useState<PdfFile|null>(null);
 useEffect(()=>{const open=(e:Event)=>setFile((e as CustomEvent<PdfFile>).detail);window.addEventListener('unidesk:pdf',open);return()=>window.removeEventListener('unidesk:pdf',open);},[]);
 return file ? <PdfReader key={file.id} file={file} onClose={()=>setFile(null)}/> : null;
}
function PdfReader({file,onClose}:{file:PdfFile;onClose:()=>void}){
 const container=useRef<HTMLDivElement>(null),viewerElement=useRef<HTMLDivElement>(null);
 const viewer=useRef<PDFViewer|null>(null),bus=useRef<EventBus|null>(null);
 const [error,setError]=useState(''),[pages,setPages]=useState(0),[page,setPage]=useState(1),[search,setSearch]=useState(''),[matches,setMatches]=useState(''),[password,setPassword]=useState('');
 const [unlock,setUnlock]=useState<((password:string)=>void)|null>(null);
 useEffect(()=>{
  let cancelled=false,task:PDFDocumentLoadingTask|undefined;
  const eventBus=new EventBus();bus.current=eventBus;
  const links=new PDFLinkService({eventBus});
  const find=new PDFFindController({eventBus,linkService:links});
  const pdfViewer=new PDFViewer({container:container.current!,viewer:viewerElement.current!,eventBus,linkService:links,findController:find,annotationMode:0});
  viewer.current=pdfViewer;links.setViewer(pdfViewer);
  eventBus.on('pagesinit',()=>{pdfViewer.currentScaleValue='page-width';});
  eventBus.on('pagechanging',({pageNumber}:{pageNumber:number})=>setPage(pageNumber));
  eventBus.on('updatefindmatchescount',({matchesCount}:{matchesCount:{current:number;total:number}})=>setMatches(`${matchesCount.current} / ${matchesCount.total}`));
  eventBus.on('updatefindcontrolstate',({state}:{state:number})=>{if(state===1)setMatches('No matches');});
  void command<string>('read_pdf',{id:file.id}).then(encoded=>{
   if(cancelled)return;
   task=getDocument({data:Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),cMapUrl:'/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdfjs/standard_fonts/',wasmUrl:'/pdfjs/wasm/'});
   task.onPassword=(update:(password:string)=>void)=>{setUnlock(()=>update);};
   return task.promise.then(pdf=>{if(cancelled)return;setUnlock(null);setPages(pdf.numPages);links.setDocument(pdf);pdfViewer.setDocument(pdf);});
  }).catch(e=>{if(!cancelled)setError(e instanceof Error ? e.message : 'Unable to open this PDF.');});
  return()=>{cancelled=true;pdfViewer.setDocument(null!);links.setDocument(null!);void task?.destroy();viewer.current=null;bus.current=null;};
 },[file.id]);
 function findAgain(previous=false){bus.current?.dispatch('find',{source:null,type:'again',query:search,caseSensitive:false,entireWord:false,highlightAll:true,findPrevious:previous,matchDiacritics:false});}
 return <Modal title={file.filename} wide onClose={onClose}><div className="pdf-workspace"><div className="pdf-toolbar"><Button disabled={page<=1} onClick={()=>{if(viewer.current)viewer.current.currentPageNumber=page-1;}}>Previous page</Button><label>Page <input aria-label="PDF page" type="number" min={1} max={pages||1} value={page} onChange={e=>{const n=Number(e.target.value);if(viewer.current && n>=1 && n<=pages)viewer.current.currentPageNumber=n;}}/></label><span>of {pages||'…'}</span><Button disabled={!pages||page>=pages} onClick={()=>{if(viewer.current)viewer.current.currentPageNumber=page+1;}}>Next page</Button><Button disabled={!pages} aria-label="Zoom out" onClick={()=>{if(viewer.current)viewer.current.currentScale=Math.max(.25,viewer.current.currentScale/1.2);}}>−</Button><Button disabled={!pages} aria-label="Zoom in" onClick={()=>{if(viewer.current)viewer.current.currentScale=Math.min(4,viewer.current.currentScale*1.2);}}>+</Button><Button disabled={!pages} onClick={()=>{if(viewer.current)viewer.current.currentScaleValue='page-width';}}>Fit width</Button><Button onClick={()=>void command('file_action',{id:file.id,action:'open'}).catch(e=>setError((e as Error).message))}>Open externally</Button></div><form className="pdf-toolbar" onSubmit={e=>{e.preventDefault();findAgain();}}><input aria-label="Find in PDF" placeholder="Find in PDF" value={search} onChange={e=>{setSearch(e.target.value);setMatches('');}}/><Button disabled={!pages||!search}>Find next</Button><Button type="button" disabled={!pages||!search} onClick={()=>findAgain(true)}>Find previous</Button><span role="status">{matches}</span></form><ErrorText error={error}/>{unlock && <form className="pdf-toolbar" onSubmit={e=>{e.preventDefault();unlock(password);setPassword('');}}><input type="password" aria-label="PDF password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="PDF password"/><Button>Unlock PDF</Button></form>}{!pages&&!error&&!unlock&&<p role="status">Loading PDF…</p>}<div className="pdf-stage"><div className="pdf-scroll" ref={container}><div className="pdfViewer" ref={viewerElement}/></div></div></div></Modal>;
}
