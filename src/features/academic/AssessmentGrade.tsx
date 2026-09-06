import { useState } from "react";
import { Button, Section } from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useTracking } from "./useTracking";
import { TrackingEditor } from "./TrackingEditor";
export function AssessmentGrade({
  kind,
  id,
  courseId,
  title,
}: {
  kind: "exam" | "assignment";
  id: string;
  courseId: string;
  title: string;
}) {
  const { p } = useTracking();
  const { navigate } = useWorkspace();
  const [open, setOpen] = useState(false);
  const record = p.grade_items.find(
    (i) => i[kind === "exam" ? "exam_id" : "assignment_id"] === id,
  );
  const category = p.grade_categories.find((c) => c.id === record?.category_id);
  return (
    <Section
      title="Grade"
      action={
        <Button onClick={() => setOpen(true)}>
          {record ? "Edit grade" : "Add grade"}
        </Button>
      }
    >
      <span>
        {record?.points_earned == null
          ? "Ungraded"
          : `${record.points_earned} / ${record.points_possible}`}
        {category
          ? ` · ${category.name} component (${category.weight}% of course)`
          : ""}
      </span>
      {!p.grade_categories.some((c) => c.course_id === courseId) && (
        <p>
          <Button
            variant="ghost"
            onClick={() => navigate(`course/${courseId}/Grades`)}
          >
            Set up course components
          </Button>
        </p>
      )}
      {open && (
        <TrackingEditor
          table="grade_items"
          record={record}
          courseId={courseId}
          defaults={{
            title,
            [kind === "exam" ? "exam_id" : "assignment_id"]: id,
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </Section>
  );
}
