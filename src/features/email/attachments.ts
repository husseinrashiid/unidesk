import { batch, query } from "../../services/platform";
import type { Email, EmailAccount } from "./types";
import type { Category, Statement } from "../../types";
import { providerFor } from "./provider";
export interface EmailAttachment {id:string;email_id:string;filename:string;size:number;mime_type:string;attachment_type:string;file_id:string|null;local_path:string|null;downloaded:number}
export function suggestedCategory(filename:string):Category {
  if(/(?:midterm|exam|final).*(?:20\d{2}|past|previous)|(?:past|previous).*exam/i.test(filename)) return "Previous Exams";
  if(/lecture|slides/i.test(filename)) return "Lectures";
  if(/assignment|homework/i.test(filename)) return "Assignments";
  if(/reading|chapter|article/i.test(filename)) return "Readings";
  if(/exam|midterm|review.sheet/i.test(filename)) return "Exams";
  return "Resources";
}
export const unsafeToOpen=(name:string)=>/\.(?:exe|bat|cmd|ps1|scr|js|vbs|msi|com|lnk|hta|reg|jar)$/i.test(name);
export async function fetchAttachmentMetadata(email:Email,account:EmailAccount) {
  const result=await providerFor(account).attachments(account,email.provider_message_id);
  if(!Array.isArray(result.value)) throw Error("The email provider returned invalid attachment metadata.");
  const statements:Statement[]=result.value.filter(a=>a.id && a.name && !a.isInline).map(a=>({sql:"INSERT INTO email_attachments(id,email_id,provider_attachment_id,filename,mime_type,size,attachment_type) VALUES(?,?,?,?,?,?,?) ON CONFLICT(email_id,provider_attachment_id) DO UPDATE SET filename=excluded.filename,mime_type=excluded.mime_type,size=excluded.size",params:[`${email.id}:${a.id}`,email.id,a.id,a.name,a.contentType ?? "",Math.max(0,a.size || 0),a["@odata.type"]?.includes("fileAttachment") ? "file":"item"]}));
  if(statements.length) await batch(statements);
  return result.next ? "Only the first 100 attachments are shown. Open your mailbox for additional attachments.":"";
}
export async function recordSavedAttachment(email:Email,attachment:EmailAttachment,fileId:string,courseId:string,linkKind:string,linkId:string,readingTitle:string,readingDue:string) {
  const file=(await query<{absolute_path:string;course_id:string}>("SELECT absolute_path,course_id FROM files WHERE id=?",[fileId]))[0];
  if(!file || file.course_id!==courseId) throw Error("The saved file is not in the selected course.");
  const statements:Statement[]=[{sql:"UPDATE email_attachments SET file_id=?,downloaded=1,local_path=? WHERE id=?",params:[fileId,file.absolute_path,attachment.id]},{sql:"INSERT OR IGNORE INTO academic_change_log(id,entity_type,entity_id,field_name,new_value,source_email_id,source_sender,source_subject,source_received_at) VALUES(?,'file',?,'imported_from_email',?,?,?,?,?)",params:[`attachment:${attachment.id}:${fileId}`,fileId,file.absolute_path,email.id,email.sender_email,email.subject,email.received_at]}];
  if(linkKind==="lecture" && linkId) statements.push({sql:"INSERT OR IGNORE INTO lecture_files(lecture_id,file_id) SELECT id,? FROM lectures WHERE id=? AND course_id=?",params:[fileId,linkId,courseId]});
  if(linkKind==="exam" && linkId) statements.push({sql:"INSERT OR IGNORE INTO attachments(file_id,entity_id,entity_type) SELECT ?,id,'exam' FROM exams WHERE id=? AND course_id=?",params:[fileId,linkId,courseId]});
  if(linkKind==="reading") {
    if(!readingTitle.trim()) throw Error("Enter a reading title.");
    statements.push({sql:"INSERT INTO readings(id,course_id,title,file_id,due_date) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM readings WHERE course_id=? AND file_id=?)",params:[crypto.randomUUID(),courseId,readingTitle.trim(),fileId,readingDue,courseId,fileId]});
  }
  await batch(statements);
}
