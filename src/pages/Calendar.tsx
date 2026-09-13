import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button, PageHeader, Modal, Empty } from "../components/ui";
import { useWorkspace } from "../hooks/useWorkspace";
import { dateKey, parseDate, occurrences, timeLabel } from "../utils/dates";
import { useCompactNavigation } from "../layouts/NavigationDrawer";
import type { Occurrence } from "../types";
import { EventRows } from "../features/calendar/EventRows";
export function Calendar() {
  const { data, edit, navigate, preferences } = useWorkspace();
  const compact = useCompactNavigation();
  const [date, setDate] = useState(new Date()),
    [view, setView] = useState(compact ? "Agenda" : "Month"),
    [selected, setSelected] = useState(""),
    [courseFilter, setCourseFilter] = useState(""),
    [kindFilter, setKindFilter] = useState("");
  useEffect(() => {
    if (compact) setView("Agenda");
  }, [compact]);
  useEffect(() => {
    if (view === "Week") {
      const grid = document.querySelector(".week-scroll");
      if (grid) grid.scrollTop = 8 * 56;
    }
  }, [view]);
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = view === "Week" ? new Date(date) : new Date(first);
  start.setDate(
    start.getDate() -
      ((start.getDay() - Number(preferences.week_start ?? 1) + 7) % 7),
  );
  const days = Array.from({ length: view === "Week" ? 7 : 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
  const entries = useMemo(
    () =>
      occurrences(data, dateKey(days[0]), dateKey(days.at(-1)!)).filter(
        (e) =>
          (!courseFilter || e.course_id === courseFilter) &&
          (!kindFilter || e.kind === kindFilter),
      ),
    [data, dateKey(days[0]), dateKey(days.at(-1)!), courseFilter, kindFilter],
  );
  function open(e: Occurrence) {
    if (e.exception_id) {
      navigate(`course/${e.course_id}/Schedule`);
      return;
    }
    if (e.kind === "study") navigate("study/planner");
    else if (e.kind === "lecture") navigate(`course/${e.entity_id}`);
    else if (e.kind === "exam" || e.kind === "assignment")
      navigate(`${e.kind}/${e.entity_id}`);
    else edit({ kind: e.kind, id: e.entity_id });
  }
  function change(direction: number) {
    const next = new Date(date);
    if (view === "Week") next.setDate(next.getDate() + direction * 7);
    else {
      next.setDate(1);
      next.setMonth(next.getMonth() + direction);
    }
    setDate(next);
  }
  const eventButton = (e: Occurrence) => (
    <button
      key={e.id}
      className={`calendar-event ${e.kind} ${e.cancelled ? "cancelled" : ""}`}
      style={
        {
          "--event-color":
            data.courses.find((c) => c.id === e.course_id)?.color ?? "#7a8390",
        } as React.CSSProperties
      }
      onClick={() => open(e)}
      title={`${e.title} · ${timeLabel(e.time)}`}
    >
      <span className="event-dot" />
      {e.time && <span className="calendar-time">{e.time}</span>}
      <span>{e.title}</span>
    </button>
  );
  return (
    <>
      <PageHeader title="Calendar" subtitle="Your semester, at a glance.">
        <Button
          variant="primary"
          onClick={() => edit({ kind: "event", date: dateKey(date) })}
        >
          <Plus size={15} />
          Add event
        </Button>
      </PageHeader>
      <div className="calendar-toolbar">
        <h2>
          {date.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </h2>
        <div className="calendar-navigation">
          <Button
            variant="ghost"
            aria-label="Previous period"
            onClick={() => change(-1)}
          >
            <ChevronLeft size={16} />
          </Button>
          <Button
            variant="ghost"
            aria-label="Next period"
            onClick={() => change(1)}
          >
            <ChevronRight size={16} />
          </Button>
          <Button onClick={() => setDate(new Date())}>Today</Button>
        </div>
        <div className="spacer" />
        <select
          aria-label="Calendar event filter"
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
        >
          {[
            ["", "All"],
            ["lecture", "Classes"],
            ["exam", "Exams"],
            ["assignment", "Assignments"],
            ["event", "Events"],
          ].map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          aria-label="Calendar course filter"
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
        <div className="segmented">
          {["Month", "Week", "Agenda"].map((v) => (
            <button
              key={v}
              className={v === view ? "selected" : ""}
              aria-pressed={v === view}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {view === "Month" ? (
        <div className="month-calendar">
          <div className="weekday-head">
            {(Number(preferences.week_start ?? 1) === 0
              ? ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]
              : ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
            ).map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="month-grid">
            {days.map((d) => {
              const key = dateKey(d),
                items = entries.filter((e) => e.date === key);
              return (
                <div
                  className={`month-day ${d.getMonth() !== date.getMonth() ? "outside" : ""} ${key === dateKey() ? "today" : ""} ${selected === key ? "selected-day" : ""}`}
                  data-weekend={d.getDay() === 0 || d.getDay() === 6}
                  key={key}
                >
                  <button
                    className="day-number"
                    aria-label={`Events on ${key}`}
                    onClick={() => setSelected(key)}
                  >
                    {d.getDate()}
                  </button>
                  {compact && items.length > 0 && (
                    <button
                      className="day-event-count"
                      aria-label={`${items.length} events on ${key}`}
                      onClick={() => setSelected(key)}
                    >
                      {items.length}
                      <span className="event-dot" />
                    </button>
                  )}
                  <div className="cell-events">
                    {items.slice(0, 3).map(eventButton)}
                    {items.length > 3 && (
                      <button
                        className="more-events"
                        onClick={() => setSelected(key)}
                      >
                        +{items.length - 3} more
                      </button>
                    )}
                  </div>
                  <button
                    className="cell-add"
                    aria-label={`Add event on ${key}`}
                    onClick={() => edit({ kind: "event", date: key })}
                  >
                    <Plus size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : view === "Week" ? (
        <div className="week-calendar">
          <div className="week-head">
            <span />
            <>
              {days.map((d) => (
                <button
                  key={dateKey(d)}
                  className={dateKey(d) === dateKey() ? "today" : ""}
                  onClick={() => setSelected(dateKey(d))}
                >
                  {d.toLocaleDateString("en-US", { weekday: "short" })}
                  <strong>{d.getDate()}</strong>
                </button>
              ))}
            </>
          </div>
          <div className="all-day-grid">
            <span>All day</span>
            {days.map((d) => (
              <div key={dateKey(d)}>
                {entries
                  .filter((e) => e.date === dateKey(d) && e.all_day)
                  .map(eventButton)}
              </div>
            ))}
          </div>
          <div className="week-scroll">
            <div className="week-body">
              <div className="hour-labels">
                {Array.from({ length: 24 }, (_, i) => (
                  <span key={i}>
                    {timeLabel(`${String(i).padStart(2, "0")}:00`)}
                  </span>
                ))}
              </div>
              {days.map((d) => {
                const timed = entries.filter(
                  (e) => e.date === dateKey(d) && !e.all_day,
                );
                return (
                  <div className="week-day" key={dateKey(d)}>
                    {timed.map((e, i) => {
                      const minutes = (t: string) => {
                        const [h, m] = t.split(":").map(Number);
                        return h * 60 + m;
                      };
                      const begin = minutes(e.time),
                        end = e.end_time
                          ? minutes(e.end_time)
                          : Math.min(begin + 45, 1440);
                      const overlapping = timed.filter(
                        (x) =>
                          x.id !== e.id &&
                          minutes(x.time) < end &&
                          (x.end_time
                            ? minutes(x.end_time)
                            : minutes(x.time) + 45) > begin,
                      );
                      const lanes = overlapping.length + 1;
                      const lane = timed
                        .slice(0, i)
                        .filter((x) => overlapping.includes(x)).length;
                      return (
                        <button
                          className="week-event"
                          key={e.id}
                          style={
                            {
                              top: (begin / 60) * 56,
                              height: Math.max(28, ((end - begin) / 60) * 56),
                              left: `calc(${(lane / lanes) * 100}% + 3px)`,
                              width: `calc(${100 / lanes}% - 6px)`,
                              "--event-color":
                                data.courses.find((c) => c.id === e.course_id)
                                  ?.color ?? "#7a8390",
                            } as React.CSSProperties
                          }
                          onClick={() => open(e)}
                        >
                          <span>{e.time}</span>
                          <strong>{e.title}</strong>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="agenda">
          {days
            .filter((d) => d.getMonth() === date.getMonth())
            .map((d) => {
              const items = entries.filter((e) => e.date === dateKey(d));
              return items.length ? (
                <section key={dateKey(d)}>
                  <h3>
                    {d.toLocaleDateString("en-US", {
                      weekday: "long",
                      month: "short",
                      day: "numeric",
                    })}
                  </h3>
                  <EventRows items={items} showRelative={false} />
                </section>
              ) : null;
            })}
          {!entries.length && (
            <Empty
              title="Nothing scheduled this month"
              action={
                <Button
                  onClick={() => edit({ kind: "event", date: dateKey(date) })}
                >
                  Add event
                </Button>
              }
            />
          )}
        </div>
      )}
      <div className="calendar-legend">
        {data.courses
          .filter((c) => !c.archived)
          .map((c) => (
            <span key={c.id}>
              <i style={{ background: c.color }} />
              {c.code}
            </span>
          ))}
        <span className="muted">
          Exams and assignments appear automatically.
        </span>
      </div>
      {selected && (
        <Modal
          title={parseDate(selected).toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
          wide
          onClose={() => setSelected("")}
        >
          <div className="modal-body">
            <EventRows
              items={entries.filter((e) => e.date === selected)}
              showRelative={false}
            />
            <div className="form-actions">
              <Button
                onClick={() => {
                  edit({ kind: "event", date: selected });
                  setSelected("");
                }}
              >
                <Plus size={15} />
                Add event
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
