import { useEffect } from "react";
import { useWorkspace } from "./hooks/useWorkspace";
import { AppShell } from "./layouts/AppShell";
import { Onboarding } from "./features/semesters/Onboarding";
import { Button } from "./components/ui";
import { useInterfaceScale } from "./hooks/useInterfaceScale";
import { PdfHost } from './features/files/PdfViewer';
import { SyncWorker } from './features/sync/SyncSettings';
export function App() {
  useInterfaceScale();
  const { data, preferences, loading, error, refresh } = useWorkspace();
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        (preferences.theme ?? "system") === "system"
          ? media.matches
            ? "dark"
            : "light"
          : preferences.theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preferences.theme]);
  if (error)
    return (
      <div className="startup-error">
        <h1>Couldn’t open your workspace</h1>
        <p>{error.message}</p>
        <Button onClick={() => void refresh()}>Try again</Button>
      </div>
    );
  if (loading) return <div className="startup-loading">Opening UniDesk…</div>;
  return <><SyncWorker />{data.semesters.length ? <><AppShell /><PdfHost /></> : <Onboarding />}</>;
}
