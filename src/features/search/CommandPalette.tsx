import { useEffect, useRef, useState } from "react";
import { Search, ArrowUpRight, Command } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { loadAcademicData } from "../../db/repository";
import { Modal, Empty } from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { query, fileAction } from "../../services/platform";
import { syncUniversityMail } from "../email/repository";
interface Result {
  id: string;
  title: string;
  subtitle: string;
  kind: string;
}
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { navigate, edit, report, setSemesterId, data } = useWorkspace();
  const [search, setSearch] = useState(""),
    [debounced, setDebounced] = useState(""),
    [selected, setSelected] = useState(0);
  const resultRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 120);
    setSelected(0);
    return () => clearTimeout(timer);
  }, [search]);
  const { data: found = [], error } = useQuery({
    queryKey: ["search", debounced],
    enabled: !!debounced,
    queryFn: async () => {
      const pattern = `%${debounced.replace(/[\\%_]/g, "\\$&")}%`;
      const rows = await query<Result>(
        `SELECT id, code||' · '||name AS title, 'Course' AS subtitle, 'course' AS kind FROM courses WHERE code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' UNION ALL SELECT e.id,e.title,c.code,'exam' FROM exams e JOIN courses c ON c.id=e.course_id WHERE e.title LIKE ? ESCAPE '\\' OR c.code LIKE ? ESCAPE '\\' UNION ALL SELECT a.id,a.title,c.code,'assignment' FROM assignments a JOIN courses c ON c.id=a.course_id WHERE a.title LIKE ? ESCAPE '\\' OR c.code LIKE ? ESCAPE '\\' UNION ALL SELECT f.id,f.filename,c.code||' · '||f.category,'file' FROM files f JOIN courses c ON c.id=f.course_id WHERE f.filename LIKE ? ESCAPE '\\' OR c.code LIKE ? ESCAPE '\\' UNION ALL SELECT t.course_id||'/Lectures/'||t.id,t.title,c.code||' - Lecture','tracking' FROM lectures t JOIN courses c ON c.id=t.course_id WHERE t.title LIKE ? ESCAPE '\\' UNION ALL SELECT t.course_id||'/Readings/'||t.id,t.title,c.code||' - Reading','tracking' FROM readings t JOIN courses c ON c.id=t.course_id WHERE t.title LIKE ? ESCAPE '\\' UNION ALL SELECT t.course_id||'/Grades/'||t.id,t.title,c.code||' - Grade','tracking' FROM grade_items t JOIN courses c ON c.id=t.course_id WHERE t.title LIKE ? ESCAPE '\\' UNION ALL SELECT t.course_id||'/Exams/'||t.exam_id||'/'||t.id,t.title,c.code||' - Exam topic','tracking' FROM exam_topics t JOIN courses c ON c.id=t.course_id WHERE t.title LIKE ? ESCAPE '\\' LIMIT 60`,
        Array(12).fill(pattern) as string[],
      );
      const degrees=await query<Result>("SELECT 'degree/'||id AS id,name AS title,'Degree program' AS subtitle,'navigate' AS kind FROM degree_programs WHERE name LIKE ? ESCAPE '\\' UNION ALL SELECT 'degree/'||program_id,name,'Degree requirement group','navigate' FROM degree_groups WHERE name LIKE ? ESCAPE '\\' UNION ALL SELECT 'degree/'||g.program_id,r.name,g.name,'navigate' FROM degree_requirements r JOIN degree_groups g ON g.id=r.group_id WHERE r.name LIKE ? ESCAPE '\\' UNION ALL SELECT 'degree/'||program_id,subject||' '||number||' - '||title,term,'navigate' FROM degree_courses WHERE subject||' '||number||' '||title LIKE ? ESCAPE '\\' LIMIT 30",Array(4).fill(pattern));
      return [...rows,...degrees];
    },
  });
  const commands: Result[] = [
    {id:'degree',title:'Open degree progress / import evaluation',kind:'navigate',subtitle:'Local graduation planner'},
    ...data.courses.map(c=>({id:`course/${c.id}/Syllabus`,title:`Import ${c.code} syllabus`,kind:'navigate',subtitle:'Local parsing, review before import'})),
    ...data.courses.map(c=>({id:`course/${c.id}/Materials`,title:`Search ${c.code} materials`,kind:'navigate',subtitle:'Local document search'})),
    {id:'email-sync',title:'Sync email (Gmail / Microsoft 365)',kind:'email-sync',subtitle:'Email'},
    {id:'settings/email',title:'Connect Gmail',kind:'navigate',subtitle:'Email'},
    {
      id: "emails",
      title: "Open Emails",
      kind: "navigate",
      subtitle: "Navigation",
    },
    {
      id: "grades",
      title: "Open Grades",
      kind: "navigate",
      subtitle: "Navigation",
    },
    {
      id: "grade_items",
      title: "Add grade",
      kind: "tracking-add",
      subtitle: "Quick add",
    },
    {
      id: "readings",
      title: "Add reading",
      kind: "tracking-add",
      subtitle: "Quick add",
    },
    ...data.courses.map((c) => ({
      id: `course/${c.id}/Grades`,
      title: `Open ${c.code} Grades`,
      kind: "navigate",
      subtitle: "Course",
    })),
    {
      id: "dashboard",
      title: "Go to Dashboard",
      kind: "navigate",
      subtitle: "Navigation",
    },
    {
      id: "calendar",
      title: "Open Calendar",
      kind: "navigate",
      subtitle: "Navigation",
    },
    { id: "course", title: "Add Course", kind: "add", subtitle: "Quick add" },
    { id: "exam", title: "Add Exam", kind: "add", subtitle: "Quick add" },
    {
      id: "assignment",
      title: "Add Assignment",
      kind: "add",
      subtitle: "Quick add",
    },
    {
      id: "settings",
      title: "Open Settings",
      kind: "navigate",
      subtitle: "Navigation",
    },
  ];
  const { data: emailMatches = [] } = useQuery({
    queryKey: ["email-global-search", debounced],
    enabled: !!debounced,
    queryFn: () =>
      query<Result>(
        "SELECT id,subject AS title,sender_email AS subtitle,'email' AS kind FROM emails WHERE rowid IN (SELECT rowid FROM emails_fts WHERE emails_fts MATCH ?) ORDER BY received_at DESC LIMIT 12",
        [
          debounced
            .trim()
            .split(/\s+/)
            .slice(0, 12)
            .map((t) => `\"${t.replaceAll('"', '""')}\"*`)
            .join(" AND "),
        ],
      ),
  });
  const results = search
    ? [
        ...found,
        ...emailMatches,
        ...commands.filter((c) =>
          c.title.toLowerCase().includes(search.toLowerCase()),
        ),
      ]
    : commands;
  useEffect(() => {
    resultRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  async function run(r: Result) {
    try {
      if(r.kind==='email-sync') {await syncUniversityMail(data);await queryClient.invalidateQueries();report('University mail synced.');onClose();return;}
      if (r.kind === "email") navigate(`email/${encodeURIComponent(r.id)}`);
      else if (r.kind === "timer")
        window.dispatchEvent(new Event("unidesk:start-study"));
      else if (r.kind === "tracking-add")
        window.dispatchEvent(
          new CustomEvent("unidesk:tracking-add", { detail: r.id }),
        );
      else if (r.kind === "tracking") {
        const courseId = r.id.split("/")[0];
        const rows = await query<{ semester_id: string }>(
          "SELECT semester_id FROM courses WHERE id=?",
          [courseId],
        );
        if (rows[0]) {
          await queryClient.fetchQuery({
            queryKey: ["academic", rows[0].semester_id],
            queryFn: () => loadAcademicData(rows[0].semester_id),
          });
          setSemesterId(rows[0].semester_id);
        }
        navigate(
          r.id.split("/")[1] === "Exams"
            ? `exam/${r.id.split("/")[2]}`
            : `course/${r.id}`,
        );
      } else if (r.kind === "navigate") navigate(r.id);
      else if (r.kind === "add")
        edit({ kind: r.id as "course" | "exam" | "assignment" });
      else if (r.kind === "file") await fileAction(r.id, "open");
      else {
        const table = r.kind === "exam" ? "exams" : "assignments";
        const semesters = await query<{ semester_id: string }>(
          r.kind === "course"
            ? "SELECT semester_id FROM courses WHERE id=?"
            : `SELECT c.semester_id FROM ${table} e JOIN courses c ON c.id=e.course_id WHERE e.id=?`,
          [r.id],
        );
        const sid =
          semesters[0]?.semester_id ??
          data.semesters.find((s) => s.status === "Active")?.id;
        if (sid) {
          await queryClient.fetchQuery({
            queryKey: ["academic", sid],
            queryFn: () => loadAcademicData(sid),
          });
          setSemesterId(sid);
        }
        navigate(`${r.kind}/${r.id}`);
      }
      onClose();
    } catch (e) {
      report((e as Error).message);
    }
  }
  return (
    <Modal title="Search UniDesk" onClose={onClose} wide>
      <div className="command-input">
        <Search size={19} />
        <input
          autoFocus
          data-autofocus
          placeholder="Search courses, files, exams, assignments…"
          aria-label="Search UniDesk"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-results"
          aria-activedescendant={
            results[selected] ? `result-${selected}` : undefined
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, results.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((s) => Math.max(s - 1, 0));
            }
            if (e.key === "Enter" && results[selected]) {
              e.preventDefault();
              void run(results[selected]);
            }
          }}
        />
        <kbd>esc</kbd>
      </div>
      <div
        id="command-results"
        role="listbox"
        className="command-results"
        ref={resultRef}
      >
        {error ? (
          <p role="alert">Search is unavailable. Try again.</p>
        ) : results.length ? (
          results.map((r, i) => (
            <div key={`${r.kind}/${r.id}`}>
              {(i === 0 || results[i - 1].kind !== r.kind) && (
                <div className="command-group">
                  {r.kind === "navigate"
                    ? "Navigation"
                    : r.kind === "add"
                      ? "Quick add"
                      : r.kind + "s"}
                </div>
              )}
              <button
                id={`result-${i}`}
                role="option"
                aria-selected={i === selected}
                className={i === selected ? "selected" : ""}
                onMouseEnter={() => setSelected(i)}
                onClick={() => void run(r)}
              >
                <Command size={15} />
                <span>
                  {r.title}
                  <small>{r.subtitle}</small>
                </span>
                <ArrowUpRight size={14} />
              </button>
            </div>
          ))
        ) : (
          <Empty
            title="No results"
            description="Try a course code, title, or filename."
          />
        )}
      </div>
      <div className="command-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> navigate
        </span>
        <span>
          <kbd>↵</kbd> open
        </span>
        <span>Searches all semesters</span>
      </div>
    </Modal>
  );
}
