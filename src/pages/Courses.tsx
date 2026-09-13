import { AskCourse } from "../features/ai/AskCourse";
import { useState } from "react";
import { SyllabusPage } from "../features/syllabus/SyllabusPage";
import { CourseDegreeLinks } from "../features/degree/CourseDegreeLinks";
import { PreviousExamAnalysis } from "../features/ai/PreviousExams";
import {
  Plus,
  ArrowRight,
  FolderOpen,
  BookOpen,
  MapPin,
  Clock,
  UserRound,
} from "lucide-react";
import { useWorkspace } from "../hooks/useWorkspace";
import {
  Button,
  PageHeader,
  Menu,
  CourseDot,
  Section,
  TextLink,
  Empty,
} from "../components/ui";
import { capabilities, command, batch } from "../services/platform";
import { update } from "../db/repository";
import { dateKey, occurrences, timeLabel, relativeDate } from "../utils/dates";
import { categories, type Category } from "../types";
import { FileBrowser } from "../features/files/FileBrowser";
import { EventRows } from "../features/calendar/EventRows";
import { RecentFiles } from "../features/files/RecentFiles";
import { CourseGrades, ScaleSettings } from "../features/academic/GradesView";
import { Emails } from "../features/email/Emails";
import { CourseSchedule } from "../features/email/CourseSchedule";
import { ProfessorDirectory } from "../features/email/ProfessorDirectory";
import { Materials } from "../features/documents/Materials";
import {
  TrackerList,
  ProgressOverview,
  PreparationSummary,
} from "../features/academic/Trackers";
export function Courses() {
  const { data, navigate, edit, semesterId, refresh, report } = useWorkspace();
  const semester = data.semesters.find((s) => s.id === semesterId);
  return (
    <>
      <PageHeader
        title="Courses"
        subtitle={`${data.courses.filter((c) => !c.archived).length} courses · ${semester?.name ?? "No semester"}`}
      >
        <Button variant="primary" onClick={() => edit({ kind: "course" })}>
          <Plus size={15} />
          Add course
        </Button>
      </PageHeader>
      <div className="course-grid">
        {data.courses
          .filter((c) => !c.archived)
          .map((c) => {
            const schedule = data.schedules.filter((s) => s.course_id === c.id);
            const next = occurrences(
              { ...data, schedules: [] },
              dateKey(),
              "2099-12-31",
            ).find((e) => e.course_id === c.id && e.kind !== "lecture");
            return (
              <article
                className="course-card"
                key={c.id}
                style={{ borderTopColor: c.color }}
              >
                <div className="course-card-top">
                  <span
                    className="course-avatar"
                    style={{ background: c.color + "15", color: c.color }}
                  >
                    <BookOpen size={19} />
                  </span>
                  <Menu label={`Actions for ${c.code}`}>
                    <button onClick={() => edit({ kind: "course", id: c.id })}>
                      Edit course
                    </button>
                    {capabilities.revealFile && (
                      <button
                        onClick={async () => {
                          try {
                            await command("open_folder", { id: c.id });
                          } catch (e) {
                            report((e as Error).message);
                          }
                        }}
                      >
                        Open folder
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        try {
                          await batch([
                            update("courses", c.id, { archived: 1 }),
                          ]);
                          await refresh();
                          report("Course archived");
                        } catch (e) {
                          report((e as Error).message);
                        }
                      }}
                    >
                      Archive
                    </button>
                  </Menu>
                </div>
                <button
                  className="course-card-title"
                  onClick={() => navigate(`course/${c.id}`)}
                >
                  <h2>{c.code}</h2>
                  <p>{c.name}</p>
                </button>
                <div className="course-card-details">
                  <span>
                    <UserRound size={14} />
                    {c.professor || "No professor added"}
                  </span>
                  <span>
                    <Clock size={14} />
                    {schedule.length
                      ? `${schedule.map((s) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][s.day_of_week]).join(" / ")} · ${timeLabel(schedule[0].start_time)}`
                      : "No class schedule"}
                  </span>
                  <span>
                    <MapPin size={14} />
                    {c.room || "No room added"}
                    <span className="detail-divider">·</span>
                    {c.credits} credits
                  </span>
                </div>
                <div className="course-card-bottom">
                  <span>
                    {next
                      ? `Next: ${next.title} · ${relativeDate(next.date).toLowerCase()}`
                      : "No upcoming deadlines"}
                  </span>
                  <button
                    aria-label={`Open ${c.code}`}
                    onClick={() => navigate(`course/${c.id}`)}
                  >
                    <ArrowRight size={16} />
                  </button>
                </div>
              </article>
            );
          })}
      </div>
      {!data.courses.filter((c) => !c.archived).length && (
        <Empty
          title="No courses yet"
          description="Add a course to create its workspace and folders."
          action={
            <Button onClick={() => edit({ kind: "course" })}>Add course</Button>
          }
        />
      )}
    </>
  );
}
export function CourseWorkspace({ id }: { id: string }) {
  const { data, edit, navigate, report, page } = useWorkspace();
  const requestedTab = page.split("/")[2] || "Overview";
  const [tab, setTab] = useState(
    ["Study", "Resources"].includes(requestedTab)
      ? "Materials"
      : requestedTab === "AI syllabus"
        ? "Syllabus"
        : requestedTab,
  );
  const groups = [
    { title: "Overview", views: ["Overview"] },
    {
      title: "Materials",
      views: ["Materials", "Lectures", "Readings", "Recordings", "Notes"],
    },
    {
      title: "Assessments",
      views: ["Assignments", "Exams", "Previous Exams", "Grades"],
    },
    { title: "Schedule", views: ["Schedule"] },
    { title: "Syllabus", views: ["Syllabus"] },
    { title: "Emails", views: ["Emails"] },
    { title: "Ask Course", views: ["Ask"] },
  ];
  const activeGroup =
    groups.find((group) => group.views.includes(tab)) ?? groups[0];
  const c = data.courses.find((c) => c.id === id);
  if (!c) return <Empty title="Course not found" />;
  const schedule = data.schedules.filter((s) => s.course_id === id);
  const soon = occurrences({ ...data, schedules: [] }, dateKey(), "2099-12-31")
    .filter((e) => e.course_id === id)
    .slice(0, 5);
  return (
    <>
      <div className="course-breadcrumb">
        <button onClick={() => navigate("courses")}>Courses</button>
        <span>/</span>
        <CourseDot color={c.color} />
        {c.code}
      </div>
      <PageHeader title={c.code} subtitle={c.name}>
        {capabilities.revealFile && (
          <Button
            onClick={async () => {
              try {
                await command("open_folder", { id });
              } catch (e) {
                report((e as Error).message);
              }
            }}
          >
            <FolderOpen size={15} />
            Open folder
          </Button>
        )}
        <Button onClick={() => edit({ kind: "course", id })}>
          Edit course
        </Button>
      </PageHeader>
      <div className="course-header-meta">
        <span>
          <UserRound size={14} />
          {c.professor || "Professor not set"}
        </span>
        <span>Section {c.section || "—"}</span>
        <span>
          <Clock size={14} />
          {schedule.length
            ? `${schedule.map((s) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][s.day_of_week]).join(" / ")} · ${timeLabel(schedule[0].start_time)}`
            : "No schedule"}
        </span>
        <span>
          <MapPin size={14} />
          {c.room || "Room not set"}
        </span>
      </div>
      <nav
        className="tabs workspace-tabs course-sections"
        aria-label="Course sections"
      >
        {groups.map((group) => (
          <button
            key={group.title}
            className={activeGroup.title === group.title ? "selected" : ""}
            aria-current={
              activeGroup.title === group.title ? "page" : undefined
            }
            onClick={() => setTab(group.views[0])}
          >
            {group.title}
          </button>
        ))}
      </nav>
      {activeGroup.views.length > 1 && (
        <nav
          className="course-subnav"
          aria-label={`${activeGroup.title} views`}
        >
          {activeGroup.views.map((view) => (
            <button
              key={view}
              className={tab === view ? "selected" : ""}
              aria-current={tab === view ? "page" : undefined}
              onClick={() => setTab(view)}
            >
              {view === "Materials"
                ? "Search materials"
                : view === "Overview"
                  ? "Summary"
                  : view === "Study"
                    ? "Study sessions"
                    : view}
            </button>
          ))}
        </nav>
      )}
      <CourseDegreeLinks courseId={id} />
      {tab === "Ask" ? (
        <AskCourse
          courseId={id}
          initialFileId={page.split("/")[3] ?? ""}
          initialKind={page.split("/")[4] ?? "ask"}
        />
      ) : tab === "Syllabus" ? (
        <SyllabusPage courseId={id} />
      ) : tab === "Materials" ? (
        <Materials courseId={id} initialFileId={page.split("/")[3] ?? ""} />
      ) : tab === "Schedule" ? (
        <CourseSchedule courseId={id} />
      ) : tab === "Emails" ? (
        <Emails courseId={id} />
      ) : tab === "Overview" ? (
        <div className="course-overview">
          <div>
            <Section
              title="Upcoming"
              action={
                <TextLink onClick={() => edit({ kind: "exam", courseId: id })}>
                  Add exam
                </TextLink>
              }
            >
              <EventRows items={soon} />
            </Section>
            <Section
              title="Recent files"
              action={
                <TextLink onClick={() => setTab("Lectures")}>
                  Browse files
                </TextLink>
              }
            >
              <RecentFiles courseId={id} />
            </Section>
          </div>
          <aside>
            <Section title="Course info">
              <dl className="details-list">
                <dt>Professor</dt>
                <dd>{c.professor || "—"}</dd>
                <dt>Section</dt>
                <dd>{c.section || "—"}</dd>
                <dt>Room</dt>
                <dd>{c.room || "—"}</dd>
                <dt>Credits</dt>
                <dd>{c.credits}</dd>
              </dl>
              <h3 className="small">Class meetings</h3>
              {schedule.map((s) => (
                <p className="small muted" key={s.id}>
                  {
                    [
                      "Sunday",
                      "Monday",
                      "Tuesday",
                      "Wednesday",
                      "Thursday",
                      "Friday",
                      "Saturday",
                    ][s.day_of_week]
                  }{" "}
                  · {timeLabel(s.start_time)}–{timeLabel(s.end_time)}
                </p>
              ))}
              <Button variant="ghost" onClick={() => setTab("Schedule")}>
                Manage class schedule
              </Button>
            </Section>
            <Section title="Academic status">
              <ProgressOverview courseId={id} />
              <h3 className="small">Next exam</h3>
              {data.exams
                .filter((e) => e.course_id === id && e.date >= dateKey())
                .slice(0, 1)
                .map((e) => (
                  <button
                    className="next-course-exam"
                    key={e.id}
                    onClick={() => navigate(`exam/${e.id}`)}
                  >
                    <strong>{e.title}</strong>
                    <PreparationSummary examId={e.id} />
                    <span>{relativeDate(e.date)}</span>
                    <ArrowRight size={15} />
                  </button>
                ))}
              {!data.exams.some(
                (e) => e.course_id === id && e.date >= dateKey(),
              ) && <Empty title="No upcoming exams" />}
            </Section>
            <ProfessorDirectory courseId={id} />
          </aside>
        </div>
      ) : tab === "Grades" ? (
        <>
          <CourseGrades courseId={id} />
          <ScaleSettings courseId={id} />
        </>
      ) : (
        <>
          {(tab === "Lectures" ||
            tab === "Readings" ||
            tab === "Previous Exams") && (
            <TrackerList
              table={
                tab === "Lectures"
                  ? "lectures"
                  : tab === "Readings"
                    ? "readings"
                    : "previous_exam_attempts"
              }
              courseId={id}
            />
          )}
          {tab === "Previous Exams" && <PreviousExamAnalysis courseId={id} />}
          <div className="category-heading">
            <h2>{tab}</h2>
            <p>Files are stored in your course’s {tab.toLowerCase()} folder.</p>
          </div>
          {(tab === "Assignments" || tab === "Exams") && (
            <div className="linked-records">
              {(tab === "Exams" ? data.exams : data.assignments)
                .filter((x) => x.course_id === id)
                .map((x) => (
                  <button
                    key={x.id}
                    onClick={() =>
                      navigate(
                        `${tab === "Exams" ? "exam" : "assignment"}/${x.id}`,
                      )
                    }
                  >
                    <span>
                      {x.title}
                      <small>
                        {relativeDate("due_date" in x ? x.due_date : x.date)} ·{" "}
                        {"due_date" in x ? x.due_date : x.date}
                      </small>
                    </span>
                    <ArrowRight size={13} />
                  </button>
                ))}
              <Button
                variant="ghost"
                onClick={() =>
                  edit({
                    kind: tab === "Exams" ? "exam" : "assignment",
                    courseId: id,
                  })
                }
              >
                <Plus size={14} />
                Add {tab === "Exams" ? "exam" : "assignment"}
              </Button>
            </div>
          )}
          <FileBrowser
            key={`${id}/${tab}`}
            courseId={id}
            category={tab as Category}
          />
        </>
      )}
    </>
  );
}
