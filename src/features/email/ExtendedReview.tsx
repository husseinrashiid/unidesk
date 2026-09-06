import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, ErrorText, Field } from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { batch, query } from "../../services/platform";
import { applyStatements, ignoreAction } from "./repository";
import type { ActionPayload, Email, EmailAction } from "./types";

export function ExtendedReview({email,action}:{email:Email;action:EmailAction}) {
  const {data,refresh,report,edit}=useWorkspace();
  const payload=JSON.parse(action.payload_json) as ActionPayload;
  const [course,setCourse]=useState(action.course_id ?? ""),[target,setTarget]=useState(action.entity_id ?? "");
  const [values,setValues]=useState(payload.proposed),[expected,setExpected]=useState(payload.expected);
  const [create,setCreate]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const kind=action.entity_type;
  const {data:grades=[]}=useQuery({queryKey:["email-grade-targets",course],enabled:kind==="grade",queryFn:()=>query<Record<string,string|number|null>>("SELECT * FROM grade_items WHERE course_id=? ORDER BY title",[course])});
  const {data:categories=[]}=useQuery({queryKey:["email-grade-components",course],enabled:kind==="grade",queryFn:()=>query<{id:string;name:string}>("SELECT id,name FROM grade_categories WHERE course_id=? ORDER BY sort_order,name",[course])});
  const records=kind==="grade" ? grades : data.events.filter(e=>(e.course_id ?? "")===course);
  const snapshot=JSON.parse(expected.record ?? "{}");
  const meeting=JSON.parse(expected.schedule ?? "{}");
  const set=(key:string,value:string)=>setValues(previous=>({...previous,[key]:value}));
  async function run(work:()=>Promise<unknown>) {setBusy(true);setError("");try{await work();await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  function selectMeeting(id:string,date=values.date) {
    const schedule=data.schedules.find(s=>s.id===id && s.course_id===course);
    const exception=data.scheduleExceptions?.find(e=>e.course_id===course && e.date===date && e.original_start_time===schedule?.start_time);
    setTarget(exception?.id ?? "");setCreate(false);
    setExpected({schedule:JSON.stringify(schedule ?? {}),record:JSON.stringify(exception ?? {})});
    setValues(previous=>({...previous,date,schedule_id:id,new_start_time:previous.new_start_time || schedule?.start_time || "",new_end_time:previous.new_end_time || schedule?.end_time || ""}));
  }
  const textField=(key:string,label:string,type="text")=><Field label={label} key={key}><input type={type} value={values[key] ?? snapshot[key] ?? ""} onChange={e=>set(key,e.target.value)}/></Field>;
  if(values.permanent==="true") return <article className="email-proposal"><h3>Recurring schedule change needs manual review</h3><p>{payload.explanation}</p><p className="helper">Source: {email.subject} · {email.sender_email}</p><div className="email-actions"><Button disabled={!course} onClick={()=>edit({kind:"course",id:course})}>Review weekly course schedule</Button><Button disabled={busy} onClick={()=>void run(()=>ignoreAction(action))}>Dismiss after manual review</Button></div><ErrorText error={error}/></article>;
  return <article className="email-proposal"><h3>{action.action_type}</h3><p>{payload.explanation}</p><p className="helper">{action.confidence} confidence · {email.sender_email} · {new Date(email.received_at).toLocaleString()}</p>
    <Field label="Course for this change"><select value={course} onChange={e=>{setCourse(e.target.value);setTarget("");setExpected({});setCreate(false);setValues({...payload.proposed,category_id:"",schedule_id:""});}}><option value="">{kind==="event" ? "University / personal":"Select a course"}</option>{data.courses.map(c=><option value={c.id} key={c.id}>{c.code}</option>)}</select></Field>
    {kind==="schedule" ? <>
      <Field label="Original class date"><input type="date" value={values.date ?? ""} onChange={e=>selectMeeting(values.schedule_id,e.target.value)}/></Field>
      <Field label="Original weekly meeting"><select value={values.schedule_id ?? ""} onChange={e=>selectMeeting(e.target.value)}><option value="">Select the meeting</option>{data.schedules.filter(s=>s.course_id===course).map(s=><option key={s.id} value={s.id}>{["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][s.day_of_week]} · {s.start_time}–{s.end_time}</option>)}</select></Field>
    </> : <><Field label="Existing academic record"><select value={target} onChange={e=>{setTarget(e.target.value);setCreate(false);const record=records.find(r=>r.id===e.target.value);setExpected({record:JSON.stringify(record ?? {})});setValues({...payload.proposed,...(record ? {title:String(record.title)}:{}),...(kind==="grade" && record ? {category_id:String((record as Record<string,unknown>).category_id)}:{})});}}><option value="">Select a record</option>{records.map(r=><option key={String(r.id)} value={String(r.id)}>{String(r.title)}</option>)}</select></Field>{!target && <label className="email-checkbox"><input type="checkbox" checked={create} onChange={e=>setCreate(e.target.checked)}/>Create a new {kind=== 'grade' ? 'grade item':'calendar event'} instead</label>}</>}
    <div className="email-change-grid"><div><h4>Current</h4>{kind==="schedule" ? <><p>{values.date || "Select date"} · {meeting.start_time}–{meeting.end_time}</p><p>{data.courses.find(c=>c.id===course)?.room || "No default room"}</p>{snapshot.exception_type && <p>Existing exception: {snapshot.exception_type} · {snapshot.new_date} {snapshot.new_start_time} · {snapshot.room}</p>}</>:<><p>{snapshot.title || "No record selected"}</p>{kind==="grade" ? <p>{snapshot.points_earned ?? "Ungraded"} / {snapshot.points_possible ?? "—"}</p>:<p>{snapshot.start_datetime || "—"} · {snapshot.location}</p>}</>}</div><div><h4>Proposed</h4>
      {kind!=="schedule" && textField("title","Proposed title")}
      {kind==="event" && <>{textField("start_datetime","Event start","datetime-local")}{textField("end_datetime","Event end (optional)","datetime-local")}<label className="email-checkbox"><input type="checkbox" checked={values.all_day==="1"} onChange={e=>set("all_day",e.target.checked ? "1":"0")}/>All-day event</label>{textField("location","Proposed location")}<Field label="Event description"><textarea value={values.description ?? ""} onChange={e=>set("description",e.target.value)}/></Field></>}
      {kind==="grade" && <><Field label="Grading component"><select value={values.category_id ?? ""} onChange={e=>set("category_id",e.target.value)}><option value="">Select a component</option>{categories.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></Field>{!categories.length && <p className="helper">Add a grading component in Course → Grades first.</p>}{textField("points_earned","Points earned","number")}{textField("points_possible","Points possible","number")}{textField("assessment_date","Assessment date","date")}<Field label="Link to assessment (optional)"><select value={values.assignment_id ? `assignment:${values.assignment_id}`:values.exam_id ? `exam:${values.exam_id}`:""} onChange={e=>{const [kind,id]=e.target.value.split(":");setValues(v=>({...v,assignment_id:kind==="assignment" ? id:"",exam_id:kind==="exam" ? id:""}));}}><option value="">No assessment link</option>{data.assignments.filter(a=>a.course_id===course).map(a=><option key={a.id} value={`assignment:${a.id}`}>{a.title}</option>)}{data.exams.filter(a=>a.course_id===course).map(a=><option key={a.id} value={`exam:${a.id}`}>{a.title}</option>)}</select></Field></>}
      {kind==="schedule" && <><Field label="Change for this meeting"><select value={values.exception_type} onChange={e=>set("exception_type",e.target.value)}>{["Cancelled","Rescheduled","Room changed","Time changed"].map(t=><option key={t}>{t}</option>)}</select></Field>{values.exception_type==="Rescheduled" && textField("new_date","Rescheduled date","date")}{values.exception_type!=="Cancelled" && <>{textField("new_start_time","New start time","time")}{textField("new_end_time","New end time","time")}{textField("room","New room")}</>}{textField("reason","Reason")}</>}
    </div></div><ErrorText error={error}/><div className="email-actions"><Button disabled={busy} onClick={()=>void run(()=>ignoreAction(action))}>Keep current / ignore</Button><Button variant="primary" disabled={busy || (kind!=="event" && !course) || (kind!=="schedule" && !target && !create)} onClick={()=>void run(async()=>{const merged={...Object.fromEntries(Object.entries(snapshot).filter(([,v])=>typeof v==='string').map(([k,v])=>[k,String(v)])),...values};await batch(applyStatements(action,email,merged,expected,target || null,course));report("Reviewed change applied. Source history was saved.");})}>Apply reviewed change</Button></div>
  </article>;
}
