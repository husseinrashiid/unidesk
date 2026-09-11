import { ResponsiveTable } from "../components/ResponsiveTable";
import { PreparationSummary } from "../features/academic/Trackers";
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import {
  Button,
  PageHeader,
  CourseDot,
  Empty,
  Section,
} from "../components/ui";
import { useWorkspace } from "../hooks/useWorkspace";
import {
  dateKey,
  relativeDate,
  shortDate,
  timeLabel,
  urgency,
} from "../utils/dates";
import { batch } from "../services/platform";
import { update } from "../db/repository";
export function AcademicLists({
  kind,
}: {
  kind: "assignment" | "exam";
}) {
  const { data, edit, navigate, refresh, report } = useWorkspace();
  const [filter, setFilter] = useState("Active"),
    [search, setSearch] = useState(""),
    [courseFilter, setCourseFilter] = useState("");
  const today = dateKey();
  const matches = (x: { title: string; course_id: string | null }) =>
    x.title.toLowerCase().includes(search.toLowerCase()) &&
    (!courseFilter || x.course_id === courseFilter);
  const title = kind === "assignment" ? "Assignments" : "Exams";
  const tabs =
    kind === "assignment"
      ? ["Active", "Completed", "All"]
      : ["Upcoming", "Past", "All"];
  const actual = tabs.includes(filter) ? filter : tabs[0];
  return (
    <>
      <PageHeader
        title={title}
        subtitle={
          kind === "assignment"
            ? "Keep your coursework moving."
            : "Your next exams, with room to prepare."
        }
      >
        <Button variant="primary" onClick={() => edit({ kind })}>
          <Plus size={15} />
          Add {kind}
        </Button>
      </PageHeader>
      <div className="list-toolbar">
        <div className="tabs">
          {tabs.map((t) => (
            <button
              key={t}
              className={actual === t ? "selected" : ""}
              onClick={() => setFilter(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="filter-controls">
          <div className="search-field">
            <Search size={15} />
            <input
              aria-label={`Search ${title.toLowerCase()}`}
              data-page-search
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter by course"
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
          >
            <option value="">All courses</option>
            {data.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="table-wrap">
          <ResponsiveTable>
            <thead>
              <tr>
                <th>{kind === "exam" ? "Exam" : "Assignment"}</th>
                <th>Course</th>
                <th>{kind === "exam" ? "Date & time" : "Due date"}</th>
                <th>{kind === "exam" ? "Location" : "Status"}</th>
                <th className="align-right">
                  {kind === "exam" ? "Countdown" : "Due"}
                </th>
              </tr>
            </thead>
            <tbody>
              {(kind === "assignment"
                ? data.assignments.filter(
                    (a) =>
                      actual === "All" ||
                      (actual === "Completed") ===
                        ["Completed", "Submitted"].includes(a.status),
                  )
                : data.exams.filter(
                    (e) =>
                      actual === "All" ||
                      (actual === "Past" ? e.date < today : e.date >= today),
                  )
              )
                .filter(matches)
                .map((item) => {
                  const c = data.courses.find((c) => c.id === item.course_id);
                  const date = "due_date" in item ? item.due_date : item.date;
                  return (
                    <tr key={item.id}>
                      <td>
                        <button
                          className="table-title"
                          onClick={() => navigate(`${kind}/${item.id}`)}
                        >
                          {item.title}
                          {kind === "exam" && (
                            <PreparationSummary examId={item.id} />
                          )}
                          {"type" in item && <small>{item.cancelled ? "Cancelled" : item.type}</small>}
                        </button>
                      </td>
                      <td>
                        <span className="course-tag">
                          <CourseDot color={c?.color} />
                          {c?.code}
                        </span>
                      </td>
                      <td>
                        {shortDate(date)}
                        <small>
                          {timeLabel(
                            "due_time" in item
                              ? item.due_time
                              : item.start_time,
                          )}
                        </small>
                      </td>
                      <td>
                        {"status" in item ? (
                          <select
                            className="status-select"
                            aria-label={`Status for ${item.title}
                          {kind === "exam" && <PreparationSummary examId={item.id}/>}`}
                            value={item.status}
                            onChange={async (e) => {
                              try {
                                await batch([
                                  update("assignments", item.id, {
                                    status: e.target.value,
                                  }),
                                ]);
                                await refresh();
                              } catch (err) {
                                report((err as Error).message);
                              }
                            }}
                          >
                            {[
                              "Not started",
                              "In progress",
                              "Completed",
                              "Submitted",
                            ].map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        ) : (
                          item.location || "—"
                        )}
                      </td>
                      <td className={`align-right small ${urgency(date)}`}>
                        {"status" in item &&
                        ["Completed", "Submitted"].includes(item.status)
                          ? "Done"
                          : kind === "exam" && date < today
                            ? "Completed"
                            : relativeDate(date)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </ResponsiveTable>
          {!(kind === "exam" ? data.exams : data.assignments).filter(matches)
            .length && (
            <Empty
              title={`No ${title.toLowerCase()} found`}
              action={
                <Button onClick={() => edit({ kind })}>Add {kind}</Button>
              }
            />
          )}
      </div>
    </>
  );
}
