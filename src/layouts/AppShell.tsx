import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  GraduationCap,
  LayoutDashboard,
  BookOpen,
  CalendarDays,
  ClipboardList,
  Archive,
  Settings,
  Search,
  Bell,
  Plus,
  ChevronDown,
  ChevronsUpDown,
  PanelLeftClose,
  PanelLeftOpen,
  HardDrive,
  X,
  FileText,
  Mail,
} from "lucide-react";
import { useWorkspace } from "../hooks/useWorkspace";
import { Button, CourseDot } from "../components/ui";
import { Dashboard } from "../pages/Dashboard";
import { Courses, CourseWorkspace } from "../pages/Courses";
import { Calendar } from "../pages/Calendar";
import { AcademicLists } from "../pages/AcademicLists";
import { EntityDetail } from "../pages/EntityDetail";
import { Settings as SettingsPage } from "../pages/Settings";
import { Archive as ArchivePage } from "../pages/Archive";
import { Editor } from "../features/Editor";
import { CommandPalette } from "../features/search/CommandPalette";
import { NotificationCenter } from "../features/notifications/NotificationCenter";
import { generateReminders } from "../features/notifications/reminders";
import { query } from "../services/platform";
import { QuickFile } from "../features/files/QuickFile";
import type { EntityKind } from "../types";
import { SemesterGrades } from "../features/academic/GradesView";
import { TrackingEditor } from "../features/academic/TrackingEditor";
import type { TrackingTable } from "../features/academic/types";
import { Emails } from "../features/email/Emails";
import { EmailSync } from "../features/email/EmailSettings";
import { DocumentWorker } from "../features/documents/DocumentWorker";
import { DegreePage } from "../features/degree/DegreePage";
import { NavigationDrawer, useCompactNavigation } from "./NavigationDrawer";
import { SyncIndicator } from "../features/sync/SyncSettings";
const navigation = [
  { id: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { id: "courses", label: "Courses", Icon: BookOpen },
  { id: "calendar", label: "Calendar", Icon: CalendarDays },
  { id: "assignments", label: "Assignments", Icon: ClipboardList },
  { id: "exams", label: "Exams", Icon: GraduationCap },
  { id: "grades", label: "Grades", Icon: GraduationCap },
  { id: "emails", label: "Emails", Icon: Mail },
  { id: "degree", label: "Degree Progress", Icon: GraduationCap },
];
export function AppShell() {
  const compact = useCompactNavigation();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const {
    data,
    page,
    navigate: workspaceNavigate,
    semesterId,
    setSemesterId,
    editor,
    edit,
    preferences,
    toast,
    report,
    refresh,
  } = useWorkspace();
  const navigate = (next: string) => {
    setNavigationOpen(false);
    workspaceNavigate(next);
  };
  const [trackingEditor, setTrackingEditor] = useState<TrackingTable | null>(
    null,
  );
  useEffect(() => {
    const handler = (e: Event) =>
      setTrackingEditor((e as CustomEvent<TrackingTable>).detail);
    window.addEventListener("unidesk:tracking-add", handler);
    return () => window.removeEventListener("unidesk:tracking-add", handler);
  }, []);
  const [searchOpen, setSearchOpen] = useState(false),
    [notificationOpen, setNotificationOpen] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [quickFile, setQuickFile] = useState(false);
  const { data: unread = [] } = useQuery({
    queryKey: ["notification-count"],
    queryFn: () =>
      query<{ count: number }>(
        "SELECT count(*) AS count FROM notifications WHERE read=0",
      ),
  });
  const { data: emailCount = [] } = useQuery({
    queryKey: ["email-attention-count"],
    queryFn: () =>
      query<{ count: number }>(
        "SELECT count(*) AS count FROM emails WHERE archived=0 AND (requires_review=1 OR (is_read=0 AND importance IN ('Critical','Important')))",
      ),
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((s) => !s);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        const input =
          document.querySelector<HTMLInputElement>("[data-page-search]");
        if (input) {
          e.preventDefault();
          input.focus();
        }
      }
      if (e.key === "Escape")
        document
          .querySelectorAll("details[open]")
          .forEach((el) => el.removeAttribute("open"));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => report(""), 6500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    let running = false;
    async function check() {
      if (running) return;
      running = true;
      try {
        await generateReminders(
          data,
          preferences.notifications === "true",
          false,
          preferences.email_notifications === "true",
        );
        await refresh();
      } catch (e) {
        console.error("Deadline reminder check failed", e);
      } finally {
        running = false;
      }
    }
    void check();
    const timer = setInterval(() => void check(), 60_000);
    return () => clearInterval(timer);
  }, [
    data.exams,
    data.assignments,
    preferences.notifications,
    preferences.study_reminders,
    preferences.email_notifications,
  ]);
  const [route, id] = page.split("/");
  useEffect(() => {
    setNavigationOpen(false);
  }, [page, compact]);
  const course = data.courses.find((c) => c.id === id);
  const pageLabel =
    route === "email"
      ? "Email details"
      : route === "course"
        ? (course?.code ?? "Course")
        : route === "exam"
          ? "Exam details"
          : route === "assignment"
            ? "Assignment details"
            : route === "archive"
              ? "Archive"
              : route === "settings"
                ? "Settings"
                : (navigation.find((n) => n.id === route)?.label ??
                  "Dashboard");
  const activeAssignments = data.assignments.filter(
    (a) => !["Completed", "Submitted"].includes(a.status),
  ).length;
  return (
    <div
      className={`app-shell ${collapsed && !compact ? "sidebar-collapsed" : ""}`}
    >
      <EmailSync />
      <DocumentWorker />
      <NavigationDrawer
        compact={compact}
        open={navigationOpen}
        onClose={() => setNavigationOpen(false)}
      >
        <div className="brand">
          <span className="brand-icon">
            <GraduationCap size={20} />
          </span>
          <strong>UniDesk</strong>
          <button
            aria-label={
              compact
                ? "Close navigation"
                : collapsed
                  ? "Expand sidebar"
                  : "Collapse sidebar"
            }
            onClick={() =>
              compact ? setNavigationOpen(false) : setCollapsed(!collapsed)
            }
          >
            {compact ? (
              <X size={20} />
            ) : collapsed ? (
              <PanelLeftOpen size={15} />
            ) : (
              <PanelLeftClose size={15} />
            )}
          </button>
        </div>
        <button className="sidebar-search" onClick={() => setSearchOpen(true)}>
          <Search size={15} />
          <span>Search anything</span>
          <kbd>Ctrl K</kbd>
        </button>
        <nav aria-label="Main navigation">
          {navigation.map(({ id: navId, label, Icon }) => (
            <button
              title={collapsed ? label : undefined}
              aria-label={label}
              aria-current={route === navId ? "page" : undefined}
              key={navId}
              className={`nav-item ${route === navId ? "active" : ""}`}
              onClick={() => navigate(navId)}
            >
              <Icon size={17} />
              <span>{label}</span>
              {navId === "emails" && (emailCount[0]?.count ?? 0) > 0 && (
                <small>{emailCount[0].count}</small>
              )}
              {navId === "assignments" && activeAssignments > 0 && (
                <small>{activeAssignments}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-semester">
          <div className="sidebar-label">
            SEMESTER
            <button
              aria-label="Add semester"
              onClick={() => edit({ kind: "semester" })}
            >
              <Plus size={13} />
            </button>
          </div>
          <div className="semester-select">
            <select
              aria-label="Current semester"
              value={semesterId}
              onChange={(e) => {
                setSemesterId(e.target.value);
                navigate("dashboard");
              }}
            >
              {data.semesters.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.status === "Archived" ? " · Archived" : ""}
                </option>
              ))}
            </select>
            <ChevronsUpDown size={13} />
          </div>
          <div className="sidebar-courses">
            {data.courses
              .filter((c) => !c.archived)
              .map((c) => (
                <button
                  key={c.id}
                  title={c.name}
                  className={route === "course" && id === c.id ? "active" : ""}
                  onClick={() => navigate(`course/${c.id}`)}
                >
                  <CourseDot color={c.color} />
                  <span>{c.code}</span>
                </button>
              ))}
          </div>
          <button
            className="sidebar-add-course"
            onClick={() => edit({ kind: "course" })}
          >
            <Plus size={14} />
            <span>Add course</span>
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${route === "archive" ? "active" : ""}`}
            onClick={() => navigate("archive")}
          >
            <Archive size={17} />
            <span>Archive</span>
          </button>
          <button
            className={`nav-item ${route === "settings" ? "active" : ""}`}
            onClick={() => navigate("settings")}
          >
            <Settings size={17} />
            <span>Settings</span>
          </button>
          {compact && <SyncIndicator />}
          <div className="sidebar-status">
            <HardDrive size={14} />
            <span>Local workspace</span>
            <span className="status-dot" />
          </div>
        </div>
      </NavigationDrawer>
      <div className="main-shell">
        <header className="topbar">
          {compact && (
            <button
              className="navigation-trigger"
              aria-label="Open navigation"
              aria-expanded={navigationOpen}
              onClick={() => setNavigationOpen(true)}
            >
              <PanelLeftOpen size={22} />
            </button>
          )}
          <span className="page-context">
            {route === "dashboard" ? (compact ? "UniDesk" : "") : pageLabel}
          </span>
          <div className="topbar-right">
            <button
              className="global-search-trigger"
              aria-label="Search workspace"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={19} />
            </button>

            {!compact && <SyncIndicator />}
            <button
              className="notification-trigger"
              aria-label="Notifications"
              onClick={() => setNotificationOpen(true)}
            >
              <Bell size={18} />
              {(unread[0]?.count ?? 0) > 0 && <span />}
            </button>
            <span className="topbar-divider" />
            <details className="quick-add">
              <summary>
                <Plus size={15} />
                Add
                <ChevronDown size={13} />
              </summary>
              <div className="menu-panel">
                {(
                  [
                    ["readings", "Reading"],
                    ["grade_items", "Grade"],
                  ] as const
                ).map(([table, label]) => (
                  <button
                    key={table}
                    onClick={(e) => {
                      e.currentTarget
                        .closest("details")
                        ?.removeAttribute("open");
                      setTrackingEditor(table);
                    }}
                  >
                    {label}
                  </button>
                ))}
                {(
                  [
                    "course",
                    "exam",
                    "assignment",
                    "event",
                    "semester",
                  ] as EntityKind[]
                ).map((kind) => (
                  <button
                    key={kind}
                    onClick={(e) => {
                      e.currentTarget
                        .closest("details")
                        ?.removeAttribute("open");
                      edit({
                        kind,
                        courseId: route === "course" ? id : undefined,
                      });
                    }}
                  >
                    <Plus size={14} />
                    {kind === "event"
                      ? "Calendar event"
                      : kind[0].toUpperCase() + kind.slice(1)}
                  </button>
                ))}
                <button
                  onClick={(e) => {
                    e.currentTarget.closest("details")?.removeAttribute("open");
                    setQuickFile(true);
                  }}
                >
                  <FileText size={14} />
                  File
                </button>
              </div>
            </details>
          </div>
        </header>
        <main key={page} className="main-content" data-page={route}>
          {route === "degree" ? (
            <DegreePage />
          ) : route === "emails" || route === "email" ? (
            <Emails
              initialId={route === "email" ? decodeURIComponent(id) : ""}
            />
          ) : route === "study" ? (
            <Dashboard />
          ) : route === "grades" ? (
            <SemesterGrades />
          ) : route === "dashboard" ? (
            <Dashboard />
          ) : route === "courses" ? (
            <Courses />
          ) : route === "course" ? (
            <CourseWorkspace id={id} />
          ) : route === "calendar" ? (
            <Calendar />
          ) : route === "assignments" ? (
            <AcademicLists kind="assignment" />
          ) : route === "exams" ? (
            <AcademicLists kind="exam" />
          ) : route === "exam" || route === "assignment" ? (
            <EntityDetail kind={route} id={id} />
          ) : route === "settings" ? (
            <SettingsPage />
          ) : route === "archive" ? (
            <ArchivePage />
          ) : (
            <Dashboard />
          )}
        </main>
        <footer className="app-footer">
          <span>UniDesk</span>
          <span>
            <kbd>Ctrl K</kbd> Quick search
          </span>
        </footer>
      </div>
      {trackingEditor && (
        <TrackingEditor
          table={trackingEditor}
          courseId={route === "course" ? id : undefined}
          onClose={() => setTrackingEditor(null)}
        />
      )}
      {quickFile && <QuickFile onClose={() => setQuickFile(false)} />}
      {editor && <Editor key={`${editor.kind}/${editor.id ?? "new"}`} />}
      {searchOpen && <CommandPalette onClose={() => setSearchOpen(false)} />}
      {notificationOpen && (
        <NotificationCenter onClose={() => setNotificationOpen(false)} />
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <Button
            variant="ghost"
            aria-label="Dismiss message"
            onClick={() => report("")}
          >
            <X size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}
