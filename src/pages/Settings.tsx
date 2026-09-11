import { version } from '../../package.json';
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Monitor, Sun, Moon, FolderOpen, HardDrive } from "lucide-react";
import {
  PageHeader,
  Section,
  Button,
  Field,
  ErrorText,
} from "../components/ui";
import { useWorkspace } from "../hooks/useWorkspace";
import { saveSetting } from "../db/repository";
import {
  chooseFolder,
  command,
  native,
  enableNotifications,
} from "../services/platform";
import { ScaleSettings } from "../features/academic/GradesView";
import {
  interfaceScales,
  resolveInterfaceScale,
} from "../hooks/useInterfaceScale";
import { EmailSettings } from "../features/email/EmailSettings";
import { AISettings } from '../features/ai/AISettings';
import { ProfessorDirectory } from "../features/email/ProfessorDirectory";
import { SyncSettings } from '../features/sync/SyncSettings';
export function Settings() {
  const { preferences, refresh, report, page } = useWorkspace();
  useEffect(()=>{if(page==='settings/email') document.getElementById('email-settings')?.scrollIntoView();},[page]);
  useEffect(()=>{if(page==='settings/ai') document.getElementById('ai-settings')?.scrollIntoView();},[page]);
  const [folder, setFolder] = useState(preferences.university_folder ?? ""),
    [error, setError] = useState("");
  const { data: locations } = useQuery({
    queryKey: ["locations"],
    queryFn: () =>
      command<{ database: string; defaultFolder: string }>("locations"),
  });
  async function save(key: string, value: string) {
    try {
      await saveSetting(key, value);
      await refresh();
      report("Settings saved");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <PageHeader title="Settings" subtitle="Make this workspace yours." />
      <div className="settings-content">
        <SyncSettings />
        <Section title="Calendar">
<Field label="Week starts on">
            <select
              value={preferences.week_start ?? "1"}
              onChange={(e) => void save("week_start", e.target.value)}
            >
              <option value="1">Monday</option>
              <option value="0">Sunday</option>
            </select>
          </Field>
</Section>
        <ScaleSettings />
        <Section title="Appearance">
          <p className="muted">Choose how UniDesk looks on this device.</p>
          <Field label="Interface size">
            <select
              value={preferences.interface_scale ?? "auto"}
              onChange={(e) => void save("interface_scale", e.target.value)}
            >
              <option value="auto">
                Automatic ({resolveInterfaceScale("auto", window.screen.width)}
                %)
              </option>
              {interfaceScales.map((scale) => (
                <option key={scale} value={scale}>
                  {scale}%
                </option>
              ))}
            </select>
          </Field>
          <p className="helper">
            Enlarges text, icons, and controls together. Automatic uses 150% on
            a 2560-pixel-wide display at Windows 100% scaling. Use Ctrl + / Ctrl
            − to adjust, or Ctrl 0 for 100%. Your choice is saved.
          </p>
          <div className="theme-options">
            {[
              { key: "system", label: "System", Icon: Monitor },
              { key: "light", label: "Light", Icon: Sun },
              { key: "dark", label: "Dark", Icon: Moon },
            ].map(({ key, label, Icon }) => (
              <button
                key={key}
                className={preferences.theme === key ? "selected" : ""}
                aria-pressed={preferences.theme === key}
                onClick={() => void save("theme", key)}
              >
                <span className={`theme-preview ${key}`}>
                  <i />
                  <i />
                  <i />
                </span>
                <span>
                  <Icon size={15} />
                  {label}
                  <span className="theme-radio" />
                </span>
              </button>
            ))}
          </div>
        </Section>
        <Section title="University storage">
          <Field label="Base university folder">
            <div className="input-group">
              <input
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
              />
              <Button
                aria-label="Choose storage folder"
                onClick={async () => {
                  try {
                    const result = await chooseFolder();
                    if (result) setFolder(result);
                    else
                      setError(
                        "Enter an absolute folder path here, or use the native picker in the desktop app.",
                      );
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <FolderOpen size={16} />
              </Button>
              <Button
                onClick={() => {
                  if (!/^(?:[a-zA-Z]:[\\/]|\/)/.test(folder))
                    setError("Enter an absolute folder path.");
                  else void save("university_folder", folder);
                }}
              >
                Save
              </Button>
            </div>
          </Field>
          <p className="helper">
            Used for new semesters. Existing semester folders stay in their
            current locations.
          </p>
          <div className="settings-row">
            <div>
              <strong>File import behavior</strong>
              <p>Original files are always preserved.</p>
            </div>
            <span>Copy into course storage</span>
          </div>
        </Section>
        <div id="email-settings"><EmailSettings /></div>
        <AISettings/>
        <ProfessorDirectory />
        <Section title="Notifications">
          <div className="settings-row">
            <div>
              <strong>Deadline reminders</strong>
              <p>Exam and assignment reminders while UniDesk is running.</p>
            </div>
            <button
              className={`toggle ${preferences.notifications === "true" ? "on" : ""}`}
              role="switch"
              aria-label="Deadline reminders"
              aria-checked={preferences.notifications === "true"}
              onClick={async () => {
                try {
                  if (preferences.notifications === "true")
                    await save("notifications", "false");
                  else if (await enableNotifications())
                    await save("notifications", "true");
                  else
                    setError(
                      native
                        ? "Allow notifications in system settings, then try again."
                        : "Notifications are available in the installed Windows or Android app.",
                    );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <span />
            </button>
          </div>
          <p className="helper">
            In-app reminders are always available. Deadlines are checked at
            startup.
          </p>
        </Section>
        <Section title="Local data">
          <div className="data-location">
            <HardDrive size={18} />
            <div>
              <strong>SQLite database</strong>
              <code>{locations?.database ?? "Loading…"}</code>
            </div>
          </div>
          <div className="data-location">
            <FolderOpen size={18} />
            <div>
              <strong>University files</strong>
              <code>{preferences.university_folder || "Not configured"}</code>
            </div>
          </div>
          <div className="settings-row">
            <div>
              <strong>Startup page</strong>
            </div>
            <span>Dashboard</span>
          </div>
        </Section>
        <ErrorText error={error} />
        <div className="settings-footer">
          UniDesk <span>{version}</span> · Local-first
        </div>
      </div>
    </>
  );
}
