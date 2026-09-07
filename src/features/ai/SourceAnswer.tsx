import { useState } from "react";
import { Button, ErrorText, Modal } from "../../components/ui";
import { fileAction } from "../../services/platform";
import { useWorkspace } from "../../hooks/useWorkspace";
import type { Source } from "./retrieval";
import type { Answer } from "./prompts";
export function SourceAnswer({
  answer,
  sources,
}: {
  answer: Answer;
  sources: Source[];
}) {
  const { navigate } = useWorkspace();
  const [selected, setSelected] = useState<Source | null>(null),
    [error, setError] = useState("");
  return (
    <div className="ai-answer">
      {answer.insufficient && (
        <p className="helper">
          The selected excerpts do not provide enough evidence for a reliable
          full answer.
        </p>
      )}
      {answer.sections.map((s, i) => (
        <section key={i}>
          <strong>{s.title}</strong>
          <p style={{ whiteSpace: "pre-wrap" }}>{s.text}</p>
          {s.citations.map((c, j) => (
            <button
              className="ai-citation"
              key={j}
              onClick={() =>
                setSelected(sources.find((s) => s.label === c.source) ?? null)
              }
            >
              [{c.source.replace("SOURCE_", "")}]
            </button>
          ))}
        </section>
      ))}
      {answer.general && (
        <section>
          <strong>General explanation · outside your materials</strong>
          <p>{answer.general}</p>
        </section>
      )}
      <details>
        <summary>Sources used · {sources.length}</summary>
        {sources.map((s) => (
          <div className="material-result" key={s.label}>
            <button onClick={() => setSelected(s)}>
              [{s.label.replace("SOURCE_", "")}] {s.title}
            </button>
            <small>{s.location}</small>
          </div>
        ))}
      </details>
      {selected && (
        <Modal title={selected.title} onClose={() => setSelected(null)}>
          <div className="modal-body">
            <p className="helper">
              {selected.location} · Excerpt retained with this generated result.
              Check the original for current content.
            </p>
            <p style={{ whiteSpace: "pre-wrap" }}>{selected.text}</p>
            <Button
              onClick={() =>
                selected.fileId
                  ? void fileAction(selected.fileId, "open").catch((e) =>
                      setError((e as Error).message),
                    )
                  : navigate(`emails/message/${selected.emailId}`)
              }
            >
              Open original source
            </Button>
            <ErrorText error={error} />
          </div>
        </Modal>
      )}
    </div>
  );
}
export function answerText(answer: Answer, sources: Source[]) {
  return (
    answer.sections
      .map(
        (s) =>
          `${s.title}\n${s.text} ${s.citations.map((c) => `[${c.source.replace("SOURCE_", "")}]`).join(" ")}`,
      )
      .join("\n\n") +
    (answer.general ? `\n\nGeneral explanation\n${answer.general}` : "") +
    "\n\nSources\n" +
    sources
      .map(
        (s) => `[${s.label.replace("SOURCE_", "")}] ${s.title} · ${s.location}`,
      )
      .join("\n")
  );
}
