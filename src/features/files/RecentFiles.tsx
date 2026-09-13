import { useQuery } from "@tanstack/react-query";
import { FileText, FolderOpen } from "lucide-react";
import { recentFiles, fileAction, capabilities } from "../../services/platform";
import { useWorkspace } from "../../hooks/useWorkspace";
import { Empty } from "../../components/ui";
export function RecentFiles({ courseId }: { courseId?: string }) {
  const { data, report, refresh } = useWorkspace();
  const { data: files = [], error } = useQuery({
    queryKey: ["recent-files", courseId],
    queryFn: () => recentFiles(courseId),
  });
  async function act(id: string, action: "open" | "reveal") {
    try {
      await fileAction(id, action);
      await refresh();
    } catch (e) {
      report((e as Error).message);
    }
  }
  return (
    <div>
      {error ? (
        <p role="alert">Could not load recent files.</p>
      ) : files.length ? (
        files.map((file) => (
          <div className="recent-file" key={file.id}>
            <button
              className="recent-file-open"
              aria-label={`Open ${file.filename}`}
              onClick={() => void act(file.id, "open")}
            >
              <span className="file-icon">
                <FileText size={18} />
              </span>
              <span className="recent-file-info">
                <span className="file-title">{file.filename}</span>
                <small>
                  {data.courses.find((c) => c.id === file.course_id)?.code} ·{" "}
                  {file.category}
                </small>
                {file.accessed_at && (
                  <small>
                    Opened{" "}
                    <time dateTime={file.accessed_at}>
                      {new Date(file.accessed_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </time>
                  </small>
                )}
              </span>
              <span className="recent-open-label">Open</span>
            </button>
            {capabilities.revealFile && (
              <button
                className="recent-reveal"
                aria-label={`Reveal ${file.filename}`}
                title="Reveal in folder"
                onClick={() => void act(file.id, "reveal")}
              >
                <FolderOpen size={17} />
              </button>
            )}
          </div>
        ))
      ) : (
        <Empty
          title="No recent files"
          description="Add files from a course workspace."
        />
      )}
    </div>
  );
}
