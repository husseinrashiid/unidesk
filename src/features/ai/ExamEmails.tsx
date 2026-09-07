import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { batch, query } from "../../services/platform";
import { ErrorText } from "../../components/ui";
export function ExamEmails({
  examId,
  courseId,
}: {
  examId: string;
  courseId: string;
}) {
  const [error, setError] = useState("");
  const { data: emails = [], refetch } = useQuery({
    queryKey: ["exam-source-emails", examId],
    queryFn: () =>
      query<{
        id: string;
        subject: string;
        received_at: string;
        selected: number;
      }>(
        "SELECT e.id,e.subject,e.received_at,EXISTS(SELECT 1 FROM exam_email_sources s WHERE s.email_id=e.id AND s.exam_id=?) selected FROM emails e WHERE e.course_id=? ORDER BY received_at DESC LIMIT 100",
        [examId, courseId],
      ),
  });
  return (
    <details>
      <summary>Choose cached professor/course emails for this exam</summary>
      <p className="helper">
        Only explicitly selected messages may accompany this exam's document
        excerpts. Up to three selected messages are used per request.
      </p>
      {emails.map((e) => (
        <label className="ai-option" key={e.id}>
          <input
            type="checkbox"
            checked={!!e.selected}
            onChange={(event) =>
              void batch([
                event.target.checked
                  ? {
                      sql: "INSERT INTO exam_email_sources(exam_id,email_id) SELECT ?,? WHERE EXISTS(SELECT 1 FROM exams x JOIN emails m ON m.course_id=x.course_id WHERE x.id=? AND m.id=?)",
                      params: [examId, e.id, examId, e.id],
                      expectChanges: 1,
                    }
                  : {
                      sql: "DELETE FROM exam_email_sources WHERE exam_id=? AND email_id=?",
                      params: [examId, e.id],
                    },
              ])
                .then(() => refetch())
                .catch((err) => setError((err as Error).message))
            }
          />
          {e.subject} · {e.received_at.slice(0, 10)}
        </label>
      ))}
      <ErrorText error={error} />
    </details>
  );
}
