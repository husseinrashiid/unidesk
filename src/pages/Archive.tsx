import { Archive as ArchiveIcon, Plus, ArrowRight } from "lucide-react";
import {
  PageHeader,
  Button,
  Section,
  Empty,
  CourseDot,
} from "../components/ui";
import { useWorkspace } from "../hooks/useWorkspace";
import { batch } from "../services/platform";
import { update } from "../db/repository";
import { shortDate } from "../utils/dates";
export function Archive() {
  const { data, edit, setSemesterId, navigate, refresh, report } =
    useWorkspace();
  return (
    <>
      <PageHeader
        title="Semesters & archive"
        subtitle="Past semesters, still close at hand."
      >
        <Button onClick={() => edit({ kind: "semester" })}>
          <Plus size={15} />
          Add semester
        </Button>
      </PageHeader>
      <Section title="Semesters">
        {data.semesters.map((s) => (
          <div className="archive-row" key={s.id}>
            <ArchiveIcon size={18} />
            <div>
              <strong>{s.name}</strong>
              <small>
                {shortDate(s.start_date)} – {shortDate(s.end_date)} · {s.status}
              </small>
            </div>
            <div className="spacer" />
            {s.status === "Archived" && (
              <Button
                variant="ghost"
                onClick={async () => {
                  try {
                    await batch([
                      {
                        sql: "UPDATE semesters SET status='Archived' WHERE status='Active'",
                      },
                      update("semesters", s.id, { status: "Active" }),
                    ]);
                    setSemesterId(s.id);
                    await refresh();
                    report(`${s.name} is now active`);
                  } catch (e) {
                    report((e as Error).message);
                  }
                }}
              >
                Make active
              </Button>
            )}
            <Button
              onClick={() => {
                setSemesterId(s.id);
                navigate("courses");
              }}
            >
              Browse
              <ArrowRight size={14} />
            </Button>
          </div>
        ))}
      </Section>
      <Section title="Archived courses in this semester">
        {data.courses.filter((c) => c.archived).length ? (
          data.courses
            .filter((c) => c.archived)
            .map((c) => (
              <div className="archive-row" key={c.id}>
                <CourseDot color={c.color} />
                <button
                  className="row-main"
                  onClick={() => navigate(`course/${c.id}`)}
                >
                  <strong>{c.code}</strong>
                  <small>{c.name}</small>
                </button>
                <Button
                  onClick={async () => {
                    try {
                      await batch([update("courses", c.id, { archived: 0 })]);
                      await refresh();
                      report("Course restored");
                    } catch (e) {
                      report((e as Error).message);
                    }
                  }}
                >
                  Restore
                </Button>
              </div>
            ))
        ) : (
          <Empty title="No archived courses" />
        )}
      </Section>
    </>
  );
}
