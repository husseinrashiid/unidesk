import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Clock, MapPin, FileText, Link2, X } from "lucide-react";
import { useWorkspace } from "../hooks/useWorkspace";
import {
  Button,
  PageHeader,
  Section,
  CourseDot,
  Empty,
  Modal,
  Field,
  ErrorText,
} from "../components/ui";
import { query, batch, fileAction } from "../services/platform";
import { update } from "../db/repository";
import { shortDate, timeLabel, relativeDate, dateKey } from "../utils/dates";
import type { AcademicFile } from "../types";
import { PreparationSummary } from "../features/academic/Trackers";
import { ExamPreparation } from "../features/academic/ExamPreparation";
import { AssessmentGrade } from "../features/academic/AssessmentGrade";
import { EmailHistory } from "../features/email/Emails";
import { ExamAIWorkspace } from "../features/ai/ExamAIWorkspace";
export function EntityDetail({
  kind,
  id,
}: {
  kind: "exam" | "assignment";
  id: string;
}) {
  const { data, edit, navigate, refresh, report, page } = useWorkspace();
  const item = (kind === "exam" ? data.exams : data.assignments).find(
    (e) => e.id === id,
  );
  const [attach, setAttach] = useState(false);
  const [detailTab, setDetailTab] = useState(
    page.split("/")[2] === "Preparation" ? "Preparation" : "Overview",
  );
  const { data: files = [] } = useQuery({
    queryKey: ["attachments", kind, id],
    queryFn: () =>
      query<AcademicFile>(
        "SELECT f.* FROM files f JOIN attachments a ON a.file_id=f.id WHERE a.entity_id=? AND a.entity_type=?",
        [id, kind],
      ),
  });
  if (!item) return <Empty title="Record not found" />;
  const c = data.courses.find((c) => c.id === item.course_id),
    date = "date" in item ? item.date : item.due_date,
    time = "start_time" in item ? item.start_time : item.due_time;
  return (
    <>
      <div className="course-breadcrumb">
        <button
          onClick={() => navigate(kind === "exam" ? "exams" : "assignments")}
        >
          {kind === "exam" ? "Exams" : "Assignments"}
        </button>
        <span>/</span>
        <CourseDot color={c?.color} />
        {c?.code}
      </div>
      <PageHeader title={item.title} subtitle={c?.name}>
        <Button onClick={() => edit({ kind, id })}>Edit {kind}</Button>
      </PageHeader>
      <div className="detail-meta">
        <span>
          <CalendarDays size={16} />
          {shortDate(date)}, {date.slice(0, 4)}
        </span>
        <span>
          <Clock size={16} />
          {timeLabel(time)}
        </span>
        {"location" in item && item.location && (
          <span>
            <MapPin size={16} />
            {item.location}
          </span>
        )}
        <span className="detail-countdown">
          {kind === "exam" && date < dateKey()
            ? "Completed"
            : relativeDate(date)}
        </span>
      </div>
      {kind === "exam" && (
        <div className="tabs">
          <button
            className={detailTab === "Overview" ? "selected" : ""}
            onClick={() => setDetailTab("Overview")}
          >
            Overview
          </button>
          {["Preparation", "Materials", "Study guide & practice", "Notes"].map(
            (t) => (
              <button
                key={t}
                className={detailTab === t ? "selected" : ""}
                onClick={() => setDetailTab(t)}
              >
                {t}
              </button>
            ),
          )}
        </div>
      )}
      <div hidden={kind === "exam" && detailTab !== "Overview"}>
        <AssessmentGrade
          kind={kind}
          id={id}
          courseId={item.course_id}
          title={item.title}
        />
        {kind === "exam" && <PreparationSummary examId={id} />}
      </div>
      {kind === "exam" && detailTab === "Preparation" && (
        <ExamPreparation examId={id} courseId={item.course_id} />
      )}
      {kind === "exam" && detailTab === "Study guide & practice" && (
        <ExamAIWorkspace courseId={item.course_id} examId={id} />
      )}
      <div className="course-overview">
        <div>
          <Section
            title="Details"
            className={
              kind === "exam" && detailTab !== "Overview"
                ? "academic-tab-hidden"
                : ""
            }
          >
            <p className="prose">
              {item.description || "No description added."}
            </p>
            {"status" in item && (
              <Field label="Status">
                <select
                  className="detail-status"
                  value={item.status}
                  onChange={async (e) => {
                    try {
                      await batch([
                        update("assignments", id, { status: e.target.value }),
                      ]);
                      await refresh();
                    } catch (e) {
                      report((e as Error).message);
                    }
                  }}
                >
                  {["Not started", "In progress", "Completed", "Submitted"].map(
                    (s) => (
                      <option key={s}>{s}</option>
                    ),
                  )}
                </select>
              </Field>
            )}
          </Section>
          {"coverage" in item && detailTab === "Overview" && (
            <Section title="Topics & coverage">
              <p className="prose">
                {item.coverage || "No coverage added yet."}
              </p>
            </Section>
          )}
          <Section
            className={
              kind === "exam" && detailTab !== "Materials"
                ? "academic-tab-hidden"
                : ""
            }
            title="Attached materials"
            action={
              <Button variant="ghost" onClick={() => setAttach(true)}>
                <Link2 size={14} />
                Attach file
              </Button>
            }
          >
            {files.length ? (
              files.map((f) => (
                <div key={f.id} className="attachment-row">
                  <button
                    onClick={async () => {
                      try {
                        await fileAction(f.id, "open");
                      } catch (e) {
                        report((e as Error).message);
                      }
                    }}
                  >
                    <FileText size={17} />
                    {f.filename}
                  </button>
                  <Button
                    variant="ghost"
                    aria-label={`Detach ${f.filename}`}
                    onClick={async () => {
                      try {
                        await batch([
                          {
                            sql: "DELETE FROM attachments WHERE file_id=? AND entity_id=? AND entity_type=?",
                            params: [f.id, id, kind],
                          },
                        ]);
                        await refresh();
                      } catch (e) {
                        report((e as Error).message);
                      }
                    }}
                  >
                    <X size={14} />
                  </Button>
                </div>
              ))
            ) : (
              <Empty
                title="No attached materials"
                description="Attach files already stored in this course."
              />
            )}
          </Section>
          <Section
            title="Notes"
            className={
              kind === "exam" && detailTab !== "Notes"
                ? "academic-tab-hidden"
                : ""
            }
          >
            <p className="prose">{item.notes || "No notes yet."}</p>
          </Section>
        </div>
        <aside>
          <Section title="Course workspace">
            <button
              className="course-detail-link"
              onClick={() => navigate(`course/${item.course_id}`)}
            >
              <CourseDot color={c?.color} />
              {c?.code}
              <span>Open course →</span>
            </button>
          </Section>
        </aside>
      </div>
      <EmailHistory kind={kind} id={id} />
      {attach && (
        <AttachDialog
          courseId={item.course_id}
          entityId={id}
          kind={kind}
          onClose={() => setAttach(false)}
        />
      )}
    </>
  );
}
function AttachDialog({
  courseId,
  entityId,
  kind,
  onClose,
}: {
  courseId: string;
  entityId: string;
  kind: string;
  onClose: () => void;
}) {
  const { refresh } = useWorkspace();
  const [selected, setSelected] = useState(""),
    [error, setError] = useState("");
  const { data: files = [] } = useQuery({
    queryKey: ["attachable", courseId],
    queryFn: () =>
      query<AcademicFile>(
        "SELECT * FROM files WHERE course_id=? ORDER BY filename LIMIT 500",
        [courseId],
      ),
  });
  return (
    <Modal title="Attach course file" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await batch([
              {
                sql: "INSERT OR IGNORE INTO attachments(file_id,entity_id,entity_type) VALUES(?,?,?)",
                params: [selected, entityId, kind],
              },
            ]);
            await refresh();
            onClose();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <div className="modal-body">
          <Field label="File">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              required
            >
              <option value="">Select a file</option>
              {files.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.category} / {f.filename}
                </option>
              ))}
            </select>
          </Field>
          {!files.length && (
            <p className="muted">Add files to the course workspace first.</p>
          )}
          <ErrorText error={error} />
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!selected}>
            Attach file
          </Button>
        </div>
      </form>
    </Modal>
  );
}
