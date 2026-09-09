import { useQuery } from "@tanstack/react-query";
import { query } from "../../services/platform";
import { useWorkspace } from "../../hooks/useWorkspace";
import { Button } from "../../components/ui";
export function CourseDegreeLinks({ courseId }: { courseId: string }) {
  const { navigate } = useWorkspace();
  const { data = [] } = useQuery({
    queryKey: ["course-degree-links", courseId],
    queryFn: () =>
      query<{ program_id: string; name: string }>(
        "SELECT DISTINCT g.program_id,g.name FROM degree_groups g JOIN degree_requirements r ON r.group_id=g.id JOIN degree_allocations a ON a.requirement_id=r.id JOIN degree_courses c ON c.id=a.course_id WHERE c.course_id=? AND g.contributes_credits=1",
        [courseId],
      ),
  });
  return data.length ? (
    <p className="helper">
      Degree requirement:{" "}
      {data.map((g) => (
        <Button
          variant="ghost"
          key={`${g.program_id}:${g.name}`}
          onClick={() => navigate(`degree/${g.program_id}`)}
        >
          {g.name}
        </Button>
      ))}
    </p>
  ) : null;
}
