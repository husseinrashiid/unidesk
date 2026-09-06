import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "../../hooks/useWorkspace";
import { query, batch } from "../../services/platform";
import { insert, update } from "../../db/repository";
import {
  trackingTables,
  emptyTracking,
  type TrackingData,
  type TrackingTable,
  type TrackRecord,
  type GradingScale,
} from "./types";
import type { SqlValue } from "../../types";
export function useTracking() {
  const { semesterId, refresh, report, page, data } = useWorkspace();
  const result = useQuery({
    queryKey: ["tracking", semesterId],
    queryFn: async () => {
      const lists = await Promise.all(
        trackingTables.map((t) =>
          query<TrackRecord>(
            `SELECT t.* FROM ${t} t JOIN courses c ON c.id=t.course_id WHERE c.semester_id=? ORDER BY ${t === "study_sessions" ? "t.started_at DESC" : "t.created_at"} ${t === "study_sessions" ? "LIMIT 200" : ""}`,
            [semesterId],
          ),
        ),
      );
      const scales = await query<GradingScale>(
        "SELECT s.* FROM grading_scales s LEFT JOIN courses c ON c.id=s.course_id WHERE s.semester_id=? OR c.semester_id=? OR (s.course_id IS NULL AND s.semester_id IS NULL)",
        [semesterId, semesterId],
      );
      return {
        ...Object.fromEntries(trackingTables.map((t, i) => [t, lists[i]])),
        scales,
      } as TrackingData;
    },
  });
  const save = async (
    table: TrackingTable,
    values: Record<string, SqlValue>,
    id?: string,
  ) => {
    await batch([
      id
        ? update(table, id, { ...values, updated_at: new Date().toISOString() })
        : insert(table, { id: crypto.randomUUID(), ...values }),
    ]);
    await refresh();
  };
  const change = async (
    table: TrackingTable,
    id: string,
    values: Record<string, SqlValue>,
  ) => {
    try {
      await save(table, values, id);
    } catch (e) {
      report((e as Error).message);
    }
  };
  return {
    p: page.includes("/")
      ? (result.data ?? emptyTracking)
      : ({
          ...(result.data ?? emptyTracking),
          ...Object.fromEntries(
            trackingTables.map((table) => [
              table,
              (result.data ?? emptyTracking)[table].filter((row) =>
                data.courses.some((c) => c.id === row.course_id && !c.archived),
              ),
            ]),
          ),
        } as TrackingData),
    loading: result.isPending,
    error: result.error,
    save,
    change,
  };
}
