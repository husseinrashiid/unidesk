import {
  ArrowUpRight,
  CalendarDays,
  FileText,
  GraduationCap,
  Clock,
} from "lucide-react";
import type { Occurrence } from "../../types";
import { CourseDot, Empty } from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import {
  shortDate,
  relativeDate,
  timeLabel,
  daysUntil,
} from "../../utils/dates";
export function EventRows({
  items,
  showRelative = true,
}: {
  items: Occurrence[];
  showRelative?: boolean;
}) {
  const { data, navigate, edit } = useWorkspace();
  return (
    <div className="event-list">
      {items.length ? (
        items.map((e) => {
          const c = data.courses.find((c) => c.id === e.course_id);
          const Icon =
            e.kind === "exam"
              ? GraduationCap
              : e.kind === "assignment"
                ? FileText
                : e.kind === "lecture"
                  ? Clock
                  : CalendarDays;
          return (
            <button
              className={`event-row ${daysUntil(e.date) >= 0 && daysUntil(e.date) < 7 ? "due-soon" : ""} ${e.cancelled ? "cancelled" : ""}`}
              key={e.id}
              onClick={() => {
                if (e.exception_id) {
                  navigate(`course/${e.course_id}/Schedule`);
                  return;
                }
                if (e.kind === "study") navigate("study/planner");
                else if (e.kind === "lecture")
                  navigate(`course/${e.entity_id}`);
                else if (e.kind === "exam" || e.kind === "assignment")
                  navigate(`${e.kind}/${e.entity_id}`);
                else edit({ kind: e.kind, id: e.entity_id });
              }}
            >
              <span className="event-date">{shortDate(e.date)}</span>
              <span className="event-course">
                <CourseDot color={c?.color} />
                {c?.code ?? "Personal"}
              </span>
              <span className="event-title">{e.title}</span>
              <span className="event-type">
                <Icon size={13} />
                {e.type}
              </span>
              <span className="event-relative">
                {showRelative ? relativeDate(e.date) : timeLabel(e.time)}
              </span>
              <ArrowUpRight size={13} className="row-arrow" />
            </button>
          );
        })
      ) : (
        <Empty
          title="Nothing scheduled"
          description="New deadlines and events will appear here."
        />
      )}
    </div>
  );
}
