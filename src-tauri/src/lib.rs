use rusqlite::{params_from_iter, types::Value as SqlValue, Connection};
mod device;
mod sync;
mod cloud;
mod email;
mod gmail;
mod ai;
mod microsoft_auth;
mod document_extractor;
mod documents;

use serde::Deserialize;

use serde_json::{json, Value};

use std::{

    fs,

    path::{Path, PathBuf},

    sync::Mutex,

};

use tauri::{Manager, State};



struct Store {

    db: Mutex<Connection>,

    path: PathBuf,

}

const CATEGORIES: [&str; 8] = [

    "Lectures",

    "Assignments",

    "Exams",

    "Previous Exams",

    "Readings",

    "Recordings",

    "Notes",

    "Resources",

];

fn friendly(error: impl std::fmt::Display) -> String {

    let message = error.to_string();

    eprintln!("UniDesk operation: {message}");

    if message.contains("UNIQUE constraint") {

        "This name or folder is already in use. Choose another.".into()

    } else if message.contains("FOREIGN KEY") {

        "A related record no longer exists. Refresh and try again.".into()

    } else {

        message

    }

}

fn safe_name(name: &str) -> Result<String, String> {

    let clean: String = name

        .trim()

        .chars()

        .map(|c| {

            if c.is_control() || "<>:\"/\\|?*".contains(c) {

                '_'

            } else {

                c

            }

        })

        .collect();

    let clean = clean.trim_end_matches(['.', ' ']).to_string();

    let stem = clean.split('.').next().unwrap_or("").to_uppercase();

    if clean.is_empty()

        || [

            "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",

            "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",

        ]

        .contains(&stem.as_str())

    {

        return Err("Choose a valid Windows file or folder name.".into());

    }

    Ok(clean)

}

fn sql_value(value: &Value) -> SqlValue {

    match value {

        Value::Null => SqlValue::Null,

        Value::Bool(b) => SqlValue::Integer(*b as i64),

        Value::Number(n) => n

            .as_i64()

            .map(SqlValue::Integer)

            .unwrap_or_else(|| SqlValue::Real(n.as_f64().unwrap_or(0.0))),

        Value::String(s) => SqlValue::Text(s.clone()),

        _ => SqlValue::Text(value.to_string()),

    }

}

#[derive(Deserialize)]

struct Statement {

    #[serde(default, rename = "expectChanges")]
    expect_changes: Option<usize>,

    sql: String,

    #[serde(default)]

    params: Vec<Value>,

}

#[tauri::command]

fn query(store: State<Store>, sql: String, params: Vec<Value>) -> Result<Value, String> {

    let db = store.db.lock().map_err(friendly)?;

    let mut stmt = db.prepare(&sql).map_err(friendly)?;

    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();

    let rows = stmt

        .query_map(params_from_iter(params.iter().map(sql_value)), |row| {

            let mut obj = serde_json::Map::new();

            for (i, name) in names.iter().enumerate() {

                let v: SqlValue = row.get(i)?;

                obj.insert(

                    name.clone(),

                    match v {

                        SqlValue::Null => Value::Null,

                        SqlValue::Integer(n) => json!(n),

                        SqlValue::Real(n) => json!(n),

                        SqlValue::Text(s) => json!(s),

                        SqlValue::Blob(_) => Value::Null,

                    },

                );

            }

            Ok(Value::Object(obj))

        })

        .map_err(friendly)?;

    let collected: Result<Vec<_>, _> = rows.collect();

    Ok(json!(collected.map_err(friendly)?))

}

#[tauri::command]

fn batch(store: State<Store>, statements: Vec<Statement>) -> Result<Value, String> {

    let mut db = store.db.lock().map_err(friendly)?;

    let tx = db.transaction().map_err(friendly)?;

    let mut changes = Vec::new();

    for s in statements {

        let n = tx

            .execute(&s.sql, params_from_iter(s.params.iter().map(sql_value)))

            .map_err(friendly)?;

        if s.expect_changes.is_some_and(|expected| expected != n) {
            return Err("This suggestion or academic record has changed. Reopen it before applying.".into());
        }
        changes.push(json!({"changes":n}));

    }

    tx.commit().map_err(friendly)?;

    Ok(json!(changes))

}

#[tauri::command]

fn locations(app: tauri::AppHandle, store: State<Store>) -> Result<Value, String> {

    Ok(

        json!({"database":store.path,"defaultFolder":if cfg!(target_os="android") { app.path().app_data_dir().map_err(friendly)?.join("files").join("University") } else { app.path().document_dir().map_err(friendly)?.join("University") }}),

    )

}

