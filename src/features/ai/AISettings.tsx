import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Section, Field, ErrorText } from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import { batch, command, native as desktop, query } from "../../services/platform";
export function AISettings() {
  const { preferences, refresh, report } = useWorkspace();
  const [key, setKey] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [models, setModels] = useState({
    fast: preferences.ai_fast_model ?? "gpt-5-mini",
    balanced: preferences.ai_balanced_model ?? "gpt-5-mini",
    advanced: preferences.ai_advanced_model ?? "",
  });
  const [max, setMax] = useState(preferences.ai_max_sources ?? "10");
  const { data: status, refetch } = useQuery({
    queryKey: ["ai-credentials"],
    queryFn: () =>
      desktop
        ? command<{ configured: boolean }>("ai_credentials", {
            action: "status",
          })
        : Promise.resolve({ configured: false }),
  });
  const { data: usage = [] } = useQuery({
    queryKey: ["ai-usage"],
    queryFn: () =>
      query<{ requests: number; input: number; output: number }>(
        "SELECT count(*) requests,coalesce(sum(input_tokens),0) input,coalesce(sum(output_tokens),0) output FROM ai_usage WHERE created_at>=date('now','start of month')",
      ),
  });
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await refetch();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div id="ai-settings">
      <Section title="AI">
        <p>
          OpenAI · {status?.configured ? "Key saved" : "Not configured"}. API
          billing is separate from your ChatGPT subscription.
        </p>
        <p className="helper">
          Cloud AI sends only selected or retrieved excerpts for the action you
          request. Files, local search, and cached results work with AI off. No
          automatic document uploads.
        </p>
        <Field label="Cloud AI">
          <select
            value={preferences.ai_enabled ?? "false"}
            onChange={(e) =>
              void run(() =>
                batch([
                  {
                    sql: "INSERT INTO settings(key,value) VALUES('ai_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    params: [e.target.value],
                  },
                ]),
              )
            }
          >
            <option value="false">Off</option>
            <option value="true">On</option>
          </select>
        </Field>
        <Field label="OpenAI API key">
          <input
            type="password"
            autoComplete="off"
            value={key}
            placeholder="Stored in device secure storage"
            onChange={(e) => setKey(e.target.value)}
          />
        </Field>
        <div className="email-actions">
          <Button
            disabled={busy || !desktop || !key}
            onClick={() =>
              void run(async () => {
                await command("ai_credentials", { action: "save", key });
                setKey("");
                report("API key saved securely.");
              })
            }
          >
            Save API key
          </Button>
          <Button
            disabled={busy || !desktop || !status?.configured}
            onClick={() =>
              void run(() => command("ai_credentials", { action: "remove" }))
            }
          >
            Remove API key
          </Button>
        </div>
        {!desktop && (
          <p className="helper">
            Configure credentials and run cloud requests in the desktop app.
          </p>
        )}
        {(["fast", "balanced", "advanced"] as const).map((role) => (
          <Field
            key={role}
            label={`${role[0].toUpperCase() + role.slice(1)} model${role === "advanced" ? " (manual only)" : ""}`}
          >
            <input
              value={models[role]}
              onChange={(e) => setModels({ ...models, [role]: e.target.value })}
            />
          </Field>
        ))}
        <Field label="Maximum retrieved sources">
          <input
            type="number"
            min="1"
            max="20"
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
        </Field>
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (
                !Number.isInteger(Number(max)) ||
                Number(max) < 1 ||
                Number(max) > 20 ||
                Object.values(models).some(
                  (m) => m && !/^[a-zA-Z0-9._:-]{1,100}$/.test(m),
                )
              )
                throw Error("Use valid model IDs and 1–20 sources.");
              await batch([
                ...Object.entries(models).map(([role, value]) => ({
                  sql: "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                  params: [`ai_${role}_model`, value],
                })),
                {
                  sql: "INSERT INTO settings(key,value) VALUES('ai_max_sources',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                  params: [max],
                },
              ]);
              report("AI settings saved.");
            })
          }
        >
          Save AI settings
        </Button>
        <p className="helper">
          Automatic routing uses Fast for extraction and summaries, Balanced for
          questions and study generation. Advanced runs only when explicitly
          selected.
        </p>
        <p className="helper">
          This month: {usage[0]?.requests ?? 0} requests ·{" "}
          {usage[0]?.input ?? 0} input tokens · {usage[0]?.output ?? 0} output
          tokens. Actual charges depend on your API account.
        </p>
        <ErrorText error={error} />
      </Section>
    </div>
  );
}
