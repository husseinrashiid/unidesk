import {
  createContext,
  useContext,
  useState,
  useMemo,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { loadAcademicData, settings } from "../db/repository";
import type { AcademicData, EditorState } from "../types";
interface Workspace {
  data: AcademicData;
  preferences: Record<string, string>;
  page: string;
  navigate: (page: string) => void;
  semesterId: string;
  setSemesterId: (id: string) => void;
  editor: EditorState | null;
  edit: (state: EditorState | null) => void;
  refresh: () => Promise<void>;
  report: (message: string) => void;
  toast: string;
  loading: boolean;
  error: Error | null;
}
const Context = createContext<Workspace | null>(null);
const empty: AcademicData = {
  semesters: [],
  courses: [],
  schedules: [],
  exams: [],
  assignments: [],
  events: [],
};
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [page, setPage] = useState("dashboard"),
    [semesterId, setSemesterId] = useState(""),
    [editor, edit] = useState<EditorState | null>(null),
    [toast, report] = useState("");
  const client = useQueryClient();
  const academic = useQuery({
    queryKey: ["academic", semesterId],
    queryFn: () => loadAcademicData(semesterId || undefined),
  });
  const prefs = useQuery({ queryKey: ["settings"], queryFn: settings });
  const visible = useMemo(() => {
    const all = academic.data ?? empty;
    if (page.includes("/") || editor?.id) return all;
    const active = new Set(
      all.courses.filter((c) => !c.archived).map((c) => c.id),
    );
    return {
      ...all,
      studyBlocks: all.studyBlocks?.filter((b) => active.has(b.course_id)),
      schedules: all.schedules.filter((s) => active.has(s.course_id)),
      exams: all.exams.filter((e) => active.has(e.course_id)),
      assignments: all.assignments.filter((a) => active.has(a.course_id)),
      events: all.events.filter((e) => !e.course_id || active.has(e.course_id)),
    };
  }, [academic.data, page, editor?.id]);
  const history=useRef<string[]>([]);
  const navigate = (next: string) => {if(next!==page){history.current.push(page);setPage(next);}};
  useEffect(()=>{
    const handler=()=>{
      const dialogs=Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'));
      const modal=dialogs.at(-1);
      if(modal){modal.dispatchEvent(new Event('cancel',{cancelable:true}));return true;}
      const open=document.querySelector('details[open]');if(open){open.removeAttribute('open');return true;}
      const previous=history.current.pop();if(previous){setPage(previous);return true;}
      if(page!=='dashboard'){setPage('dashboard');return true;}return false;
    };
    Object.assign(window,{unideskAndroidBack:handler});
    return()=>{delete (window as Window & {unideskAndroidBack?:unknown}).unideskAndroidBack;};
  },[page]);
  const refresh = async () => {
    await client.invalidateQueries();
  };
  return (
    <Context.Provider
      value={{
        data: visible,
        preferences: prefs.data ?? {},
        page,
        navigate,
        semesterId:
          semesterId ||
          academic.data?.semesters.find((s) => s.status === "Active")?.id ||
          "",
        setSemesterId,
        editor,
        edit,
        refresh,
        report,
        toast,
        loading: academic.isPending || prefs.isPending,
        error: academic.error ?? prefs.error,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw Error("Workspace context is missing");
  return value;
}
