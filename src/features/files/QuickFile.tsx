import { useState } from "react";
import { Modal, Field, Button, Empty } from "../../components/ui";
import { FileBrowser } from "./FileBrowser";
import { useWorkspace } from "../../hooks/useWorkspace";
import { categories, type Category } from "../../types";
export function QuickFile({ onClose }: { onClose: () => void }) {
  const { data, page, edit } = useWorkspace();
  const [course, setCourse] = useState(
      page.startsWith("course/")
        ? page.split("/")[1]
        : (data.courses.find((c) => !c.archived)?.id ?? ""),
    ),
    [category, setCategory] = useState<Category>("Lectures");
  return (
    <Modal title="Add course files" wide onClose={onClose}>
      <div className="modal-body">
        {data.courses.some((c) => !c.archived) ? (
          <>
            <div className="form-grid">
              <Field label="Course">
                <select
                  value={course}
                  onChange={(e) => setCourse(e.target.value)}
                >
                  {data.courses
                    .filter((c) => !c.archived)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Category">
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Category)}
                >
                  {categories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
            </div>
            <FileBrowser
              key={course + category}
              courseId={course}
              category={category}
            />
          </>
        ) : (
          <Empty
            title="Add a course first"
            description="Each file belongs to a course folder."
            action={
              <Button
                onClick={() => {
                  onClose();
                  edit({ kind: "course" });
                }}
              >
                Add course
              </Button>
            }
          />
        )}
      </div>
    </Modal>
  );
}
