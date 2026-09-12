import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { categories, type Statement, type SqlValue } from "../src/types";

export function safeName(name: string): string {
  const clean = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/g, "");
  if (
    !clean ||
    clean === "." ||
    clean === ".." ||
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(clean)
  )
    throw Error("Choose a valid Windows file or folder name.");
  return clean;
}
export function openDatabase(filename: string) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
  );
  const version = (
    db.prepare("PRAGMA user_version").get() as { user_version: number }
  ).user_version;
  if (version < 1) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(fs.readFileSync(path.resolve("src/db/001_initial.sql"), "utf8"));
      db.exec("PRAGMA user_version=1; COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  if (version < 2) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(
        fs.readFileSync(path.resolve("src/db/002_file_discovery.sql"), "utf8"),
      );
      db.exec("PRAGMA user_version=2; COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (version < 3) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(fs.readFileSync(path.resolve("src/db/003_academic_tracking.sql"), "utf8"));
      db.exec("PRAGMA user_version=3; COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  if (version < 4) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(fs.readFileSync(path.resolve("src/db/004_email.sql"), "utf8"));
      db.exec("PRAGMA user_version=4; COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  if (version < 5) {
    db.exec("BEGIN IMMEDIATE");
    try { db.exec(fs.readFileSync(path.resolve("src/db/005_email_workflows.sql"), "utf8")); db.exec("PRAGMA user_version=5; COMMIT"); }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  if (version < 6) {
    if (version > 0) {
      const backupDir=path.join(path.dirname(filename),'backups');
      fs.mkdirSync(backupDir,{recursive:true});
      db.prepare('VACUUM INTO ?').run(path.join(backupDir,`unidesk-before-phase4-${randomUUID()}.db`));
    }
    db.exec('BEGIN IMMEDIATE');
    try {db.exec(fs.readFileSync(path.resolve('src/db/006_documents.sql'),'utf8'));db.exec('PRAGMA user_version=6; COMMIT');}
    catch(error){db.exec('ROLLBACK');throw error;}
  }
  if(version<7){
    if(version>=6){const dir=path.join(path.dirname(filename),'backups');fs.mkdirSync(dir,{recursive:true});db.prepare('VACUUM INTO ?').run(path.join(dir,`unidesk-before-ai-${randomUUID()}.db`));}
    db.exec('BEGIN IMMEDIATE');try{db.exec(fs.readFileSync(path.resolve('src/db/007_ai.sql'),'utf8'));db.exec('PRAGMA user_version=7; COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  }
  if(version<8){db.exec('BEGIN IMMEDIATE');try{db.exec(fs.readFileSync(path.resolve('src/db/008_ai_results.sql'),'utf8'));db.exec('PRAGMA user_version=8; COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
  if(version<9){db.exec('BEGIN IMMEDIATE');try{db.exec(fs.readFileSync(path.resolve('src/db/009_syllabus.sql'),'utf8'));db.exec('PRAGMA user_version=9; COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
  if(version<10){db.exec('BEGIN IMMEDIATE');try{db.exec(fs.readFileSync(path.resolve('src/db/010_exam_questions.sql'),'utf8'));db.exec('PRAGMA user_version=10; COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
  if(version<11){db.exec('BEGIN IMMEDIATE');try{db.exec(fs.readFileSync(path.resolve('src/db/011_ai_email_sources.sql'),'utf8'));db.exec('PRAGMA user_version=11; COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
  if(version<12){
    if(version>=7){const dir=path.join(path.dirname(filename),'backups');fs.mkdirSync(dir,{recursive:true});db.prepare('VACUUM INTO ?').run(path.join(dir,`unidesk-before-gmail-${randomUUID()}.db`));}
    db.exec('BEGIN IMMEDIATE');try{db.exec(fs.readFileSync(path.resolve('src/db/012_gmail.sql'),'utf8'));db.exec('PRAGMA user_version=12; COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  }
  if(version<13){
    if(version===12){const dir=path.join(path.dirname(filename),'backups');fs.mkdirSync(dir,{recursive:true});db.prepare('VACUUM INTO ?').run(path.join(dir,`unidesk-before-instructor-links-${randomUUID()}.db`));}
    db.exec('BEGIN IMMEDIATE');try{db.exec(fs.readFileSync(path.resolve('src/db/013_instructor_email_links.sql'),'utf8'));db.exec('PRAGMA user_version=13; COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  }
  if(version<14){db.exec('BEGIN IMMEDIATE');try{db.exec(fs.readFileSync(path.resolve('src/db/014_local_academic_imports.sql'),'utf8'));db.exec('PRAGMA user_version=14; COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
  if(version<15){db.exec('BEGIN IMMEDIATE');try{db.exec(fs.readFileSync(path.resolve('src/db/015_academic_rework.sql'),'utf8'));db.exec('PRAGMA user_version=15; COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
  if(version<16){db.exec('BEGIN IMMEDIATE');try{db.exec(fs.readFileSync(path.resolve('src/db/016_syllabus_page.sql'),'utf8'));db.exec('PRAGMA user_version=16; COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
  if(version<17){db.exec('BEGIN IMMEDIATE');try{db.exec(fs.readFileSync(path.resolve('src/db/017_device_sync.sql'),'utf8'));db.exec('PRAGMA user_version=17; COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
  if(version<18){db.exec('BEGIN IMMEDIATE');try{db.exec(fs.readFileSync(path.resolve('src/db/018_sync_account_files.sql'),'utf8'));db.exec('PRAGMA user_version=18; COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
  if(version<19){db.exec('BEGIN IMMEDIATE');try{db.exec(fs.readFileSync(path.resolve('src/db/019_file_availability.sql'),'utf8'));db.exec('PRAGMA user_version=19; COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
  if(version<20){db.exec('BEGIN IMMEDIATE');try{db.exec(fs.readFileSync(path.resolve('src/db/020_file_folders.sql'),'utf8'));db.exec('PRAGMA user_version=20; COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
  if(version<21){db.exec('BEGIN IMMEDIATE');try{db.exec(fs.readFileSync(path.resolve('src/db/021_folder_sync.sql'),'utf8'));db.exec('PRAGMA user_version=21; COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
  return db;
}
export function batch(db: DatabaseSync, statements: Statement[]) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = statements.map((s) => {
      const result = db.prepare(s.sql).run(...(s.params ?? []));
      if (s.expectChanges !== undefined && Number(result.changes) !== s.expectChanges)
        throw Error("This suggestion or academic record has changed. Reopen it before applying.");
      return result;
    });
    db.exec("COMMIT");
    return result.map((r) => ({ changes: Number(r.changes) }));
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
function fileRecord(db: DatabaseSync, id: string) {
  const row = db.prepare("SELECT * FROM files WHERE id=?").get(id) as
    | {
        id: string;
        absolute_path: string;
        course_id: string;
        filename: string;
        category: string;
        folder_id: string | null;
      }
    | undefined;
  if (!row) throw Error("This file reference no longer exists.");
  return row;
}
function courseRecord(db: DatabaseSync, id: string) {
  const row = db.prepare("SELECT * FROM courses WHERE id=?").get(id) as
    { id: string; semester_id: string; folder_path: string } | undefined;
  if (!row) throw Error("This course no longer exists.");
  return row;
}
function resolveFolder(db: DatabaseSync, folderId: string, courseId: string, category: string) {
  const row = db
    .prepare("SELECT course_id, category, name FROM file_folders WHERE id=?")
    .get(folderId) as { course_id: string; category: string; name: string } | undefined;
  if (!row || row.course_id !== courseId || row.category !== category)
    throw Error("Choose a valid folder.");
  return row.name;
}
function inside(root: string, target: string) {
  const relative = path.relative(
    fs.realpathSync(root),
    fs.realpathSync(target),
  );
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw Error("The file is outside the course storage folder.");
}
function uniquePath(folder: string, name: string) {
  let target = path.join(folder, name);
  const ext = path.extname(name),
    stem = path.basename(name, ext);
  let i = 2;
  while (fs.existsSync(target)) {
    target = path.join(folder, `${stem} (${i++})${ext}`);
  }
  return target;
}
export function importFile(
  db: DatabaseSync,
  args: {
    courseId: string;
    category: string;
    source?: string;
    filename?: string;
    bytes?: number[];
    conflict?: string;
    folderId?: string;
  },
) {
  if (!categories.includes(args.category as (typeof categories)[number]))
    throw Error("Choose a valid file category.");
  const course = courseRecord(db, args.courseId);
  const folderName = args.folderId
    ? resolveFolder(db, args.folderId, args.courseId, args.category)
    : undefined;
  const folder = folderName
    ? path.join(course.folder_path, args.category, folderName)
    : path.join(course.folder_path, args.category);
  fs.mkdirSync(folder, { recursive: true });
  inside(course.folder_path, folder);
  const name = safeName(args.filename ?? path.basename(args.source ?? ""));
  let target = path.join(folder, name);
  let backup: string | undefined;
  let owned = false;
  if (fs.existsSync(target)) {
    if (!args.conflict) return { conflict: true, filename: name };
    if (args.conflict === "keep") target = uniquePath(folder, name);
    else if (args.conflict === "replace") {
      if (
        args.source &&
        path.resolve(args.source).toLowerCase() === target.toLowerCase()
      )
        throw Error("This file is already in that folder.");
      backup = uniquePath(folder, `.unidesk-backup-${name}`);
      fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
    } else return { cancelled: true };
  }
  try {
    if (args.source)
      fs.copyFileSync(
        args.source,
        target,
        backup ? 0 : fs.constants.COPYFILE_EXCL,
      );
    else
      fs.writeFileSync(target, Buffer.from(args.bytes ?? []), {
        flag: backup ? "w" : "wx",
      });
    owned = true;
    const stat = fs.statSync(target);
    const existing = db
      .prepare("SELECT id FROM files WHERE absolute_path=?")
      .get(target) as { id: string } | undefined;
    const id = existing?.id ?? randomUUID();
    batch(db, [
      {
        sql: "DELETE FROM ignored_files WHERE absolute_path=?",
        params: [target],
      },
      {
        sql: "INSERT INTO files (id,course_id,semester_id,filename,original_filename,category,absolute_path,extension,size,created_at,modified_at,folder_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(absolute_path) DO UPDATE SET size=excluded.size,modified_at=excluded.modified_at",
        params: [
          id,
          course.id,
          course.semester_id,
          path.basename(target),
          name,
          args.category,
          target,
          path.extname(target).slice(1),
          stat.size,
          stat.birthtime.toISOString(),
          stat.mtime.toISOString(),
          args.folderId ?? null,
        ],
      },
    ]);
    if (backup) {
      try {
        fs.unlinkSync(backup);
      } catch {
        /* A recovery copy may safely remain. */
      }
    }
    return { id };
  } catch (e) {
    if (backup) fs.copyFileSync(backup, target);
    else if (owned && fs.existsSync(target)) fs.unlinkSync(target);
    throw e;
  }
}
export function fileAction(
  db: DatabaseSync,
  args: {
    id: string;
    action: string;
    name?: string;
    category?: string;
    source?: string;
    disk?: boolean;
    folder?: string;
  },
) {
  const file = fileRecord(db, args.id),
    course = courseRecord(db, file.course_id);
  const old = file.absolute_path;
  if (args.action === "remove" && !args.disk) {
    batch(db, [
      {
        sql: "INSERT OR IGNORE INTO ignored_files(absolute_path,course_id) VALUES(?,?)",
        params: [file.absolute_path, file.course_id],
      },
      { sql: "DELETE FROM files WHERE id=?", params: [file.id] },
    ]);
    return;
  }
  if (args.action === "locate") {
    if (!args.source || !fs.statSync(args.source).isFile())
      throw Error("Choose an existing file.");
    const stat = fs.statSync(args.source);
    db.prepare(
      "UPDATE files SET absolute_path=?,filename=?,extension=?,size=?,modified_at=? WHERE id=?",
    ).run(
      path.resolve(args.source),
      path.basename(args.source),
      path.extname(args.source).slice(1),
      stat.size,
      stat.mtime.toISOString(),
      file.id,
    );
    return;
  }
  if (!fs.existsSync(old))
    throw Error(
      "File not found. It may have been moved or deleted outside UniDesk. Use Locate file or Remove reference.",
    );
  if (args.action === "open" || args.action === "reveal") {
    if (
      args.action === "open" &&
      /\.(exe|bat|cmd|ps1|vbs|js|msi|com|scr|lnk)$/i.test(old)
    )
      throw Error("Open executable files directly from Explorer.");
    spawn(
      "explorer.exe",
      args.action === "reveal" ? ["/select,", old] : [old],
      { detached: true, stdio: "ignore", windowsHide: true },
    ).unref();
    if (args.action === "open")
      db.prepare("UPDATE files SET accessed_at=datetime('now') WHERE id=?").run(
        file.id,
      );
    return;
  }
  inside(course.folder_path, old);
  if (args.action === "remove")
    throw Error(
      "Disk deletion is available in the desktop app. You can remove this reference or reveal the file in Explorer.",
    );
  if (args.action === "rename" || args.action === "move") {
    const category = args.action === "move" ? args.category : file.category;
    if (!categories.includes(category as (typeof categories)[number]))
      throw Error("Choose a valid category.");
    const folderId =
      args.action === "move" ? (args.folder ? args.folder : undefined) : (file.folder_id ?? undefined);
    const folderName = folderId ? resolveFolder(db, folderId, file.course_id, category!) : undefined;
    const folder = folderName
      ? path.join(course.folder_path, category!, folderName)
      : path.join(course.folder_path, category!);
    fs.mkdirSync(folder, { recursive: true });
    inside(course.folder_path, folder);
    const target = path.join(
      folder,
      args.action === "rename" ? safeName(args.name ?? "") : file.filename,
    );
    if (target === old) return;
    if (fs.existsSync(target))
      throw Error("A file with this name already exists. Choose another name.");
    fs.copyFileSync(old, target, fs.constants.COPYFILE_EXCL);
    try {
      db.prepare(
        "UPDATE files SET absolute_path=?,filename=?,category=?,folder_id=? WHERE id=?",
      ).run(target, path.basename(target), category!, folderId ?? null, file.id);
    } catch (e) {
      fs.unlinkSync(target);
      throw e;
    }
    try {
      fs.unlinkSync(old);
    } catch {
      /* A retained original is safer than losing either copy. */
    }
    return;
  }
  throw Error("Unknown file operation.");
}
export function handle(
  db: DatabaseSync,
  command: string,
  args: Record<string, unknown>,
  dbPath: string,
): unknown {
  switch (command) {
    case "scan_files": {
      const course = courseRecord(db, String(args.courseId));
      const category = String(args.category);
      if (!categories.includes(category as (typeof categories)[number]))
        throw Error("Choose a valid category.");
      const folder = path.join(course.folder_path, category);
      const statements: Statement[] = [];
      if (fs.existsSync(folder)) {
        inside(course.folder_path, folder);
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
          if (!entry.isFile() || entry.name.startsWith(".unidesk-backup-"))
            continue;
          const target = path.join(folder, entry.name),
            stat = fs.statSync(target);
          if (
            db
              .prepare("SELECT 1 FROM ignored_files WHERE absolute_path=?")
              .get(target)
          )
            continue;
          statements.push({
            sql: "INSERT INTO files(id,course_id,semester_id,filename,original_filename,category,absolute_path,extension,size,created_at,modified_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(absolute_path) DO UPDATE SET size=excluded.size,modified_at=excluded.modified_at",
            params: [
              randomUUID(),
              course.id,
              course.semester_id,
              entry.name,
              entry.name,
              category,
              target,
              path.extname(target).slice(1),
              stat.size,
              stat.birthtime.toISOString(),
              stat.mtime.toISOString(),
            ],
          });
        }
      }
      const knownFolders = db
        .prepare("SELECT id, name FROM file_folders WHERE course_id=? AND category=?")
        .all(course.id, category) as { id: string; name: string }[];
      for (const { id: folderId, name: folderName } of knownFolders) {
        const folderDir = path.join(course.folder_path, category, folderName);
        if (!fs.existsSync(folderDir)) continue;
        for (const entry of fs.readdirSync(folderDir, { withFileTypes: true })) {
          if (!entry.isFile() || entry.name.startsWith(".unidesk-backup-"))
            continue;
          const target = path.join(folderDir, entry.name),
            stat = fs.statSync(target);
          if (
            db
              .prepare("SELECT 1 FROM ignored_files WHERE absolute_path=?")
              .get(target)
          )
            continue;
          statements.push({
            sql: "INSERT INTO files(id,course_id,semester_id,filename,original_filename,category,absolute_path,extension,size,created_at,modified_at,folder_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(absolute_path) DO UPDATE SET size=excluded.size,modified_at=excluded.modified_at",
            params: [
              randomUUID(),
              course.id,
              course.semester_id,
              entry.name,
              entry.name,
              category,
              target,
              path.extname(target).slice(1),
              stat.size,
              stat.birthtime.toISOString(),
              stat.mtime.toISOString(),
              folderId,
            ],
          });
        }
      }
      if (statements.length) batch(db, statements);
      return null;
    }
    case "create_subfolder": {
      const courseId = String(args.courseId);
      const category = String(args.category);
      if (!categories.includes(category as (typeof categories)[number]))
        throw Error("Choose a valid category.");
      const course = courseRecord(db, courseId);
      const name = safeName(String(args.name));
      const dir = path.join(course.folder_path, category, name);
      fs.mkdirSync(dir, { recursive: true });
      inside(course.folder_path, dir);
      const id = randomUUID();
      try {
        db.prepare(
          "INSERT INTO file_folders(id,course_id,category,name) VALUES(?,?,?,?)",
        ).run(id, courseId, category, name);
      } catch (e) {
        if (String((e as Error).message).includes("UNIQUE constraint"))
          throw Error("This name or folder is already in use. Choose another.");
        throw e;
      }
      return { id, name };
    }
    case "rename_folder": {
      const id = String(args.id);
      const row = db
        .prepare(
          "SELECT f.category as category, f.name as name, c.folder_path as folder_path FROM file_folders f JOIN courses c ON c.id=f.course_id WHERE f.id=?",
        )
        .get(id) as { category: string; name: string; folder_path: string } | undefined;
      if (!row) throw Error("This folder no longer exists.");
      const newName = safeName(String(args.name));
      if (newName === row.name) return null;
      const categoryDir = path.join(row.folder_path, row.category);
      const oldDir = path.join(categoryDir, row.name);
      const newDir = path.join(categoryDir, newName);
      if (fs.existsSync(newDir))
        throw Error("This name or folder is already in use. Choose another.");
      const diskMoved = fs.existsSync(oldDir);
      if (diskMoved) fs.renameSync(oldDir, newDir);
      else fs.mkdirSync(newDir, { recursive: true });
      try {
        const files = db
          .prepare("SELECT id, absolute_path FROM files WHERE folder_id=?")
          .all(id) as { id: string; absolute_path: string }[];
        batch(db, [
          { sql: "UPDATE file_folders SET name=? WHERE id=?", params: [newName, id] },
          ...files.map((f) => ({
            sql: "UPDATE files SET absolute_path=? WHERE id=?",
            params: [
              f.absolute_path.startsWith(oldDir)
                ? newDir + f.absolute_path.slice(oldDir.length)
                : f.absolute_path,
              f.id,
            ],
          })),
        ]);
      } catch (e) {
        if (diskMoved) fs.renameSync(newDir, oldDir);
        else fs.rmdirSync(newDir);
        throw e;
      }
      return null;
    }
    case "delete_folder": {
      const id = String(args.id);
      const mode = String(args.mode);
      const row = db
        .prepare(
          "SELECT f.category as category, f.name as name, c.folder_path as folder_path FROM file_folders f JOIN courses c ON c.id=f.course_id WHERE f.id=?",
        )
        .get(id) as { category: string; name: string; folder_path: string } | undefined;
      if (!row) throw Error("This folder no longer exists.");
      const dir = path.join(row.folder_path, row.category, row.name);
      if (mode === "delete") {
        const fileIds = (
          db.prepare("SELECT id FROM files WHERE folder_id=?").all(id) as { id: string }[]
        ).map((r) => r.id);
        for (const fileId of fileIds) {
          fileAction(db, { id: fileId, action: "remove", disk: Boolean(args.disk) });
        }
        db.prepare("DELETE FROM file_folders WHERE id=?").run(id);
        fs.rmSync(dir, { recursive: true, force: true });
        return null;
      }
      const categoryDir = path.join(row.folder_path, row.category);
      const files = db
        .prepare("SELECT id, absolute_path, filename FROM files WHERE folder_id=?")
        .all(id) as { id: string; absolute_path: string; filename: string }[];
      for (const f of files) {
        const newPath = uniquePath(categoryDir, f.filename);
        if (fs.existsSync(f.absolute_path)) fs.renameSync(f.absolute_path, newPath);
        db.prepare("UPDATE files SET absolute_path=?,folder_id=NULL WHERE id=?").run(
          newPath,
          f.id,
        );
      }
      db.prepare("DELETE FROM file_folders WHERE id=?").run(id);
      try {
        fs.rmdirSync(dir);
      } catch {
        /* Non-empty or already gone; nothing tracked remains either way. */
      }
      return null;
    }
    case "query":
      return db
        .prepare(String(args.sql))
        .all(...((args.params as SqlValue[]) ?? []));
    case "batch":
      return batch(db, args.statements as Statement[]);
    case "locations":
      return {
        database: dbPath,
        defaultFolder: path.resolve(".local/University"),
      };
    case "create_folder": {
      const base = String(args.base);
      if (!path.isAbsolute(base)) throw Error("Enter an absolute folder path.");
      const target = path.join(base, safeName(String(args.name)));
      fs.mkdirSync(target, { recursive: true });
      if (args.course)
        for (const category of categories)
          fs.mkdirSync(path.join(target, category), { recursive: true });
      return target;
    }
    case "import_file":
      return importFile(db, args as Parameters<typeof importFile>[1]);
    case "file_action":
      return fileAction(db, args as Parameters<typeof fileAction>[1]);
    case "read_pdf": {
      const file=fileRecord(db,String(args.id));
      if (!/\.pdf$/i.test(file.filename)) throw Error('Choose a PDF file.');
      if (!fs.existsSync(file.absolute_path)) throw Error('PDF not found. Locate the missing file from its file menu.');
      if (fs.statSync(file.absolute_path).size>150_000_000) throw Error('This PDF exceeds the 150 MB viewer limit. Open it externally.');
      const bytes=fs.readFileSync(file.absolute_path);
      if (!bytes.subarray(0,1024).includes(Buffer.from('%PDF-'))) throw Error('This file is not a valid PDF.');
      db.prepare("UPDATE files SET accessed_at=datetime('now') WHERE id=?").run(file.id);
      return bytes.toString('base64');
    }
    case "open_folder": {
      const row = courseRecord(db, String(args.id));
      if (!fs.existsSync(row.folder_path))
        throw Error(
          "Course folder not found. Restore the folder to its original location.",
        );
      spawn("explorer.exe", [row.folder_path], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
      return null;
    }
    default:
      throw Error("This operation is only available in the desktop app.");
  }
}

