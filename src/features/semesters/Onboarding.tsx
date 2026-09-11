import { useEffect, useState } from "react";
import { GraduationCap, FolderOpen, ArrowRight } from "lucide-react";
import { Button, Field, ErrorText } from "../../components/ui";
import { chooseFolder, command, deviceOS } from "../../services/platform";
import { createSemester } from "../../db/repository";
import { seedDemo } from "../../db/seed";
import { useWorkspace } from "../../hooks/useWorkspace";
import { SyncSettings } from '../sync/SyncSettings';
import { native } from '../../services/platform';
export function Onboarding() {
  const { refresh } = useWorkspace();
  const [step, setStep] = useState(0),
    [base, setBase] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (deviceOS === 'android') void command<{defaultFolder:string}>('locations').then(value => setBase(value.defaultFolder)).catch(error => setError(String(error)));
  }, []);
  async function start(demo = false, form?: HTMLFormElement) {
    setBusy(true);
    setError("");
    try {
      if (!base.trim())
        throw Error("Choose where your university files will be stored.");
      if (demo) await seedDemo(base);
      else {
        const values = new FormData(form);
        const start = String(values.get("start")),
          end = String(values.get("end"));
        if (end < start) throw Error("End date must be after the start date.");
        await createSemester({
          name: String(values.get("name")).trim(),
          start_date: start,
          end_date: end,
          base,
        });
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="onboarding">
      <div className="setup-brand">
        <span className="brand-icon">
          <GraduationCap size={22} />
        </span>
        UniDesk
      </div>
      <div className="setup-panel">
        {native && <details><summary>Connect an existing UniDesk workspace</summary><SyncSettings /></details>}
        <span className="eyebrow">YOUR ACADEMIC WORKSPACE</span>
        <h1>{step ? "Create your first semester" : "Welcome to UniDesk"}</h1>
        <p>
          {step
            ? "A place for your courses, deadlines, and materials."
            : "Choose where your university files are stored."}
        </p>
        {!step ? (
          <>
            <Field label="University folder">
              <div className="input-group">
                <input
                  value={base}
                  onChange={(e) => setBase(e.target.value)}
                  readOnly={deviceOS === 'android'}
                  placeholder="University folder"
                />
                <Button
                  aria-label="Choose university folder"
                  onClick={async () => {
                    const folder = await chooseFolder();
                    if (folder) setBase(folder);
                    else {
                      const locations = await command<{
                        defaultFolder: string;
                      }>("locations");
                      setBase(locations.defaultFolder);
                    }
                  }}
                >
                  <FolderOpen size={17} />
                </Button>
              </div>
            </Field>
            <p className="helper">
              Your documents stay in normal folders. Your academic data stays on
              this device.
            </p>
            <ErrorText error={error} />
            <Button
              variant="primary"
              onClick={() => {
                if (!base.trim())
                  setError("Choose a university folder to continue.");
                else {
                  setError("");
                  setStep(1);
                }
              }}
            >
              Continue
              <ArrowRight size={16} />
            </Button>
            <button
              className="demo-link"
              disabled={busy}
              onClick={() => void start(true)}
            >
              {busy ? "Creating workspace…" : "Explore with sample data"}
            </button>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void start(false, e.currentTarget);
            }}
          >
            <Field label="Semester name">
              <input
                name="name"
                defaultValue="Fall 2026"
                required
                maxLength={80}
              />
            </Field>
            <div className="form-grid">
              <Field label="Start date">
                <input
                  name="start"
                  type="date"
                  defaultValue="2026-08-31"
                  required
                />
              </Field>
              <Field label="End date">
                <input
                  name="end"
                  type="date"
                  defaultValue="2026-12-20"
                  required
                />
              </Field>
            </div>
            <ErrorText error={error} />
            <div className="form-actions">
              <Button type="button" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button variant="primary" disabled={busy}>
                {busy ? "Creating…" : "Create semester"}
              </Button>
            </div>
          </form>
        )}
      </div>
      <span className="setup-footer">Local by design. Yours to keep.</span>
    </div>
  );
}
