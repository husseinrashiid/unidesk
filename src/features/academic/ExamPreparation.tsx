import { Section } from "../../components/ui";
import { TrackerList, PreparationSummary } from "./Trackers";
export function ExamPreparation({examId,courseId}:{examId:string;courseId:string}) {
 return <><Section title="Exam preparation"><PreparationSummary examId={examId}/><p className="small muted">Track topics or link lectures, readings, and previous exams. Preparation status and confidence are manually controlled.</p></Section><TrackerList table="exam_topics" courseId={courseId} examId={examId}/></>;
}
