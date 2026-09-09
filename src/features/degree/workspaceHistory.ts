import {query} from '../../services/platform';
import {courseGrade,letterGrade,parseScale} from '../academic/grades';
import type {TrackRecord,GradingScale} from '../academic/types';
import {code,newCourse,normalizeTerm,type DegreeState} from './types';
/** Reuse actual grading coverage and scale overrides; partial grades never become completed history. */
export async function reviewWorkspaceHistory(state:DegreeState):Promise<DegreeState> {
 const s=structuredClone(state);
 const [courses,categories,items,scales]=await Promise.all([
  query<{id:string;code:string;name:string;credits:number;semester_id:string;term:string;semester_status:string}>('SELECT c.*,s.name term,s.status semester_status FROM courses c JOIN semesters s ON s.id=c.semester_id'),
  query<TrackRecord>('SELECT * FROM grade_categories'),query<TrackRecord>('SELECT * FROM grade_items'),query<GradingScale>('SELECT * FROM grading_scales')]);
 for(const c of courses){const match=c.code.match(/^([A-Za-z]{2,8})\s*(\d{2,4}[A-Za-z]?)$/);if(!match)continue;
  const grade=courseGrade(categories.filter(g=>g.course_id===c.id),items.filter(g=>g.course_id===c.id));
  const final=grade.current!==null&&Math.abs(grade.gradedWeight-100)<.001&&Math.abs(grade.totalWeight-100)<.001;
  const scale=parseScale((scales.find(g=>g.course_id===c.id)??scales.find(g=>g.semester_id===c.semester_id)??scales.find(g=>!g.course_id&&!g.semester_id))?.entries);
  const letter=final?letterGrade(grade.current,scale):null;
  const found=s.courses.find(r=>code(r.subject,r.number)===code(match[1],match[2])&&r.term===normalizeTerm(c.term));
  if(found){found.course_id=c.id;if(final&&letter){found.grade=letter.letter;found.status=letter.points===0?'failed':'completed';}continue;}
  if(!final&&c.semester_status!=='Active')continue;
  s.courses.push({...newCourse(s.program.id),subject:match[1].toUpperCase(),number:match[2].toUpperCase(),title:c.name,credits:c.credits,grade:letter?.letter??'',term:normalizeTerm(c.term),original_term:c.term,status:final?(letter?.points===0?'failed':'completed'):'in_progress',source:'UniDesk course history',course_id:c.id});
 }return s;
}
