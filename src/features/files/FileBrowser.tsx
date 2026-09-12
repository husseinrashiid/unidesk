import { ResponsiveTable } from "../../components/ResponsiveTable";
import { watchFileDrop } from "../../services/nativeUi";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Folder, FolderPlus, Upload, Search, FolderOpen, RefreshCw } from "lucide-react";
import {
  Button,
  Modal,
  Field,
  Menu,
  Empty,
  ErrorText,
} from "../../components/ui";
import { useWorkspace } from "../../hooks/useWorkspace";
import {
  query,
  fileAction,
  importFile,
  chooseFiles,
  desktop,
  capabilities,
  command,
  createFileFolder,
  renameFileFolder,
  deleteFileFolder,
} from "../../services/platform";
import { categories, type AcademicFile, type Category, type FileFolder } from "../../types";
import { shortDate } from "../../utils/dates";
import {useDocuments,DocumentActions,DocumentText} from '../documents/Materials';
import {supportedDocument} from '../documents/types';
interface FileOperation {
  file: AcademicFile;
  action: "rename" | "move" | "remove" | "locate";
}
export function FileBrowser({
  courseId,
  category,
}: {
  courseId: string;
  category: Category;
}) {
  const { refresh, report, navigate } = useWorkspace();
  const {data:documents=[]}=useDocuments(courseId);
  const [textFile,setTextFile]=useState<string|null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folderDialog, setFolderDialog] = useState<"new" | FileFolder | null>(null);
  const [deleteFolder, setDeleteFolder] = useState<FileFolder | null>(null);
  const [search, setSearch] = useState(""),
    [sort, setSort] = useState("filename"),
    [descending, setDescending] = useState(false),
    [dragging, setDragging] = useState(false),
    [busy, setBusy] = useState(false),
    [operation, setOperation] = useState<FileOperation | null>(null),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const importing = useRef(false);
  const [conflict, setConflict] = useState<{
    name: string;
    resolve: (value: string) => void;
  } | null>(null);
  const { data: folders = [] } = useQuery({
    queryKey: ["file-folders", courseId, category],
    queryFn: () =>
      query<FileFolder>(
        "SELECT * FROM file_folders WHERE course_id=? AND category=? ORDER BY name",
        [courseId, category],
      ),
  });
  const { data: folderCounts = {} } = useQuery({
    queryKey: ["file-folder-counts", courseId, category],
    queryFn: async () => {
      const rows = await query<{ folder_id: string; n: number }>(
        "SELECT folder_id, COUNT(*) n FROM files WHERE course_id=? AND category=? AND folder_id IS NOT NULL GROUP BY folder_id",
        [courseId, category],
      );
      return Object.fromEntries(rows.map((r) => [r.folder_id, r.n])) as Record<string, number>;
    },
  });
  const currentFolder = folders.find((f) => f.id === folderId) ?? null;
  const { data: files = [], error: loadError } = useQuery({
    queryKey: ["files", courseId, category, folderId, search, sort, descending],
    queryFn: async () => {
      await command("scan_files", { courseId, category });
      return query<AcademicFile & {sync_state?:string}>(
        `SELECT f.*,CASE WHEN COALESCE(o.last_error,'')<>'' THEN 'error' ELSE b.state END sync_state FROM files f LEFT JOIN sync_blobs b ON b.file_id=f.id LEFT JOIN sync_outbox o ON o.table_name='files' AND o.record_key=json_array(f.id) WHERE course_id=? AND category=? AND folder_id IS ? AND filename LIKE ? ESCAPE '\\' ORDER BY ${sort} ${descending ? "DESC" : "ASC"} LIMIT 500`,
        [courseId, category, folderId, `%${search.replace(/[\\%_]/g, "\\$&")}%`],
      );
    },
  });
  async function addFiles(items: (File | string)[]) {
    if (!items.length || importing.current) return;
    importing.current = true;
    setBusy(true);
    setError("");
    let added = 0;
    try {
      for (const item of items) {
        let result = await importFile(courseId, category, item, undefined, folderId ?? undefined);
        if (result.conflict) {
          const choice = await new Promise<string>((resolve) =>
            setConflict({ name: result.filename!, resolve }),
          );
          setConflict(null);
          if (choice === "cancel") continue;
          result = await importFile(courseId, category, item, choice, folderId ?? undefined);
        }
        if (result.id) added++;
      }
      await refresh();
      if (added)
        report(
          `${added} ${added === 1 ? "file" : "files"} copied to ${currentFolder ? currentFolder.name : category}`,
        );
    } catch (e) {
      setError((e as Error).message);
      await refresh();
    } finally {
      importing.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!capabilities.nativeDragDrop) return;
    let cleanup: (() => void) | undefined,
      disposed = false;
    void watchFileDrop(paths => {
      const topDialog = Array.from(document.querySelectorAll("dialog[open]")).at(-1);
      if (topDialog && !topDialog.contains(area.current)) return;
      setDragging(false);
      void addFiles(paths);
    }).then(unlisten => { if (disposed) unlisten(); else cleanup=unlisten; }).catch(error => setError(String(error)));
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [courseId, category, folderId]);
  async function act(file: AcademicFile, action: Parameters<typeof fileAction>[1]) {
    try {
      await fileAction(file.id, action);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function sortBy(column: string) {
    if (sort === column) setDescending(!descending);
    else {
      setSort(column);
      setDescending(false);
    }
  }
  return (
    <div
      ref={area}
      className={`file-browser ${dragging ? "dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {folderId === null ? (
        folders.length > 0 && (
          <div className="folder-chips">
            {folders.map((f) => (
              <div className="folder-chip" key={f.id}>
                <button className="folder-chip-open" onClick={() => setFolderId(f.id)}>
                  <Folder size={15} />
                  {f.name}
                  <span className="muted small">{folderCounts[f.id] ?? 0}</span>
                </button>
                <Menu label={`Actions for folder ${f.name}`}>
                  <button onClick={() => setFolderDialog(f)}>Rename</button>
                  <button className="delete-link" onClick={() => setDeleteFolder(f)}>Delete folder</button>
                </Menu>
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="folder-breadcrumb">
          <button onClick={() => setFolderId(null)}>{category}</button>
          <span> / </span>
          <span>{currentFolder?.name}</span>
        </div>
      )}
      <div className="file-toolbar">
        <div className="search-field">
          <Search size={15} />
          <input
            data-page-search
            aria-label="Search files"
            placeholder={`Search ${category.toLowerCase()}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="muted small">
          {files.length}
          {files.length === 500 ? "+" : ""} files
        </span>
        <div className="spacer" />
        {folderId === null && (
          <Button variant="ghost" disabled={busy} onClick={() => setFolderDialog("new")}>
            <FolderPlus size={15} />
            New folder
          </Button>
        )}
        <Button
          variant="ghost"
          aria-label="Refresh files"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} />
        </Button>
        <Button
          disabled={busy}
          onClick={async () => {
            if (capabilities.nativeFilePicker) {
              try {
                void addFiles(await chooseFiles());
              } catch (e) {
                setError((e as Error).message);
              }
            } else input.current?.click();
          }}
        >
          <Upload size={15} />
          {busy ? "Copying…" : "Add files"}
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void addFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>
      <ErrorText error={error || loadError?.message || ""} />
      <div className="table-wrap">
        <ResponsiveTable className="file-table">
          <thead>
            <tr>
              {[
                ["filename", "Name"],
                ["extension", "Type"],
                ["size", "Size"],
                ["added_at", "Date added"],
                ["modified_at", "Modified"],
              ].map(([key, title]) => (
                <th key={key}>
                  <button onClick={() => sortBy(key)}>
                    {title}
                    {sort === key ? (descending ? " ↓" : " ↑") : ""}
                  </button>
                </th>
              ))}
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr
                key={file.id}
                tabIndex={0}
                onDoubleClick={() => void act(file, "open")}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && e.key === "Enter")
                    void act(file, "open");
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.currentTarget
                    .querySelector("details")
                    ?.setAttribute("open", "");
                }}
              >
                <td>
                  <button
                    className="file-name"
                    onClick={() => void act(file, "open")}
                  >
                    <FileText size={17} />
                    {file.filename}
                  </button>
                  {file.sync_state && <small className="document-status">{{cloud_available:'Available in cloud',downloading:'Downloading',available_offline:'Available offline',upload_pending:'Upload pending',error:'File transfer needs retry'}[file.sync_state]??file.sync_state}</small>}
                  {supportedDocument(file.extension) && category!=='Recordings' && <small className="document-status">{documents.find(d=>d.file_id===file.id)?.status?.replace('Removed','Not indexed') ?? 'Not indexed'}</small>}
                </td>
                <td className="muted uppercase">{file.extension || "—"}</td>
                <td className="muted">
                  {file.size < 1024
                    ? `${file.size} B`
                    : file.size < 1048576
                      ? `${(file.size / 1024).toFixed(1)} KB`
                      : `${(file.size / 1048576).toFixed(1)} MB`}
                </td>
                <td className="muted">{shortDate(file.added_at)}</td>
                <td className="muted">{shortDate(file.modified_at)}</td>
                <td>
                  <Menu label={`Actions for ${file.filename}`}>
                    <button onClick={() => void act(file, "open")}>Open</button>
                    {capabilities.native && file.sync_state && <><button disabled={file.sync_state==='available_offline'} onClick={()=>void act(file,'download')}>Download for offline use</button><button disabled={file.sync_state!=='available_offline'} onClick={()=>void act(file,'evict')}>Remove local copy</button></>}
                    {supportedDocument(file.extension) && category!=='Recordings' && <DocumentActions fileId={file.id} onBrowse={()=>setTextFile(file.id)} onSearch={()=>navigate(`course/${courseId}/Materials/${file.id}`)}/>}
                    {capabilities.shareFile && <><button onClick={() => void act(file, "share")}>Share file</button><button onClick={() => void act(file, "export")}>Save a copy</button></>}
                    {capabilities.revealFile && <button onClick={() => void act(file, "reveal")}>
                      Reveal in Explorer
                    </button>}
                    <button
                      onClick={() => setOperation({ file, action: "rename" })}
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => setOperation({ file, action: "move" })}
                    >
                      Move…
                    </button>
                    <button
                      onClick={() => setOperation({ file, action: "locate" })}
                    >
                      Locate file
                    </button>
                    <button
                      className="delete-link"
                      onClick={() => setOperation({ file, action: "remove" })}
                    >
                      Delete everywhere
                    </button>
                  </Menu>
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveTable>
      </div>
      {!files.length && !loadError && (
        <Empty
          title={
            search
              ? "No matching files"
              : `No files in ${currentFolder ? currentFolder.name : category.toLowerCase()}`
          }
          description="Drop files here or choose Add files. Originals stay where they are."
        />
      )}
      {dragging && (
        <div className="drop-overlay">
          <Upload size={22} />
          Drop files into {currentFolder ? currentFolder.name : category}
        </div>
      )}
      {conflict && (
        <Modal
          title="A file with this name already exists"
          onClose={() => conflict.resolve("cancel")}
        >
          <div className="modal-body">
            <p>“{conflict.name}” is already in this folder.</p>
            <p className="muted">
              Keep both adds a number to the new copy. Replace updates the
              stored copy.
            </p>
            <div className="form-actions">
              <Button onClick={() => conflict.resolve("cancel")}>Cancel</Button>
              <Button onClick={() => conflict.resolve("replace")}>
                Replace
              </Button>
              <Button
                variant="primary"
                onClick={() => conflict.resolve("keep")}
              >
                Keep both
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {textFile && <DocumentText fileId={textFile} courseId={courseId} onClose={()=>setTextFile(null)}/>}
      {operation && (
        <FileDialog operation={operation} courseId={courseId} category={category} onClose={() => setOperation(null)} />
      )}
      {folderDialog && (
        <FolderDialog
          courseId={courseId}
          category={category}
          folder={folderDialog === "new" ? undefined : folderDialog}
          onClose={() => setFolderDialog(null)}
          onDone={async (id) => {
            await refresh();
            if (folderDialog === "new") setFolderId(id);
          }}
        />
      )}
      {deleteFolder && (
        <FolderDeleteDialog
          folder={deleteFolder}
          category={category}
          fileCount={folderCounts[deleteFolder.id] ?? 0}
          onClose={() => setDeleteFolder(null)}
          onDone={async () => {
            if (folderId === deleteFolder.id) setFolderId(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}
function FolderDialog({
  courseId,
  category,
  folder,
  onClose,
  onDone,
}: {
  courseId: string;
  category: Category;
  folder?: FileFolder;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [value, setValue] = useState(folder?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      if (folder) {
        await renameFileFolder(folder.id, value);
        onDone(folder.id);
      } else {
        const result = await createFileFolder(courseId, category, value);
        onDone(result.id);
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={folder ? "Rename folder" : "New folder"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="modal-body">
          <Field label="Folder name">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <ErrorText error={error} />
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy}>
            {busy ? "Saving…" : folder ? "Rename folder" : "Create folder"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function FolderDeleteDialog({
  folder,
  category,
  fileCount,
  onClose,
  onDone,
}: {
  folder: FileFolder;
  category: Category;
  fileCount: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"keep" | "delete">("keep");
  const [disk, setDisk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      await deleteFileFolder(folder.id, mode, disk);
      await onDone();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Delete “${folder.name}”`} onClose={onClose}>
      <div className="modal-body">
        <p>
          {fileCount
            ? `This deletes the “${folder.name}” folder. ${fileCount} ${fileCount === 1 ? "file" : "files"} inside will move back to the ${category} root and keep their history.`
            : `This deletes the empty “${folder.name}” folder.`}
        </p>
        {fileCount > 0 && (
          <label className="check-label">
            <input
              type="checkbox"
              checked={mode === "delete"}
              onChange={(e) => setMode(e.target.checked ? "delete" : "keep")}
            />
            Also delete the {fileCount} {fileCount === 1 ? "file" : "files"} inside
          </label>
        )}
        {mode === "delete" && desktop && (
          <label className="check-label">
            <input
              type="checkbox"
              checked={disk}
              onChange={(e) => setDisk(e.target.checked)}
            />
            Also move files on disk to Recycle Bin
          </label>
        )}
        <ErrorText error={error} />
      </div>
      <div className="modal-footer">
        <Button type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button variant={mode === "delete" ? "danger" : "primary"} disabled={busy} onClick={() => void submit()}>
          {busy ? "Deleting…" : "Delete folder"}
        </Button>
      </div>
    </Modal>
  );
}
function FileDialog({
  operation,
  courseId,
  category,
  onClose,
}: {
  operation: FileOperation;
  courseId: string;
  category: Category;
  onClose: () => void;
}) {
  const { refresh, report } = useWorkspace();
  const [value, setValue] = useState(
      operation.action === "rename"
        ? operation.file.filename
        : operation.action === "move"
          ? operation.file.category
          : "",
    ),
    [folderChoice, setFolderChoice] = useState(
      operation.action === "move" ? (operation.file.folder_id ?? "") : "",
    ),
    [disk, setDisk] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const { data: folders = [] } = useQuery({
    queryKey: ["file-folders", courseId, value],
    queryFn: () =>
      query<FileFolder>(
        "SELECT * FROM file_folders WHERE course_id=? AND category=? ORDER BY name",
        [courseId, value],
      ),
    enabled: operation.action === "move",
  });
  useEffect(() => {
    if (operation.action !== "move") return;
    if (value !== operation.file.category) setFolderChoice("");
    else setFolderChoice(operation.file.folder_id ?? "");
  }, [value, operation]);
  const titles = {
    rename: "Rename file",
    move: "Move file",
    remove: "Delete everywhere",
    locate: "Locate file",
  };
  async function submit() {
    setBusy(true);
    try {
      await fileAction(operation.file.id, operation.action, {
        name: value,
        category: value,
        source: value,
        folder: folderChoice,
        disk,
      });
      await refresh();
      report(
        operation.action === "remove"
          ? disk
            ? "File moved to Recycle Bin"
            : "File deleted from UniDesk; deletion will sync"
          : "File updated",
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={titles[operation.action]} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="modal-body">
          <p className="muted">{operation.file.filename}</p>
          {operation.action === "remove" ? (
            <>
              <p>This deletes the file record from UniDesk on every synced device. To keep the cloud file and remove only this download, use Remove local copy instead.</p>
              {desktop && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={disk}
                    onChange={(e) => setDisk(e.target.checked)}
                  />
                  Also move the file on disk to Recycle Bin
                </label>
              )}
              <small className="muted">
                Files on disk are kept unless explicitly selected above.
              </small>
            </>
          ) : operation.action === "move" ? (
            <>
              <Field label="Category">
                <select value={value} onChange={(e) => setValue(e.target.value)}>
                  {categories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Folder">
                <select value={folderChoice} onChange={(e) => setFolderChoice(e.target.value)}>
                  <option value="">(no folder)</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          ) : (
            <Field
              label={
                operation.action === "rename"
                  ? "File name"
                  : "Existing file path"
              }
            >
              <div className="input-group">
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  required
                  autoFocus
                />
                {operation.action === "locate" && desktop && (
                  <Button
                    type="button"
                    aria-label="Locate file on disk"
                    onClick={async () => {
                      const files = await chooseFiles();
                      if (files[0]) setValue(files[0]);
                    }}
                  >
                    <FolderOpen size={16} />
                  </Button>
                )}
              </div>
            </Field>
          )}
          <ErrorText error={error} />
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={operation.action === "remove" ? "danger" : "primary"}
            disabled={busy}
          >
            {busy ? "Saving…" : titles[operation.action]}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
