import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {pdfFixture} from './document-fixtures';
import path from "node:path";
import {
  openDatabase,
  batch,
  handle,
  importFile,
  fileAction,
  safeName,
} from "../server/storage";
const root = path.resolve(".local/tests", crypto.randomUUID());
test('PDF reader returns unchanged registered PDF bytes and rejects missing or invalid files',()=>{
  const {db,dbPath}=fixture();
  try {
    const bytes=pdfFixture(['Original syllabus']);
    const pdf=importFile(db,{courseId:'c',category:'Previous Exams',filename:'exam.pdf',bytes:Array.from(bytes)});
    assert.deepEqual(Buffer.from(handle(db,'read_pdf',{id:pdf.id},dbPath) as string,'base64'),bytes);
    assert.throws(()=>handle(db,'read_pdf',{id:'missing'},dbPath));
    const bad=importFile(db,{courseId:'c',category:'Lectures',filename:'bad.pdf',bytes:[65,66]});
    assert.throws(()=>handle(db,'read_pdf',{id:bad.id},dbPath),/valid PDF/);
    const text=importFile(db,{courseId:'c',category:'Lectures',filename:'notes.txt',bytes:[65]});
    assert.throws(()=>handle(db,'read_pdf',{id:text.id},dbPath),/PDF file/);
  } finally {db.close();}
});
fs.mkdirSync(root, { recursive: true });
function fixture() {
  const dir = path.join(root, crypto.randomUUID());
  const dbPath = path.join(dir, "test.db"),
    db = openDatabase(dbPath);
  const semester = handle(
    db,
    "create_folder",
    { base: dir, name: "Fall 2026" },
    dbPath,
  ) as string;
  const course = handle(
    db,
    "create_folder",
    { base: semester, name: "PHIL210", course: true },
    dbPath,
  ) as string;
  batch(db, [
    {
      sql: "INSERT INTO semesters(id,name,start_date,end_date,storage_directory) VALUES(?,?,?,?,?)",
      params: ["s", "Fall 2026", "2026-08-31", "2026-12-20", semester],
    },
    {
      sql: "INSERT INTO courses(id,semester_id,code,name,folder_path) VALUES(?,?,?,?,?)",
      params: ["c", "s", "PHIL 210", "Ethics", course],
    },
  ]);
  return { dir, dbPath, db, course };
}
test("migrations, foreign keys, transactional rollback, and persistence", () => {
  const { db, dbPath } = fixture();
  assert.equal(
    (db.prepare("PRAGMA user_version").get() as { user_version: number })
      .user_version,
      21,
  );
  assert.throws(() =>
    batch(db, [
      { sql: "INSERT INTO tasks(id,title) VALUES('one','A persistent task')" },
      {
        sql: "INSERT INTO courses(id,semester_id,code,name,folder_path) VALUES('bad','missing','BAD','Bad','bad')",
      },
    ]),
  );
  assert.equal(db.prepare("SELECT * FROM tasks").all().length, 0);
  batch(db, [{ sql: "INSERT INTO tasks(id,title) VALUES('two','Reopen me')" }]);
  db.close();
  const reopened = openDatabase(dbPath);
  assert.equal(
    reopened.prepare("SELECT title FROM tasks").get()?.title,
    "Reopen me",
  );
  reopened.close();
});
test("course folders are normal folders and invalid Windows names are sanitized", () => {
  const { db, course } = fixture();
  assert.ok(fs.existsSync(path.join(course, "Previous Exams")));
  assert.equal(safeName("PHIL:210?"), "PHIL_210_");
  assert.throws(() => safeName("CON.txt"));
  assert.throws(() => safeName(".."));
  db.close();
});
test("file copy keeps source, prompts conflicts, keeps both, and replaces explicitly", () => {
  const { db, dir, course } = fixture();
  const source = path.join(dir, "Lecture.txt");
  fs.writeFileSync(source, "first");
  const first = importFile(db, { courseId: "c", category: "Lectures", source });
  assert.ok(first.id);
  assert.equal(fs.readFileSync(source, "utf8"), "first");
  assert.equal(
    importFile(db, { courseId: "c", category: "Lectures", source }).conflict,
    true,
  );
  importFile(db, {
    courseId: "c",
    category: "Lectures",
    source,
    conflict: "keep",
  });
  assert.ok(fs.existsSync(path.join(course, "Lectures/Lecture (2).txt")));
  fs.writeFileSync(source, "updated");
  importFile(db, {
    courseId: "c",
    category: "Lectures",
    source,
    conflict: "replace",
  });
  assert.equal(
    fs.readFileSync(path.join(course, "Lectures/Lecture.txt"), "utf8"),
    "updated",
  );
  assert.equal(db.prepare("SELECT * FROM files").all().length, 2);
  db.close();
});
test("failed copying never inserts metadata or destroys an existing file", () => {
  const { db, dir, course } = fixture();
  assert.throws(() =>
    importFile(db, {
      courseId: "c",
      category: "Lectures",
      source: path.join(dir, "missing.txt"),
    }),
  );
  assert.equal(db.prepare("SELECT * FROM files").all().length, 0);
  const target = path.join(course, "Lectures/existing.txt");
  fs.writeFileSync(target, "valuable");
  assert.throws(() =>
    importFile(db, {
      courseId: "c",
      category: "Lectures",
      source: path.join(dir, "missing/existing.txt"),
      conflict: "replace",
    }),
  );
  assert.equal(fs.readFileSync(target, "utf8"), "valuable");
  db.close();
});
test("database failure rolls back a new copy and restores a replaced copy", () => {
  const { db, course } = fixture();
  importFile(db, {
    courseId: "c",
    category: "Notes",
    filename: "note.txt",
    bytes: [65],
  });
  db.exec(
    "CREATE TRIGGER fail_insert BEFORE INSERT ON files BEGIN SELECT RAISE(ABORT,'disk metadata failure'); END",
  );
  assert.throws(() =>
    importFile(db, {
      courseId: "c",
      category: "Notes",
      filename: "new.txt",
      bytes: [66],
    }),
  );
  assert.equal(fs.existsSync(path.join(course, "Notes/new.txt")), false);
  assert.throws(() =>
    importFile(db, {
      courseId: "c",
      category: "Notes",
      filename: "note.txt",
      bytes: [66],
      conflict: "replace",
    }),
  );
  assert.equal(
    fs.readFileSync(path.join(course, "Notes/note.txt"), "utf8"),
    "A",
  );
  db.close();
});
test("rename and category move preserve contents; removing metadata preserves documents", () => {
  const { db, course } = fixture();
  const imported = importFile(db, {
    courseId: "c",
    category: "Lectures",
    filename: "lecture.txt",
    bytes: Array.from(Buffer.from("real document")),
  });
  const id = imported.id!;
  fileAction(db, { id, action: "rename", name: "renamed.txt" });
  assert.ok(fs.existsSync(path.join(course, "Lectures/renamed.txt")));
  fileAction(db, { id, action: "move", category: "Readings" });
  const moved = path.join(course, "Readings/renamed.txt");
  assert.equal(fs.readFileSync(moved, "utf8"), "real document");
  fileAction(db, { id, action: "remove" });
  assert.ok(fs.existsSync(moved));
  assert.equal(db.prepare("SELECT * FROM files").all().length, 0);
  db.close();
});
test("course removal cascades metadata but never deletes academic files", () => {
  const { db, course } = fixture();
  importFile(db, {
    courseId: "c",
    category: "Notes",
    filename: "valuable.txt",
    bytes: [65],
  });
  batch(db, [{ sql: "DELETE FROM courses WHERE id='c'" }]);
  assert.equal(db.prepare("SELECT * FROM files").all().length, 0);
  assert.ok(fs.existsSync(path.join(course, "Notes/valuable.txt")));
  db.close();
});
test("missing file references can be repaired without losing metadata", () => {
  const { db, dir, course } = fixture();
  const { id } = importFile(db, {
    courseId: "c",
    category: "Notes",
    filename: "moved.txt",
    bytes: [65],
  });
  const target = path.join(dir, "relocated.txt");
  fs.renameSync(path.join(course, "Notes/moved.txt"), target);
  assert.throws(
    () => fileAction(db, { id: id!, action: "open" }),
    /File not found/,
  );
  fileAction(db, { id: id!, action: "locate", source: target });
  assert.equal(
    db.prepare("SELECT absolute_path FROM files WHERE id=?").get(id!)
      ?.absolute_path,
    target,
  );
  db.close();
});
test("files added through Explorer are indexed and explicit removals stay hidden", () => {
  const { db, course, dbPath } = fixture();
  const target = path.join(course, "Readings/external.txt");
  fs.writeFileSync(target, "From Explorer");
  handle(db, "scan_files", { courseId: "c", category: "Readings" }, dbPath);
  const record = db
    .prepare("SELECT id FROM files WHERE absolute_path=?")
    .get(target) as { id: string };
  assert.ok(record.id);
  fileAction(db, { id: record.id, action: "remove" });
  handle(db, "scan_files", { courseId: "c", category: "Readings" }, dbPath);
  assert.equal(db.prepare("SELECT * FROM files").all().length, 0);
  assert.ok(fs.existsSync(target));
  importFile(db, {
    courseId: "c",
    category: "Readings",
    filename: "external.txt",
    bytes: [65],
    conflict: "replace",
  });
  assert.equal(db.prepare("SELECT * FROM ignored_files").all().length, 0);
  assert.equal(db.prepare("SELECT * FROM files").all().length, 1);
  db.close();
});
test("creating a folder persists an empty directory and files import into it", () => {
  const { db, course, dbPath } = fixture();
  const created = handle(
    db,
    "create_subfolder",
    { courseId: "c", category: "Readings", name: "Week 1" },
    dbPath,
  ) as { id: string; name: string };
  assert.ok(fs.existsSync(path.join(course, "Readings/Week 1")));
  assert.equal(
    db.prepare("SELECT * FROM files WHERE folder_id=?").all(created.id).length,
    0,
  );
  const imported = importFile(db, {
    courseId: "c",
    category: "Readings",
    filename: "chapter1.txt",
    bytes: Array.from(Buffer.from("reading")),
    folderId: created.id,
  });
  assert.ok(fs.existsSync(path.join(course, "Readings/Week 1/chapter1.txt")));
  assert.equal(
    db.prepare("SELECT folder_id FROM files WHERE id=?").get(imported.id!)
      ?.folder_id,
    created.id,
  );
  assert.throws(
    () =>
      handle(
        db,
        "create_subfolder",
        { courseId: "c", category: "Readings", name: "Week 1" },
        dbPath,
      ),
    /already in use/,
  );
  db.close();
});
test("renaming a folder renames its directory and rewrites contained files' paths", () => {
  const { db, course, dbPath } = fixture();
  const created = handle(
    db,
    "create_subfolder",
    { courseId: "c", category: "Readings", name: "Week 1" },
    dbPath,
  ) as { id: string };
  const imported = importFile(db, {
    courseId: "c",
    category: "Readings",
    filename: "chapter1.txt",
    bytes: Array.from(Buffer.from("reading")),
    folderId: created.id,
  });
  handle(db, "rename_folder", { id: created.id, name: "Week One" }, dbPath);
  assert.ok(!fs.existsSync(path.join(course, "Readings/Week 1")));
  const newPath = path.join(course, "Readings/Week One/chapter1.txt");
  assert.ok(fs.existsSync(newPath));
  assert.equal(
    db.prepare("SELECT absolute_path FROM files WHERE id=?").get(imported.id!)
      ?.absolute_path,
    newPath,
  );
  assert.equal(
    db.prepare("SELECT name FROM file_folders WHERE id=?").get(created.id)
      ?.name,
    "Week One",
  );
  db.close();
});
test("deleting a folder can keep its files (ungrouped) or remove them", () => {
  const { db, course, dbPath } = fixture();
  const keep = handle(
    db,
    "create_subfolder",
    { courseId: "c", category: "Readings", name: "Keep Me" },
    dbPath,
  ) as { id: string };
  const kept = importFile(db, {
    courseId: "c",
    category: "Readings",
    filename: "a.txt",
    bytes: Array.from(Buffer.from("a")),
    folderId: keep.id,
  });
  handle(db, "delete_folder", { id: keep.id, mode: "keep" }, dbPath);
  assert.ok(!fs.existsSync(path.join(course, "Readings/Keep Me")));
  assert.ok(fs.existsSync(path.join(course, "Readings/a.txt")));
  assert.equal(
    db.prepare("SELECT folder_id FROM files WHERE id=?").get(kept.id!)
      ?.folder_id,
    null,
  );
  assert.equal(
    db.prepare("SELECT * FROM file_folders WHERE id=?").all(keep.id).length,
    0,
  );
  const remove = handle(
    db,
    "create_subfolder",
    { courseId: "c", category: "Readings", name: "Remove Me" },
    dbPath,
  ) as { id: string };
  importFile(db, {
    courseId: "c",
    category: "Readings",
    filename: "b.txt",
    bytes: Array.from(Buffer.from("b")),
    folderId: remove.id,
  });
  handle(db, "delete_folder", { id: remove.id, mode: "delete" }, dbPath);
  assert.ok(!fs.existsSync(path.join(course, "Readings/Remove Me")));
  assert.equal(
    db.prepare("SELECT * FROM files WHERE folder_id=?").all(remove.id).length,
    0,
  );
  db.close();
});
test("scanning picks up files dropped into a known folder but not an unknown ad hoc subdirectory", () => {
  const { db, course, dbPath } = fixture();
  const known = handle(
    db,
    "create_subfolder",
    { courseId: "c", category: "Readings", name: "Week 1" },
    dbPath,
  ) as { id: string };
  fs.writeFileSync(
    path.join(course, "Readings/Week 1/dropped.txt"),
    "manually placed",
  );
  fs.mkdirSync(path.join(course, "Readings/Random Folder"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(course, "Readings/Random Folder/untracked.txt"),
    "should not be adopted",
  );
  handle(db, "scan_files", { courseId: "c", category: "Readings" }, dbPath);
  const found = db
    .prepare("SELECT folder_id FROM files WHERE filename=?")
    .get("dropped.txt") as { folder_id: string } | undefined;
  assert.equal(found?.folder_id, known.id);
  assert.equal(
    db.prepare("SELECT * FROM files WHERE filename=?").all("untracked.txt")
      .length,
    0,
  );
  db.close();
});

