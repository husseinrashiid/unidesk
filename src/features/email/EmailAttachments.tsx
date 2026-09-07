import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, ErrorText, Field, Modal, Section } from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { fileAction, query } from "../../services/platform";
import { categories, type Category } from "../../types";
import type { Email, EmailAccount } from "./types";
import { fetchAttachmentMetadata, recordSavedAttachment, suggestedCategory, unsafeToOpen, type EmailAttachment } from "./attachments";
import { saveEmailAttachment } from "./provider";
export function EmailAttachments({email,account}:{email:Email;account?:EmailAccount}) {
  const {refresh}=useWorkspace();
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const [selected,setSelected]=useState<EmailAttachment|null>(null),[opening,setOpening]=useState<EmailAttachment|null>(null);
  const {data:rows=[]}=useQuery({queryKey:["email-attachments",email.id],queryFn:()=>query<EmailAttachment>("SELECT * FROM email_attachments WHERE email_id=? ORDER BY filename",[email.id])});
  async function run(work:()=>Promise<unknown>) {setBusy(true);setError("");try{await work();await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <Section title="Attachments"><p className="helper">Attachments download only when you choose Save to course. Saved copies remain available after disconnecting or clearing email cache.</p><Button disabled={busy || !account?.connected} onClick={()=>void run(async()=>setMessage(await fetchAttachmentMetadata(email,account!)))}>Load attachment list</Button><p className="helper">{message}</p>{rows.map(a=><div className="email-attachment-row" key={a.id}><div><strong>{a.filename}</strong><small>{(a.size/1024).toFixed(0)} KB · {a.file_id ? "Saved locally":a.attachment_type==='file' ? "Not downloaded":"Embedded item · use Outlook"}</small></div><div className="email-actions">{a.file_id && <Button disabled={busy} onClick={()=>unsafeToOpen(a.filename) ? setOpening(a):void run(()=>fileAction(a.file_id!,"open"))}>Open saved file</Button>}<Button disabled={busy || a.attachment_type!=='file' || (!account?.connected && !a.file_id)} onClick={()=>setSelected(a)}>{a.file_id ? "Link saved file":"Save to course"}</Button></div></div>)}<ErrorText error={error}/>
    {selected && <SaveAttachment email={email} attachment={selected} onClose={()=>setSelected(null)}/>}
    {opening && <Modal title="Open executable attachment?" onClose={()=>setOpening(null)}><div className="modal-body"><p>{opening.filename} can run code on your device. Open it only if you expected this file and trust its contents.</p></div><div className="modal-footer"><Button onClick={()=>setOpening(null)}>Cancel</Button><Button variant="danger" onClick={()=>void run(async()=>{await fileAction(opening.file_id!,"open");setOpening(null);})}>Open with Windows</Button></div></Modal>}
  </Section>;
}
function SaveAttachment({email,attachment,onClose}:{email:Email;attachment:EmailAttachment;onClose:()=>void}) {
  const {data,refresh,report}=useWorkspace();
  const [course,setCourse]=useState(email.course_id ?? ""),[category,setCategory]=useState<Category>(suggestedCategory(attachment.filename));
  const [linkKind,setLinkKind]=useState("none"),[linkId,setLinkId]=useState(""),[title,setTitle]=useState(attachment.filename.replace(/\.[^.]+$/,"")),[due,setDue]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[conflict,setConflict]=useState(false);
  const [fileId,setFileId]=useState(attachment.file_id);
  const {data:savedFiles=[]}=useQuery({queryKey:["email-saved-file",attachment.file_id],enabled:!!attachment.file_id,queryFn:()=>query<{course_id:string;category:Category}>("SELECT course_id,category FROM files WHERE id=?",[attachment.file_id!])});
  useEffect(()=>{if(savedFiles[0]){setCourse(savedFiles[0].course_id);setCategory(savedFiles[0].category);}},[savedFiles]);
  const {data:lectures=[]}=useQuery({queryKey:["email-link-lectures",course],queryFn:()=>query<{id:string;title:string}>("SELECT id,title FROM lectures WHERE course_id=? ORDER BY number,lecture_date",[course])});
  const c=data.courses.find(c=>c.id===course);
  async function save(choice?:string) {
    setBusy(true);setError("");
    try {
      if((linkKind==='lecture' || linkKind==='exam') && !linkId) throw Error("Choose the record to link.");
      let saved=fileId;
      if(!saved) {
        const result=await saveEmailAttachment(attachment.id,course,category,choice);
        if(result.conflict) {setConflict(true);return;}
        if(!result.id) return;
        saved=result.id;setFileId(saved);
      }
      await recordSavedAttachment(email,attachment,saved,course,linkKind,linkId,title,due);
      await refresh();report("Attachment saved in course storage.");onClose();
    } catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <Modal title={`Save ${attachment.filename}`} onClose={onClose}><div className="modal-body"><Field label="Destination course"><select disabled={!!fileId} value={course} onChange={e=>{setCourse(e.target.value);setLinkId("");setConflict(false);}}><option value="">Select a course</option>{data.courses.map(c=><option value={c.id} key={c.id}>{c.code}</option>)}</select></Field><Field label="File category"><select disabled={!!fileId} value={category} onChange={e=>{setCategory(e.target.value as Category);setConflict(false);}}>{categories.map(c=><option key={c}>{c}</option>)}</select></Field><p className="helper">{fileId ? attachment.local_path : c ? `${c.folder_path}\\${category}\\${attachment.filename}`:"Select a course to see its destination."}</p><Field label="Also link material"><select value={linkKind} onChange={e=>{setLinkKind(e.target.value);setLinkId("");}}><option value="none">Save file only</option><option value="reading">Create a reading</option><option value="lecture">Link to a lecture</option><option value="exam">Link to an exam</option></select></Field>{linkKind==='reading' && <><Field label="Reading title"><input value={title} onChange={e=>setTitle(e.target.value)}/></Field><Field label="Reading due date (optional)"><input type="date" value={due} onChange={e=>setDue(e.target.value)}/></Field></>}{(linkKind==='lecture' || linkKind==='exam') && <Field label="Link to record"><select value={linkId} onChange={e=>setLinkId(e.target.value)}><option value="">Select a record</option>{(linkKind==='lecture' ? lectures:data.exams.filter(e=>e.course_id===course)).map(r=><option key={r.id} value={r.id}>{r.title}</option>)}</select></Field>}
    {conflict && <div role="status"><p>A file with this name already exists. Choose how to save it.</p><div className="email-actions"><Button disabled={busy} onClick={()=>void save('keep')}>Keep both</Button><Button variant="danger" disabled={busy} onClick={()=>void save('replace')}>Replace existing file</Button></div></div>}<ErrorText error={error}/></div><div className="modal-footer"><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !course || conflict} onClick={()=>void save()}>{busy ? "Saving…":fileId ? "Save link":"Save attachment"}</Button></div></Modal>;
}
