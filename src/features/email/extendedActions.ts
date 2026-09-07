import type { AcademicData, SqlValue, Statement } from "../../types";
import type { ActionPayload, Email, EmailAction } from "./types";
import { classify, detectDates, detectTime, newestText, proposedDate } from "./analysis";
import { dateKey } from "../../utils/dates";

export function detectedRoom(text: string) {
  const directed=text.match(/\b(?:room|location|venue)\b[^.!?\n]{0,50}?\bfrom\s+([A-Z][A-Za-z -]{1,30}\s+\d{1,4}[A-Z]?|\d{2,4}[A-Z]?)\s+to\s+([A-Z][A-Za-z -]{1,30}\s+\d{1,4}[A-Z]?|\d{2,4}[A-Z]?)/);
  if(directed) return directed[2].trim();
  const candidates=[...text.matchAll(/\b(?:in|room|venue(?: is)?|meet at)\s+([A-Z][A-Za-z -]{1,30}\s+\d{1,4}[A-Z]?|\d{2,4}[A-Z]?)\b/g)];
  if (!candidates.length) return "";
  // 'in Nicely 212 rather than ...' describes the destination first.
  return candidates[0][1].trim();
}
export function explicitGrade(text:string) {
  const found=[...newestText(text).matchAll(/\b(?:received|scored?|grade(?:\s+is)?|earned)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:\/|out of)\s*(\d+(?:\.\d+)?)\b/gi)];
  if(found.length!==1 || Number(found[0][2])<=0) return null;
  return {points_earned:found[0][1],points_possible:found[0][2]};
}
export function meetingDates(text:string,received:string) {
  const dates=detectDates(text,received);
  const weekdays=["sun","mon","tue","wed","thu","fri","sat"];
  for(const m of text.matchAll(/\b(sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)(?:'s|’s)?\b/gi)) {
    if(dates.some(d=>m.index!>=d.index && m.index!<d.index+d.raw.length)) continue;
    // A weekday immediately before an explicit date qualifies that date.
    if(dates.some(d=>d.index>m.index! && d.index-m.index!<16 && /^[\s,]*$/.test(text.slice(m.index!+m[0].length,d.index)))) continue;
    const base=new Date(received);base.setHours(12,0,0,0);
    base.setDate(base.getDate()+(weekdays.indexOf(m[1].slice(0,3).toLowerCase())-base.getDay()+7)%7);
    dates.push({raw:m[0],index:m.index!,date:dateKey(base),reason:"Weekday relative to the received date; confirm this meeting."});
  }
  return dates.sort((a,b)=>a.index-b.index);
}
export function extendedProposal(email:Email,data:AcademicData):Omit<EmailAction,"id"|"status"> | null {
  if(email.body_text===null) return null;
  const text=`${email.subject}\n${newestText(email.body_text)}`, classification=classify(email.subject,email.body_text);
  const grade=explicitGrade(newestText(email.body_text));
  let type:EmailAction["entity_type"], proposed:Record<string,string>, explanation:string;
  const expected:Record<string,string>={};
  let entityId:string|null=null;
  if(grade) {
    type="grade";proposed={...grade,title:email.subject,category_id:"",assessment_date:dateKey(new Date((email.original_sent_at ?? email.received_at)))};
    explanation="An explicit score appears in the newest message. Select the grading component and review the assessment before saving.";
  } else if(["Class cancellation","Class reschedule","Room change"].includes(classification.type)) {
    type="schedule";
    if(/\b(?:starting|from now on|every|all (?:future|wednesday|monday|tuesday|thursday|friday)|permanent)\b/i.test(text)) {
      proposed={permanent:"true"};explanation="This may change the recurring timetable. Review the course's weekly schedule manually; a one-day exception would be misleading.";
    } else {
      const dates=meetingDates(text,(email.original_sent_at ?? email.received_at));
      const original=dates[0]?.date ?? "";
      const meeting=data.schedules.filter(s=>s.course_id===email.course_id && original && s.day_of_week===new Date(`${original}T12:00:00`).getDay());
      const schedule=meeting.length===1 ? meeting[0]:null;
      const exception=data.scheduleExceptions?.find(e=>e.course_id===email.course_id && e.date===original && e.original_start_time===schedule?.start_time);
      if(schedule) expected.schedule=JSON.stringify(schedule);
      if(exception) {expected.record=JSON.stringify(exception);entityId=exception.id;}
      const time=detectTime(text);
      proposed={date:original,exception_type:classification.type==="Class cancellation" ? "Cancelled":classification.type==="Room change" ? "Room changed":"Rescheduled",schedule_id:schedule?.id ?? "",new_date:classification.type==="Class reschedule" ? dates[1]?.date ?? "":"",new_start_time:time ?? schedule?.start_time ?? "",new_end_time:schedule?.end_time ?? "",room:detectedRoom(text),reason:email.subject};
      if(schedule && time && time!==schedule.start_time) {
        const minutes=(s:string)=>Number(s.slice(0,2))*60+Number(s.slice(3));
        const end=minutes(time)+minutes(schedule.end_time)-minutes(schedule.start_time);
        proposed.new_end_time=end<1440 ? `${String(Math.floor(end/60)).padStart(2,"0")}:${String(end%60).padStart(2,"0")}`:"";
      }
      explanation="Review the original date and weekly meeting. Only this occurrence will change; the recurring schedule and default room stay intact.";
    }
  } else return null;
  return {email_id:email.id,action_type:type==="grade" ? "Grade / feedback":classification.type,course_id:email.course_id,entity_type:type,entity_id:entityId,confidence:email.course_id && type==="grade" ? "Medium":"Low",payload_json:JSON.stringify({expected,proposed,explanation})};
}
export function conversionPayload(email:Email):ActionPayload {
  const text=newestText(email.body_text ?? email.snippet),date=proposedDate(text,(email.original_sent_at ?? email.received_at)),time=detectTime(text);
  return {expected:{},proposed:{title:email.subject,start_datetime:date.date ? `${date.date}T${time ?? "00:00"}`:"",all_day:time ? "0":"1",location:detectedRoom(text),description:text},explanation:`${date.reason} Review the details before saving. A course is optional for university-wide messages.`};
}
const fields={event:["title","start_datetime","end_datetime","all_day","location","description","type"],grade:["title","category_id","assignment_id","exam_id","points_earned","points_possible","assessment_date","notes"],schedule:["date","exception_type","original_start_time","original_end_time","new_date","new_start_time","new_end_time","room","reason"]};
export function validDate(date:string) {
  const parsed=new Date(`${date}T12:00:00`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsed.getTime()) && dateKey(parsed)===date;
}
const validTime=(v:string)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export function extendedApply(action:EmailAction,email:Email,values:Record<string,string>,expected:Record<string,string>,entityId:string|null,courseId:string):Statement[] {
  const kind=action.entity_type;
  if(kind!=="event" && kind!=="grade" && kind!=="schedule") throw Error("Unsupported academic action.");
  if(action.status!=="Pending") throw Error("This suggestion has already been resolved.");
  if(!courseId && kind!=="event") throw Error("Select a course.");
  const table={event:"calendar_events",grade:"grade_items",schedule:"course_schedule_exceptions"}[kind];
  const record:Record<string,SqlValue>=JSON.parse(expected.record ?? "{}");
  const selected:Record<string,SqlValue>=Object.fromEntries(Object.entries(values).filter(([k])=>fields[kind].includes(k)));
  if(kind!=="schedule" && !String(selected.title ?? record.title ?? "").trim()) throw Error("Enter a title.");
  if(kind==="event") {
    const start=String(selected.start_datetime ?? record.start_datetime ?? "");
    if(!validDate(start.slice(0,10)) || !validTime(start.slice(11,16))) throw Error("Enter a valid event date and time.");
    const end=String(selected.end_datetime ?? "");
    if(end && (!validDate(end.slice(0,10)) || !validTime(end.slice(11,16)) || end<start)) throw Error("Event end must be after its start.");
    selected.all_day=values.all_day==="1" ? 1:0;
  }
  if(kind==="grade") {
    if(!selected.category_id) throw Error("Select a grading component. Add one in Course → Grades if needed.");
    for(const key of ["points_earned","points_possible"]) {
      if(values[key]===undefined || values[key].trim()==="" || !Number.isFinite(Number(values[key]))) throw Error("Enter the explicit earned and possible points.");
      selected[key]=Number(values[key]);
    }
    if(Number(selected.points_earned)<0 || Number(selected.points_possible)<=0) throw Error("Earned points must be zero or higher, and possible points greater than zero.");
    if(selected.assessment_date && !validDate(String(selected.assessment_date))) throw Error("Enter a valid assessment date.");
    for(const key of ["assignment_id","exam_id"]) if(selected[key]==="") selected[key]=null;
  }
  const guards:Statement[]=[];
  if(kind==="schedule") {
    if(values.permanent==="true") throw Error("Review recurring changes in the weekly course schedule.");
    const schedule=JSON.parse(expected.schedule ?? "{}");
    if(!schedule.id || schedule.id!==values.schedule_id || schedule.course_id!==courseId) throw Error("Select the original weekly meeting.");
    if(!validDate(values.date) || new Date(`${values.date}T12:00:00`).getDay()!==schedule.day_of_week) throw Error("The original date must fall on the selected meeting's weekday.");
    if(!["Cancelled","Rescheduled","Room changed","Time changed"].includes(values.exception_type)) throw Error("Choose a supported schedule exception.");
    if(values.exception_type==="Rescheduled" && !validDate(values.new_date)) throw Error("Select the rescheduled date.");
    if(values.exception_type!=="Cancelled" && (!validTime(values.new_start_time) || !validTime(values.new_end_time) || values.new_end_time<=values.new_start_time)) throw Error("Enter a valid start and end time for this meeting.");
    if(values.exception_type==="Room changed" && !values.room.trim()) throw Error("Enter the new room.");
    selected.original_start_time=schedule.start_time;selected.original_end_time=schedule.end_time;
    selected.source_email_id=email.id;
    guards.push({sql:"UPDATE course_schedules SET start_time=start_time WHERE id=? AND course_id=? AND day_of_week=? AND start_time=? AND end_time=? AND EXISTS(SELECT 1 FROM courses c JOIN semesters s ON s.id=c.semester_id WHERE c.id=? AND ? BETWEEN s.start_date AND s.end_date)",params:[schedule.id,courseId,schedule.day_of_week,schedule.start_time,schedule.end_time,courseId,values.date],expectChanges:1});
  }
  const id=entityId ?? crypto.randomUUID();
  const steps:Statement[]=[{sql:"UPDATE email_detected_actions SET status='Applied',entity_id=?,course_id=?,resolved_at=datetime('now') WHERE id=? AND status='Pending' AND payload_json=?",params:[id,courseId || null,action.id,action.payload_json],expectChanges:1},...guards];
  if(entityId) {
    if(record.id!==entityId || (record.course_id ?? "")!==courseId) throw Error("Reload the selected academic record.");
    const snapshot=Object.entries(record).filter(([k])=>[...fields[kind],"id","course_id","updated_at","created_at","source_email_id","excluded","weight_override"].includes(k));
    steps.push({sql:`UPDATE ${table} SET ${Object.keys(selected).map(k=>`${k}=?`).join(",")},updated_at=datetime('now') WHERE ${snapshot.map(([k])=>`${k} IS ?`).join(" AND ")}`,params:[...Object.values(selected),...snapshot.map(([,v])=>v)],expectChanges:1});
  } else {
    const duplicate=kind==="schedule" ? "course_id=? AND date=? AND original_start_time=?":kind==="grade" ? "course_id=? AND lower(title)=lower(?) AND category_id=?":"course_id IS ? AND lower(title)=lower(?) AND start_datetime=?";
    const duplicateParams:SqlValue[]=kind==="schedule" ? [courseId,values.date,selected.original_start_time]:[courseId || null,String(selected.title),kind==="grade" ? selected.category_id:selected.start_datetime];
    steps.push({sql:`INSERT INTO ${table}(id,course_id,${Object.keys(selected).join(",")}) SELECT ?,?,${Object.keys(selected).map(()=>"?").join(",")} WHERE NOT EXISTS(SELECT 1 FROM ${table} WHERE ${duplicate})`,params:[id,courseId || null,...Object.values(selected),...duplicateParams],expectChanges:1});
  }
  for(const [field,value] of Object.entries(selected)) {
    if(field==="source_email_id" || record[field]===value) continue;
    steps.push({sql:"INSERT INTO academic_change_log(id,entity_type,entity_id,field_name,old_value,new_value,source_email_id,source_sender,source_subject,source_received_at) VALUES(?,?,?,?,?,?,?,?,?,?)",params:[crypto.randomUUID(),kind,id,field,record[field]===undefined ? null:record[field],value,email.id,email.sender_email,email.subject,email.received_at]});
  }
  steps.push({sql:"UPDATE emails SET requires_review=EXISTS(SELECT 1 FROM email_detected_actions WHERE email_id=? AND status='Pending') WHERE id=?",params:[email.id,email.id]},{sql:"UPDATE notifications SET read=1 WHERE type='email' AND entity_id=?",params:[email.id]});
  return steps;
}