#[tauri::command]

fn create_folder(base: String, name: String, course: bool) -> Result<String, String> {

    let root = PathBuf::from(base);

    if !root.is_absolute() {

        return Err("Enter an absolute folder path.".into());

    }

    let folder = root.join(safe_name(&name)?);

    fs::create_dir_all(&folder).map_err(friendly)?;

    if course {

        for category in CATEGORIES {

            fs::create_dir_all(folder.join(category)).map_err(friendly)?;

        }

    }

    Ok(folder.to_string_lossy().into_owned())

}

fn inside(root: &Path, target: &Path) -> Result<(), String> {

    if !target

        .canonicalize()

        .map_err(friendly)?

        .starts_with(root.canonicalize().map_err(friendly)?)

    {

        return Err("The file is outside the course storage folder.".into());

    }

    Ok(())

}

fn unique_path(folder: &Path, name: &str) -> PathBuf {

    let mut target = folder.join(name);

    let p = Path::new(name);

    let stem = p.file_stem().unwrap_or_default().to_string_lossy();

    let ext = p

        .extension()

        .map(|e| format!(".{}", e.to_string_lossy()))

        .unwrap_or_default();

    let mut i = 2;

    while target.exists() {

        target = folder.join(format!("{stem} ({i}){ext}"));

        i += 1;

    }

    target

}

