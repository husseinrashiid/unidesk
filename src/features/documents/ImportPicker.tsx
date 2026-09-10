import { watchFileDrop } from "../../services/nativeUi";
import { useEffect, useState } from "react";
import { Button, ErrorText } from "../../components/ui";
import { desktop, capabilities, chooseFiles } from "../../services/platform";
import { extractLocalDocument, type ExtractedDocument } from "./localImport";
export function ImportPicker({
  onExtract,
  label = "Choose document",
}: {
  onExtract: (d: ExtractedDocument, file: File | string) => void;
  label?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function read(file: File | string) {
    setBusy(true);
    setError("");
    try {
      onExtract(await extractLocalDocument(file), file);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!desktop) return;
    let dispose: (() => void) | undefined;
    let active = true;
    void watchFileDrop(paths => { if(paths[0] && !busy) void read(paths[0]); }).then(unlisten => {
      if(active) dispose=unlisten; else unlisten();
    }).catch(error => setError(String(error)));
    return () => {
      active = false;
      dispose?.();
    };
  }, [busy]);
  return (
    <div
      className="import-picker"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!busy && e.dataTransfer.files[0])
          void read(e.dataTransfer.files[0]);
      }}
    >
      <label>
        {label}
        <input
          aria-label={label}
          type="file"
          accept=".pdf,.docx,.txt"
          disabled={busy}
          onChange={(e) => {
            if (e.target.files?.[0]) void read(e.target.files[0]);
            e.target.value = "";
          }}
        />
      </label>
      {capabilities.nativeFilePicker && (
        <Button
          disabled={busy}
          onClick={async () => {
            try {
              const [path] = await chooseFiles();
              if (path) void read(path);
            } catch (error) { setError(String(error)); }
          }}
        >
          Browse files
        </Button>
      )}
      <p className="helper" role="status">
        {busy
          ? "Reading document locally…"
          : "Drop a PDF, DOCX or text file here. Nothing is saved until you confirm."}
      </p>
      <ErrorText error={error} />
    </div>
  );
}
