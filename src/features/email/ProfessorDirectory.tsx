import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, ErrorText, Field, Modal, Section } from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { batch,query } from "../../services/platform";
import { refreshEmailCourseMatches } from "./repository";
interface Professor {id:string;name:string;email:string;office:string;office_hours:string;department:string;notes:string}
export function ProfessorDirectory({courseId}:{courseId?:string}) {
  const {data,refresh}=useWorkspace();
  const {data:professors=[]}=useQuery({queryKey:["professors",courseId],queryFn:()=>query<Professor>(courseId ? "SELECT p.* FROM professors p JOIN course_professors c ON c.professor_id=p.id WHERE c.course_id=? ORDER BY p.name":"SELECT * FROM professors ORDER BY name",courseId ? [courseId]:[])});
  const [editing,setEditing]=useState<Professor|null>(null),[links,setLinks]=useState<string[]>([]),[error,setError]=useState(""),[busy,setBusy]=useState(false),[deleting,setDeleting]=useState<Professor|null>(null);
  async function open(professor?:Professor) {
    setError("");
    try {setLinks(professor ? (await query<{course_id:string}>("SELECT course_id FROM course_professors WHERE professor_id=?",[professor.id])).map(r=>r.course_id):courseId ? [courseId]:[]);setEditing(professor ?? {id:crypto.randomUUID(),name:"",email:"",office:"",office_hours:"",department:"",notes:""});}catch(e){setError((e as Error).message);}
  }
  async function save() {
    if(!editing) return;
    setBusy(true);setError("");
    try {
      await batch([{sql:"INSERT INTO professors(id,name,email,office,office_hours,department,notes) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email,office=excluded.office,office_hours=excluded.office_hours,department=excluded.department,notes=excluded.notes",params:[editing.id,editing.name.trim(),editing.email.trim().toLowerCase(),editing.office,editing.office_hours,editing.department,editing.notes]},{sql:"DELETE FROM course_professors WHERE professor_id=?",params:[editing.id]},...links.map(id=>({sql:"INSERT INTO course_professors(course_id,professor_id) VALUES(?,?)",params:[id,editing.id]}))]);
      await refreshEmailCourseMatches(data);
      await refresh();setEditing(null);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <Section title="Instructors" action={<Button onClick={()=>void open()}>Add instructor</Button>}><p className="helper">Exact instructor email addresses help match messages to courses. One instructor can teach several courses.</p>{professors.map(p=><div key={p.id} className="email-account"><strong>{p.name}</strong><p className="muted">{p.email}</p>{p.office && <small>{p.office} · {p.office_hours}</small>}<div className="email-actions"><Button onClick={()=>void open(p)}>Edit instructor</Button><Button onClick={()=>setDeleting(p)}>Remove instructor</Button></div></div>)}<ErrorText error={editing ? "":error}/>
    {editing && <Modal title="Instructor details" onClose={()=>setEditing(null)}><form onSubmit={e=>{e.preventDefault();void save();}}><div className="modal-body">{([['name','Name'],['email','Email'],['office','Office'],['office_hours','Office hours'],['department','Department'],['notes','Notes']] as const).map(([key,label])=><Field label={label} key={key}><input required={key==='name' || key==='email'} type={key==='email' ? 'email':'text'} value={editing[key]} onChange={e=>setEditing({...editing,[key]:e.target.value})}/></Field>)}<p>Courses taught</p>{data.courses.map(c=><label className="email-checkbox" key={c.id}><input type="checkbox" checked={links.includes(c.id)} onChange={e=>setLinks(e.target.checked ? [...links,c.id]:links.filter(id=>id!==c.id))}/>{c.code}</label>)}<ErrorText error={error}/></div><div className="modal-footer"><Button type="button" onClick={()=>setEditing(null)}>Cancel</Button><Button variant="primary" disabled={busy}>Save instructor</Button></div></form></Modal>}
    {deleting && <Modal title="Remove instructor?" onClose={()=>setDeleting(null)}><div className="modal-body"><p>Remove {deleting.name} from the instructor directory and course links? Existing emails and academic records remain.</p></div><div className="modal-footer"><Button onClick={()=>setDeleting(null)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={async()=>{setBusy(true);try{await batch([{sql:"DELETE FROM professors WHERE id=?",params:[deleting.id]}]);await refresh();setDeleting(null);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Remove instructor</Button></div></Modal>}
  </Section>;
}