fn resolve_folder(db: &Connection, folder_id: &str, course_id: &str, category: &str) -> Result<String, String> {
    let (fc, fcat, name): (String, String, String) = db
        .query_row(
            "SELECT course_id, category, name FROM file_folders WHERE id=?",
            [folder_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| "Choose a valid folder.".to_string())?;
    if fc != course_id || fcat != category {
        return Err("Choose a valid folder.".into());
    }
    Ok(name)
}

fn copy_exclusive(source: &Path, target: &Path) -> Result<(), String> {

    use std::io::Write;

    let mut output = fs::OpenOptions::new()

        .write(true)

        .create_new(true)

        .open(target)

        .map_err(friendly)?;

    let result = (|| {

        let mut input = fs::File::open(source)?;

        std::io::copy(&mut input, &mut output)?;

        output.flush()?;

        output.sync_all()

    })();

    if let Err(e) = result {

        drop(output);

        let _ = fs::remove_file(target);

        return Err(friendly(e));

    }

    Ok(())

}

#[tauri::command]

fn import_file(

    store: State<Store>,

    course_id: String,

    category: String,

    source: Option<String>,

    filename: Option<String>,

    bytes: Option<Vec<u8>>,

    conflict: Option<String>,

    folder_id: Option<String>,

) -> Result<Value, String> {

    if !CATEGORIES.contains(&category.as_str()) {

        return Err("Choose a valid category.".into());

    }

    let db = store.db.lock().map_err(friendly)?;

    let (root, semester): (String, String) = db

        .query_row(

            "SELECT folder_path,semester_id FROM courses WHERE id=?",

            [&course_id],

            |r| Ok((r.get(0)?, r.get(1)?)),

        )

        .map_err(friendly)?;

    let root = PathBuf::from(root);

    let folder_name = match &folder_id {
        Some(fid) => Some(resolve_folder(&db, fid, &course_id, &category)?),
        None => None,
    };
    let mut folder = root.join(&category);
    if let Some(name) = &folder_name {
        folder = folder.join(name);
    }

    fs::create_dir_all(&folder).map_err(friendly)?;

    inside(&root, &folder)?;

    let raw = filename

        .or_else(|| {

            source.as_ref().and_then(|s| {

                Path::new(s)

                    .file_name()

                    .map(|s| s.to_string_lossy().into_owned())

            })

        })

        .ok_or("Choose a file to import.")?;

    let name = safe_name(&raw)?;

    let mut target = folder.join(&name);

    let mut backup = None;

    if target.exists() {

        match conflict.as_deref() {

            None => return Ok(json!({"conflict":true,"filename":name})),

            Some("keep") => target = unique_path(&folder, &name),

            Some("replace") => {

                if source

                    .as_ref()

                    .is_some_and(|s| Path::new(s).canonicalize().ok() == target.canonicalize().ok())

                {

                    return Err("This file is already in that folder.".into());

                }

                let b = unique_path(&folder, &format!(".unidesk-backup-{name}"));

                copy_exclusive(&target, &b)?;

                backup = Some(b);

            }

            _ => return Ok(json!({"cancelled":true})),

        }

    }

    let mut owned = false;

    let operation = (|| -> Result<Value, String> {

        if let Some(src) = source {

            if backup.is_some() {

                fs::copy(src, &target).map_err(friendly)?;

            } else {

                copy_exclusive(Path::new(&src), &target)?;

            }

            owned = true;

        } else {

            use std::io::Write;

            let mut options = fs::OpenOptions::new();

            options.write(true);

            if backup.is_some() {

                options.truncate(true);

            } else {

                options.create_new(true);

            }

            let mut f = options.open(&target).map_err(friendly)?;

            owned = true;

            f.write_all(&bytes.unwrap_or_default()).map_err(friendly)?;

            f.sync_all().map_err(friendly)?;

        }

        let metadata = fs::metadata(&target).map_err(friendly)?;

        let id = uuid::Uuid::new_v4().to_string();

        let now = chrono::Utc::now().to_rfc3339();

        let modified: chrono::DateTime<chrono::Utc> = metadata.modified().map_err(friendly)?.into();

        let created: chrono::DateTime<chrono::Utc> = metadata

            .created()

            .unwrap_or(std::time::SystemTime::now())

            .into();

        let tx = db.unchecked_transaction().map_err(friendly)?;

        tx.execute("DELETE FROM ignored_files WHERE absolute_path=?",[target.to_string_lossy().as_ref()]).map_err(friendly)?;

        tx.execute("INSERT INTO files(id,course_id,semester_id,filename,original_filename,category,absolute_path,extension,size,created_at,modified_at,added_at,folder_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(absolute_path) DO UPDATE SET size=excluded.size,modified_at=excluded.modified_at",rusqlite::params![id,course_id,semester,target.file_name().unwrap_or_default().to_string_lossy(),name,category,target.to_string_lossy(),target.extension().unwrap_or_default().to_string_lossy(),metadata.len() as i64,created.to_rfc3339(),modified.to_rfc3339(),now,folder_id]).map_err(friendly)?;

        tx.commit().map_err(friendly)?;

        Ok(json!({"id":id}))

    })();

    if operation.is_err() {

        if let Some(ref b) = backup {

            let _ = fs::copy(b, &target);

        } else if owned && target.exists() {

            let _ = fs::remove_file(&target);

        }

    }

    if let Some(b) = backup {

        if operation.is_ok() {

            let _ = fs::remove_file(b);

        }

    }

    operation

}

#[tauri::command]

fn read_pdf(store: State<Store>, id: String) -> Result<String,String> {
    use base64::Engine;
    let db=store.db.lock().map_err(friendly)?;
    let (path,extension):(String,String)=db.query_row("SELECT absolute_path,extension FROM files WHERE id=?",[&id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|_|"PDF record not found.".to_string())?;
    if !extension.trim_start_matches('.').eq_ignore_ascii_case("pdf") {return Err("Choose a PDF file.".into());}
    let meta=fs::metadata(&path).map_err(|_|"PDF not found. Locate the missing file from its file menu.".to_string())?;
    if meta.len()>150_000_000 {return Err("This PDF exceeds the 150 MB viewer limit. Open it externally.".into());}
    let bytes=fs::read(&path).map_err(friendly)?;
    if !bytes[..bytes.len().min(1024)].windows(5).any(|w|w==b"%PDF-") {return Err("This file is not a valid PDF.".into());}
    db.execute("UPDATE files SET accessed_at=datetime('now') WHERE id=?",[&id]).map_err(friendly)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
async fn file_action(app:tauri::AppHandle,id:String,action:String,name:Option<String>,category:Option<String>,source:Option<String>,disk:Option<bool>,folder:Option<String>) -> Result<(),String> {
    tauri::async_runtime::spawn_blocking(move || file_action_impl(&app.state::<Store>(),id,action,name,category,source,disk,folder)).await.map_err(friendly)?
}
fn file_action_impl(

    store: &Store,

    id: String,

    action: String,

    name: Option<String>,

    category: Option<String>,

    source: Option<String>,

    disk: Option<bool>,

    folder: Option<String>,

) -> Result<(), String> {

    let db = store.db.lock().map_err(friendly)?;

    let(old,root,old_name,old_category,old_folder_id,course_id):(String,String,String,String,Option<String>,String)=db.query_row("SELECT f.absolute_path,c.folder_path,f.filename,f.category,f.folder_id,f.course_id FROM files f JOIN courses c ON c.id=f.course_id WHERE f.id=?",[&id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).map_err(friendly)?;

    let old = PathBuf::from(old);

    if action == "remove" && !disk.unwrap_or(false) {

        let tx = db.unchecked_transaction().map_err(friendly)?;

        tx.execute("INSERT OR IGNORE INTO ignored_files(absolute_path,course_id) SELECT absolute_path,course_id FROM files WHERE id=?",[&id]).map_err(friendly)?;

        tx.execute("DELETE FROM files WHERE id=?", [id])

            .map_err(friendly)?;

        tx.commit().map_err(friendly)?;

        return Ok(());

    }

    if action == "locate" {

        let path = PathBuf::from(source.ok_or("Choose an existing file.")?);

        let meta = fs::metadata(&path).map_err(friendly)?;

        if !meta.is_file() {

            return Err("Choose an existing file.".into());

        }

        db.execute(

            "UPDATE files SET absolute_path=?,filename=?,extension=?,size=? WHERE id=?",

            rusqlite::params![

                path.to_string_lossy(),

                path.file_name().unwrap_or_default().to_string_lossy(),

                path.extension().unwrap_or_default().to_string_lossy(),

                meta.len() as i64,

                id

            ],

        )

        .map_err(friendly)?;

        return Ok(());

    }

    if !old.exists() {

        return Err("File not found. It may have been moved or deleted outside UniDesk. Use Locate file or Remove reference.".into());

    }

    if action == "open" {

        let ext = old

            .extension()

            .unwrap_or_default()

            .to_string_lossy()

            .to_lowercase();

        if [

            "exe", "bat", "cmd", "ps1", "vbs", "js", "msi", "com", "scr", "lnk",

        ]

        .contains(&ext.as_str())

        {

            return Err("Open executable files directly from Explorer.".into());

        }

        device::open_path(&old).map_err(friendly)?;

        db.execute(

            "UPDATE files SET accessed_at=datetime('now') WHERE id=?",

            [id],

        )

        .map_err(friendly)?;

        return Ok(());

    }

    if action == "export" { return device::export_path(&old); }
    if action == "share" { return device::share_path(&old); }
    if action == "reveal" {

        #[cfg(windows)]

        {

            use std::os::windows::process::CommandExt;

            std::process::Command::new("explorer.exe")

                .arg(format!("/select,{}", old.display()))

                .creation_flags(0x08000000)

                .spawn()

                .map_err(friendly)?;

        }

        return Ok(());

    }

    inside(Path::new(&root), &old)?;

    if action == "remove" {

        #[cfg(windows)]
        trash::delete(&old).map_err(friendly)?;
        #[cfg(not(windows))]
        { return Err("Use Remove from UniDesk on this device; permanent deletion is not supported.".into()); }

        db.execute("INSERT OR IGNORE INTO ignored_files(absolute_path,course_id) SELECT absolute_path,course_id FROM files WHERE id=?",[&id]).map_err(friendly)?;

        db.execute("DELETE FROM files WHERE id=?", [id])

            .map_err(friendly)?;

        return Ok(());

    }

    if action == "rename" || action == "move" {

        let category = if action == "move" {

            category.ok_or("Choose a category.")?

        } else {

            old_category

        };

        if !CATEGORIES.contains(&category.as_str()) {

            return Err("Choose a valid category.".into());

        }

        let folder_id: Option<String> = if action == "move" {
            folder.filter(|f| !f.is_empty())
        } else {
            old_folder_id.clone()
        };
        let folder_name = match &folder_id {
            Some(fid) => Some(resolve_folder(&db, fid, &course_id, &category)?),
            None => None,
        };
        let root_path = PathBuf::from(&root);
        let mut folder = root_path.join(&category);
        if let Some(name) = &folder_name {
            folder = folder.join(name);
        }

        fs::create_dir_all(&folder).map_err(friendly)?;

        inside(&root_path, &folder)?;

        let new_name = if action == "rename" {

            safe_name(&name.ok_or("Enter a file name.")?)?

        } else {

            old_name

        };

        let target = folder.join(&new_name);

        if target == old {

            return Ok(());

        }

        if target.exists() {

            return Err("A file with this name already exists. Choose another name.".into());

        }

        copy_exclusive(&old, &target)?;

        if let Err(e) = db.execute(

            "UPDATE files SET absolute_path=?,filename=?,category=?,extension=?,folder_id=? WHERE id=?",

            rusqlite::params![

                target.to_string_lossy(),

                new_name,

                category,

                target.extension().unwrap_or_default().to_string_lossy(),

                folder_id,

                id

            ],

        ) {

            let _ = fs::remove_file(target);

            return Err(friendly(e));

        }

        if let Err(e) = fs::remove_file(old) {

            eprintln!("Original retained after move: {e}");

        }

        return Ok(());

    }

    Err("Unknown file operation.".into())

}

#[tauri::command]

fn open_folder(store: State<Store>, id: String) -> Result<(), String> {

    let db = store.db.lock().map_err(friendly)?;

    let path: String = db

        .query_row("SELECT folder_path FROM courses WHERE id=?", [id], |r| {

            r.get(0)

        })

        .map_err(friendly)?;

    if !Path::new(&path).is_dir() {

        return Err("Course folder not found. Restore it to its original location.".into());

    }

    device::open_path(Path::new(&path)).map_err(friendly)

}

#[tauri::command]

fn scan_files(store: State<Store>, course_id: String, category: String) -> Result<(), String> {

    if !CATEGORIES.contains(&category.as_str()) {

        return Err("Choose a valid category.".into());

    }

    let mut db = store.db.lock().map_err(friendly)?;

    let (root, semester): (String, String) = db

        .query_row(

            "SELECT folder_path,semester_id FROM courses WHERE id=?",

            [&course_id],

            |r| Ok((r.get(0)?, r.get(1)?)),

        )

        .map_err(friendly)?;

    let folder = PathBuf::from(&root).join(&category);

    if !folder.exists() {

        return Ok(());

    }

    inside(Path::new(&root), &folder)?;

    let tx = db.transaction().map_err(friendly)?;

    for entry in fs::read_dir(folder).map_err(friendly)? {

        let entry = entry.map_err(friendly)?;

        if !entry.file_type().map_err(friendly)?.is_file() {

            continue;

        }

        let name = entry.file_name().to_string_lossy().into_owned();

        if name.starts_with(".unidesk-backup-") {

            continue;

        }

        let path = entry.path();

        let ignored: i64 = tx

            .query_row(

                "SELECT count(*) FROM ignored_files WHERE absolute_path=?",

                [path.to_string_lossy().as_ref()],

                |r| r.get(0),

            )

            .map_err(friendly)?;

        if ignored > 0 {

            continue;

        }

        let meta = entry.metadata().map_err(friendly)?;

        let modified: chrono::DateTime<chrono::Utc> = meta.modified().map_err(friendly)?.into();

        let created: chrono::DateTime<chrono::Utc> = meta

            .created()

            .unwrap_or(std::time::SystemTime::now())

            .into();

        tx.execute("INSERT INTO files(id,course_id,semester_id,filename,original_filename,category,absolute_path,extension,size,created_at,modified_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(absolute_path) DO UPDATE SET size=excluded.size,modified_at=excluded.modified_at",rusqlite::params![uuid::Uuid::new_v4().to_string(),course_id,semester,name,name,category,path.to_string_lossy(),path.extension().unwrap_or_default().to_string_lossy(),meta.len() as i64,created.to_rfc3339(),modified.to_rfc3339()]).map_err(friendly)?;

    }

    let known_folders: Vec<(String, String)> = {
        let mut stmt = tx
            .prepare("SELECT id, name FROM file_folders WHERE course_id=? AND category=?")
            .map_err(friendly)?;
        let rows = stmt
            .query_map(rusqlite::params![course_id, category], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(friendly)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(friendly)?
    };
    for (folder_id, folder_name) in known_folders {
        let folder_dir = PathBuf::from(&root).join(&category).join(&folder_name);
        if !folder_dir.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&folder_dir).map_err(friendly)? {
            let entry = entry.map_err(friendly)?;
            if !entry.file_type().map_err(friendly)?.is_file() {
                continue;
            }
            let fname = entry.file_name().to_string_lossy().into_owned();
            if fname.starts_with(".unidesk-backup-") {
                continue;
            }
            let path = entry.path();
            let ignored: i64 = tx
                .query_row(
                    "SELECT count(*) FROM ignored_files WHERE absolute_path=?",
                    [path.to_string_lossy().as_ref()],
                    |r| r.get(0),
                )
                .map_err(friendly)?;
            if ignored > 0 {
                continue;
            }
            let meta = entry.metadata().map_err(friendly)?;
            let modified: chrono::DateTime<chrono::Utc> = meta.modified().map_err(friendly)?.into();
            let created: chrono::DateTime<chrono::Utc> = meta
                .created()
                .unwrap_or(std::time::SystemTime::now())
                .into();
            tx.execute("INSERT INTO files(id,course_id,semester_id,filename,original_filename,category,absolute_path,extension,size,created_at,modified_at,folder_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(absolute_path) DO UPDATE SET size=excluded.size,modified_at=excluded.modified_at",rusqlite::params![uuid::Uuid::new_v4().to_string(),course_id,semester,fname,fname,category,path.to_string_lossy(),path.extension().unwrap_or_default().to_string_lossy(),meta.len() as i64,created.to_rfc3339(),modified.to_rfc3339(),folder_id]).map_err(friendly)?;
        }
    }

    tx.commit().map_err(friendly)?;

    Ok(())

}

#[tauri::command]
fn create_subfolder(store: State<Store>, course_id: String, category: String, name: String) -> Result<Value, String> {
    if !CATEGORIES.contains(&category.as_str()) {
        return Err("Choose a valid category.".into());
    }
    let db = store.db.lock().map_err(friendly)?;
    let root: String = db
        .query_row("SELECT folder_path FROM courses WHERE id=?", [&course_id], |r| r.get(0))
        .map_err(friendly)?;
    let name = safe_name(&name)?;
    let dir = PathBuf::from(&root).join(&category).join(&name);
    fs::create_dir_all(&dir).map_err(friendly)?;
    inside(Path::new(&root), &dir)?;
    let id = uuid::Uuid::new_v4().to_string();
    db.execute(
        "INSERT INTO file_folders(id,course_id,category,name) VALUES(?,?,?,?)",
        rusqlite::params![id, course_id, category, name],
    )
    .map_err(friendly)?;
    Ok(json!({"id": id, "name": name}))
}

#[tauri::command]
fn rename_folder(store: State<Store>, id: String, name: String) -> Result<(), String> {
    let mut db = store.db.lock().map_err(friendly)?;
    let (category, old_name, root): (String, String, String) = db
        .query_row(
            "SELECT f.category, f.name, c.folder_path FROM file_folders f JOIN courses c ON c.id=f.course_id WHERE f.id=?",
            [&id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(friendly)?;
    let new_name = safe_name(&name)?;
    if new_name == old_name {
        return Ok(());
    }
    let category_dir = PathBuf::from(&root).join(&category);
    let old_dir = category_dir.join(&old_name);
    let new_dir = category_dir.join(&new_name);
    if new_dir.exists() {
        return Err("This name or folder is already in use. Choose another.".into());
    }
    let disk_moved = old_dir.exists();
    if disk_moved {
        fs::rename(&old_dir, &new_dir).map_err(friendly)?;
    } else {
        fs::create_dir_all(&new_dir).map_err(friendly)?;
    }
    let update = (|| -> Result<(), String> {
        let tx = db.transaction().map_err(friendly)?;
        tx.execute("UPDATE file_folders SET name=? WHERE id=?", rusqlite::params![new_name, id]).map_err(friendly)?;
        let old_prefix = old_dir.to_string_lossy().into_owned();
        let new_prefix = new_dir.to_string_lossy().into_owned();
        let files: Vec<(String, String)> = {
            let mut stmt = tx.prepare("SELECT id, absolute_path FROM files WHERE folder_id=?").map_err(friendly)?;
            let rows = stmt.query_map([&id], |r| Ok((r.get(0)?, r.get(1)?))).map_err(friendly)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(friendly)?
        };
        for (file_id, path) in files {
            let new_path = path.strip_prefix(&old_prefix).map(|rest| format!("{new_prefix}{rest}")).unwrap_or(path);
            tx.execute("UPDATE files SET absolute_path=? WHERE id=?", rusqlite::params![new_path, file_id]).map_err(friendly)?;
        }
        tx.commit().map_err(friendly)?;
        Ok(())
    })();
    if update.is_err() {
        if disk_moved {
            let _ = fs::rename(&new_dir, &old_dir);
        } else {
            let _ = fs::remove_dir(&new_dir);
        }
    }
    update
}

#[tauri::command]
fn delete_folder(store: State<Store>, id: String, mode: String, disk: Option<bool>) -> Result<(), String> {
    let (category, name, root): (String, String, String) = {
        let db = store.db.lock().map_err(friendly)?;
        db.query_row(
            "SELECT f.category, f.name, c.folder_path FROM file_folders f JOIN courses c ON c.id=f.course_id WHERE f.id=?",
            [&id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(friendly)?
    };
    let dir = PathBuf::from(&root).join(&category).join(&name);
    if mode == "delete" {
        let file_ids: Vec<String> = {
            let db = store.db.lock().map_err(friendly)?;
            let mut stmt = db.prepare("SELECT id FROM files WHERE folder_id=?").map_err(friendly)?;
            let rows = stmt.query_map([&id], |r| r.get(0)).map_err(friendly)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(friendly)?
        };
        for file_id in file_ids {
            file_action_impl(&store, file_id, "remove".into(), None, None, None, disk, None)?;
        }
        {
            let db = store.db.lock().map_err(friendly)?;
            db.execute("DELETE FROM file_folders WHERE id=?", [&id]).map_err(friendly)?;
        }
        let _ = fs::remove_dir_all(&dir);
        Ok(())
    } else {
        let db = store.db.lock().map_err(friendly)?;
        let category_dir = PathBuf::from(&root).join(&category);
        let files: Vec<(String, String, String)> = {
            let mut stmt = db.prepare("SELECT id, absolute_path, filename FROM files WHERE folder_id=?").map_err(friendly)?;
            let rows = stmt.query_map([&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(friendly)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(friendly)?
        };
        for (file_id, old_path, filename) in files {
            let old_path = PathBuf::from(old_path);
            let new_path = unique_path(&category_dir, &filename);
            if old_path.exists() {
                fs::rename(&old_path, &new_path).map_err(friendly)?;
            }
            db.execute(
                "UPDATE files SET absolute_path=?,folder_id=NULL WHERE id=?",
                rusqlite::params![new_path.to_string_lossy(), file_id],
            )
            .map_err(friendly)?;
        }
        db.execute("DELETE FROM file_folders WHERE id=?", [&id]).map_err(friendly)?;
        let _ = fs::remove_dir(&dir);
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {

    let builder = tauri::Builder::default().plugin(device::plugin());
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
    builder

        .plugin(tauri_plugin_dialog::init())

        .plugin(tauri_plugin_notification::init())



        .setup(|app| {

            let directory = if let Some(custom) = std::env::var_os("UNIDESK_DATA_DIR") {

                let p = PathBuf::from(custom);

                if !p.is_absolute() {

                    return Err("UNIDESK_DATA_DIR must be absolute".into());

                }

                p

            } else {

                app.path().app_data_dir()?

            };

            fs::create_dir_all(&directory)?;

            let path = directory.join("unidesk.db");

            let mut db = Connection::open(&path)?;

            db.execute_batch(

                "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",

            )?;

            let version: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;

            if version < 1 {

                let tx = db.transaction()?;

                tx.execute_batch(include_str!("../../src/db/001_initial.sql"))?;

                tx.execute_batch("PRAGMA user_version=1")?;

                tx.commit()?;

            }

            if version < 2 {

                let tx = db.transaction()?;

                tx.execute_batch(include_str!("../../src/db/002_file_discovery.sql"))?;

                tx.execute_batch("PRAGMA user_version=2")?;

                tx.commit()?;

            }

            if version < 3 {

                let tx = db.transaction()?;

                tx.execute_batch(include_str!("../../src/db/003_academic_tracking.sql"))?;

                tx.execute_batch("PRAGMA user_version=3")?;

                tx.commit()?;

            }

            if version < 4 {
                let tx = db.transaction()?;
                tx.execute_batch(include_str!("../../src/db/004_email.sql"))?;
                tx.execute_batch("PRAGMA user_version=4")?;
                tx.commit()?;
            }
            if version < 5 {
                let tx = db.transaction()?;
                tx.execute_batch(include_str!("../../src/db/005_email_workflows.sql"))?;
                tx.execute_batch("PRAGMA user_version=5")?;
                tx.commit()?;
            }
            if version < 6 {
                if version > 0 {
                    let backups=directory.join("backups");
                    fs::create_dir_all(&backups)?;
                    let backup=backups.join(format!("unidesk-before-phase4-{}.db",uuid::Uuid::new_v4()));
                    db.execute("VACUUM INTO ?1",[backup.to_string_lossy().as_ref()])?;
                }
                let tx=db.transaction()?;
                tx.execute_batch(include_str!("../../src/db/006_documents.sql"))?;
                tx.execute_batch("PRAGMA user_version=6")?;
                tx.commit()?;
            }
            if version < 7 {
                if version >= 6 {let backups=directory.join("backups");fs::create_dir_all(&backups)?;let backup=backups.join(format!("unidesk-before-ai-{}.db",uuid::Uuid::new_v4()));db.execute("VACUUM INTO ?1",[backup.to_string_lossy().as_ref()])?;}
                let tx=db.transaction()?;tx.execute_batch(include_str!("../../src/db/007_ai.sql"))?;tx.execute_batch("PRAGMA user_version=7")?;tx.commit()?;
            }
            if version < 8 {let tx=db.transaction()?;tx.execute_batch(include_str!("../../src/db/008_ai_results.sql"))?;tx.execute_batch("PRAGMA user_version=8")?;tx.commit()?;}
            if version < 9 {let tx=db.transaction()?;tx.execute_batch(include_str!("../../src/db/009_syllabus.sql"))?;tx.execute_batch("PRAGMA user_version=9")?;tx.commit()?;}
            if version < 10 {let tx=db.transaction()?;tx.execute_batch(include_str!("../../src/db/010_exam_questions.sql"))?;tx.execute_batch("PRAGMA user_version=10")?;tx.commit()?;}
            if version < 11 {let tx=db.transaction()?;tx.execute_batch(include_str!("../../src/db/011_ai_email_sources.sql"))?;tx.execute_batch("PRAGMA user_version=11")?;tx.commit()?;}
            if version < 12 {
                if version >= 7 {let backups=directory.join("backups");fs::create_dir_all(&backups)?;let backup=backups.join(format!("unidesk-before-gmail-{}.db",uuid::Uuid::new_v4()));db.execute("VACUUM INTO ?1",[backup.to_string_lossy().as_ref()])?;}
                let tx=db.transaction()?;tx.execute_batch(include_str!("../../src/db/012_gmail.sql"))?;tx.execute_batch("PRAGMA user_version=12")?;tx.commit()?;
            }
            if version < 13 {
                if version == 12 {let backups=directory.join("backups");fs::create_dir_all(&backups)?;let backup=backups.join(format!("unidesk-before-instructor-links-{}.db",uuid::Uuid::new_v4()));db.execute("VACUUM INTO ?1",[backup.to_string_lossy().as_ref()])?;}
                let tx=db.transaction()?;tx.execute_batch(include_str!("../../src/db/013_instructor_email_links.sql"))?;tx.execute_batch("PRAGMA user_version=13")?;tx.commit()?;} if version < 14 {let tx=db.transaction()?;tx.execute_batch(include_str!("../../src/db/014_local_academic_imports.sql"))?;tx.execute_batch("PRAGMA user_version=14")?;tx.commit()?;} if version < 15 {let tx=db.transaction()?;tx.execute_batch(include_str!("../../src/db/015_academic_rework.sql"))?;tx.execute_batch("PRAGMA user_version=15")?;tx.commit()?;} if version < 16 {let tx=db.transaction()?;tx.execute_batch(include_str!("../../src/db/016_syllabus_page.sql"))?;tx.execute_batch("PRAGMA user_version=16")?;tx.commit()?;
            }
            if version < 17 { let tx=db.transaction()?; tx.execute_batch(include_str!("../../src/db/017_device_sync.sql"))?; tx.execute_batch("PRAGMA user_version=17")?; tx.commit()?; }
            if version < 18 { let tx=db.transaction()?; tx.execute_batch(include_str!("../../src/db/018_sync_account_files.sql"))?; tx.execute_batch("PRAGMA user_version=18")?; tx.commit()?; }
            if version < 19 { let tx=db.transaction()?; tx.execute_batch(include_str!("../../src/db/019_file_availability.sql"))?; tx.execute_batch("PRAGMA user_version=19")?; tx.commit()?; }
            if version < 20 { let tx=db.transaction()?; tx.execute_batch(include_str!("../../src/db/020_file_folders.sql"))?; tx.execute_batch("PRAGMA user_version=20")?; tx.commit()?; }
            if version < 21 { let tx=db.transaction()?; tx.execute_batch(include_str!("../../src/db/021_folder_sync.sql"))?; tx.execute_batch("PRAGMA user_version=21")?; tx.commit()?; }
            app.manage(Store {

                db: Mutex::new(db),

                path,

            });

            Ok(())

        })

        .invoke_handler(tauri::generate_handler![

            device::pick_documents,
            device::stage_document,
            sync::sync_configure,
            cloud::sync_account,
            sync::sync_request,
            sync::sync_file,
            sync::sync_scan,
            query,

            batch,

            locations,

            create_folder,

            import_file,

            file_action,
            read_pdf,

            open_folder,

            scan_files,
            create_subfolder,
            rename_folder,
            delete_folder,
            email::email_auth,
            gmail::gmail_auth,
            gmail::gmail_request,
            ai::ai_credentials,
            ai::ai_generate,
            ai::ai_cancel,
            email::email_request
            ,email::email_save_attachment,
            documents::document_probe,
            documents::document_extract,
            documents::document_preview

        ])

        .run(tauri::generate_context!())

        .expect("UniDesk could not start");

}

