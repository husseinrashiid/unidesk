import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, ErrorText, Field, Section } from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { batch,query } from "../../services/platform";
import type { Email,EmailAction } from "./types";
export function EmailContext({email,onSelect}:{email:Email;onSelect:(id:string)=>void}) {
  const {navigate,refresh}=useWorkspace();
  const [error,setError]=useState("");
  const {data:thread=[]}=useQuery({queryKey:["email-thread",email.account_id,email.provider_thread_id],enabled:!!email.provider_thread_id,queryFn:()=>query<Email>("SELECT id,subject,sender_email,received_at FROM emails WHERE account_id=? AND provider_thread_id=? ORDER BY received_at,id LIMIT 100",[email.account_id,email.provider_thread_id])});
  const {data:related=[]}=useQuery({queryKey:["email-related",email.id],queryFn:()=>query<EmailAction>("SELECT * FROM email_detected_actions WHERE email_id=? AND entity_id IS NOT NULL AND status IN ('Pending','Applied')",[email.id])});
  const {data:next=[]}=useQuery({queryKey:["email-review-next",email.id],queryFn:()=>query<{id:string}>("SELECT id FROM emails WHERE archived=0 AND requires_review=1 AND id<>? ORDER BY received_at,id LIMIT 1",[email.id])});
  async function classify(field:'importance'|'academic_type',value:string) {try{await batch([{sql:`UPDATE emails SET ${field}=?,classification_manual=1 WHERE id=?`,params:[value,email.id]},...(field==='importance' ? [{sql:"UPDATE notifications SET priority=?,delivered=CASE WHEN ? IN ('Normal','Low') THEN 1 ELSE delivered END,read=CASE WHEN ?='Low' THEN 1 ELSE read END WHERE type='email' AND entity_id=?",params:[value,value,value,email.id]}]:[])]);await refresh();}catch(e){setError((e as Error).message);}}
  return <><details className="email-registration"><summary>Correct message classification</summary><Field label="Email importance"><select value={email.importance} onChange={e=>void classify('importance',e.target.value)}>{['Critical','Important','Normal','Low'].map(v=><option key={v}>{v}</option>)}</select></Field><Field label="Academic message type"><select value={email.academic_type} onChange={e=>void classify('academic_type',e.target.value)}>{['Exam announcement','Exam change','Assignment announcement','Deadline change','Quiz','Class cancellation','Class reschedule','Room change','Course material','Grade / feedback','Administrative','General course','Unknown'].map(v=><option key={v}>{v}</option>)}</select></Field><p className="helper">Your type and importance selections are retained during reanalysis. Academic suggestions still require individual review.</p></details><ErrorText error={error}/>
    {!!related.length && <Section title="Related academic records">{related.map(r=><Button key={r.id} variant="ghost" onClick={()=>navigate(r.entity_type==='grade' ? `course/${r.course_id}/Grades`:r.entity_type==='schedule' ? `course/${r.course_id}/Schedule`:r.entity_type==='event' ? 'calendar':`${r.entity_type}/${r.entity_id}`)}>{r.entity_type} · {r.action_type} · {r.status}</Button>)}</Section>}
    {thread.length>1 && <Section title="Conversation · cached messages">{thread.map(m=><button key={m.id} disabled={m.id===email.id} className="email-attention-row" onClick={()=>onSelect(m.id)}><span>{m.subject}<small>{m.sender_email} · {new Date(m.received_at).toLocaleString()}</small></span></button>)}</Section>}
    {!!next.length && <Button onClick={()=>onSelect(next[0].id)}>Review next email</Button>}
  </>;
}
