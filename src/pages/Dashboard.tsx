import { ArrowRight, CalendarDays, Clock, MapPin, Plus } from "lucide-react";
import { StudyTimer } from "../features/academic/StudyTimer";
import { useWorkspace } from "../hooks/useWorkspace";
import {
  Button,
  CourseDot,
  Empty,
  PageHeader,
  Section,
  TextLink,
} from "../components/ui";
import { EmailAttention } from "../features/email/Emails";
import { RecentFiles } from "../features/files/RecentFiles";
import { EventRows } from "../features/calendar/EventRows";
import {
  dateKey,
  daysUntil,
  occurrences,
  shortDate,
  timeLabel,
  urgency,
  relativeDate,
} from "../utils/dates";
import {
  ProgressOverview,
  PreparationSummary,
} from "../features/academic/Trackers";
export function Dashboard() {
  const { data, navigate, edit, semesterId } = useWorkspace();
  const today = dateKey();
  const end = new Date();
  end.setFullYear(end.getFullYear() + 1);
  const all = occurrences(data, today, dateKey(end)),
    upcoming = all.filter((e) => e.kind !== "lecture").slice(0, 6);
  const todayEvents = all.filter((e) => e.date === today);
  const exam = data.exams
      .filter((e) => e.date >= today && !e.cancelled)
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.start_time.localeCompare(b.start_time),
      )[0],
    course = data.courses.find((c) => c.id === exam?.course_id);
  const semester = data.semesters.find((s) => s.id === semesterId);
  const assignments = data.assignments
    .filter((a) => !["Completed", "Submitted"].includes(a.status))
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 3);
  const hour = new Date().getHours();
  return (
    <>
      <PageHeader
        title={`Good ${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}`}
        subtitle={new Date().toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
      >
        <span className="semester-label">
          <span className="status-dot" />
          {semester?.name}
        </span>
      </PageHeader>
      {!data.courses.length && (
        <Empty
          title="No courses yet"
          description="Add your first course to start organizing your semester."
          action={
            <Button onClick={() => edit({ kind: "course" })}>
              <Plus size={15} />
              Add course
            </Button>
          }
        />
      )}
      <div className="dashboard-grid">
        <section className={`next-exam ${exam ? urgency(exam.date) : ""}`}>
          <div className="exam-top">
            <span className="eyebrow">
              <CalendarDays size={14} />
              NEXT EXAM
            </span>
            {course && (
              <span className="course-tag">
                <CourseDot color={course.color} />
                {course.code}
              </span>
            )}
          </div>
          {exam ? (
            <>
              <div className="exam-body">
                <div>
                  <h2>{exam.title}</h2>
                  <p>{course?.name}</p>
                </div>
                <div className="exam-count">
                  <strong>{daysUntil(exam.date)}</strong>
                  <span>
                    {daysUntil(exam.date) === 1
                      ? "day remaining"
                      : "days remaining"}
                  </span>
                </div>
              </div>
              <PreparationSummary examId={exam.id} actionable />
              <div className="exam-bottom">
                <span>
                  <Clock size={14} />
                  {shortDate(exam.date)} · {timeLabel(exam.start_time)}
                </span>
                {exam.location && (
                  <span>
                    <MapPin size={14} />
                    {exam.location}
                  </span>
                )}
                <button onClick={() => navigate(`exam/${exam.id}`)}>
                  View exam
                  <ArrowRight size={14} />
                </button>
              </div>
            </>
          ) : (
            <Empty
              title="No upcoming exams"
              description="Add an exam to start tracking countdowns."
              action={
                <TextLink onClick={() => edit({ kind: "exam" })}>
                  Add exam
                </TextLink>
              }
            />
          )}
        </section>
        <Section
          title="Today"
          className="dashboard-today"
          action={
            <span className="small muted">
              {new Date().toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          }
        >
          {todayEvents.length ? (
            <div className="today-list">
              {todayEvents.map((e) => (
                <button
                  key={e.id}
                  onClick={() =>
                    e.kind === "study"
                      ? navigate("study/planner")
                      : e.kind === "lecture"
                        ? navigate(`course/${e.course_id}`)
                        : e.kind === "exam" || e.kind === "assignment"
                          ? navigate(`${e.kind}/${e.entity_id}`)
                          : edit({ kind: e.kind, id: e.entity_id })
                  }
                >
                  <span>{timeLabel(e.time)}</span>
                  <strong>{e.title}</strong>
                </button>
              ))}
            </div>
          ) : (
            <div className="today-empty">
              <p>Nothing scheduled today.</p>
              <span>
                {exam
                  ? `Next exam ${daysUntil(exam.date) === 0 ? "today" : `in ${daysUntil(exam.date)} days`}.`
                  : "Make time for your next study session."}
              </span>
            </div>
          )}
          <div className="today-actions">
            <StudyTimer />
            <button
              className="subtle-add"
              onClick={() => edit({ kind: "event", date: today })}
            >
              <Plus size={14} />
              Add event
            </button>
          </div>
        </Section>
        <Section
          title="Upcoming"
          className="dashboard-upcoming"
          action={
            <TextLink onClick={() => navigate("calendar")}>
              Open calendar
            </TextLink>
          }
        >
          <EventRows items={upcoming} />
        </Section>
        <Section
          title="Assignments"
          className="dashboard-assignments"
          action={
            <TextLink onClick={() => navigate("assignments")}>
              View all
            </TextLink>
          }
        >
          {assignments.length ? (
            <div className="assignment-preview">
              {assignments.map((a) => {
                const c = data.courses.find((c) => c.id === a.course_id);
                return (
                  <button
                    className="assignment-preview-row"
                    key={a.id}
                    onClick={() => navigate(`assignment/${a.id}`)}
                  >
                    <span
                      className={`status-symbol ${a.status === "In progress" ? "in-progress" : ""}`}
                      title={a.status}
                    />
                    <span className="row-main">
                      <span>{a.title}</span>
                      <small>
                        <CourseDot color={c?.color} />
                        {c?.code}
                      </small>
                    </span>
                    <span className={`small ${urgency(a.due_date)}`}>
                      {relativeDate(a.due_date)}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <Empty title="All caught up" description="No active assignments." />
          )}
        </Section>
        <div className="dashboard-email">
          <EmailAttention />
        </div>
        <Section
          title="Recent files"
          className="dashboard-files"
          action={
            <TextLink onClick={() => navigate("courses")}>Browse</TextLink>
          }
        >
          <RecentFiles />
        </Section>
        <div className="dashboard-progress">
          <ProgressOverview />
        </div>
      </div>
    </>
  );
}
