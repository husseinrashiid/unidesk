use serde_json::{json,Value};
use tauri::Manager;
use std::{path::{Path,PathBuf},time::UNIX_EPOCH};
use super::{Store,document_extractor};

#[tauri::command]
pub async fn document_preview(source:Option<String>,filename:Option<String>,bytes:Option<Vec<u8>>)->Result<Value,String> {
 tauri::async_runtime::spawn_blocking(move||{
  let name=filename.as_deref().or(source.as_deref()).ok_or("Choose a document.")?;
  let ext=Path::new(name).extension().and_then(|e|e.to_str()).unwrap_or("").to_ascii_lowercase();
  if !["pdf","docx","txt"].contains(&ext.as_str()){return Err("Choose a PDF, DOCX or text file.".into());}
  let result=if let Some(path)=source {document_extractor::extract_path(Path::new(&path))?} else {
   let data=bytes.ok_or("Missing document bytes.")?;
   if data.len()>30_000_000{return Err("Choose a document smaller than 30 MB.".into());}
   std::panic::catch_unwind(||document_extractor::extract_bytes(&ext,&data)).map_err(|_|"The document could not be parsed safely.")??
  };
  serde_json::to_value(result).map_err(|_|"Could not read extracted text.".into())
 }).await.map_err(|_|"Document extraction interrupted.".to_string())?
}

fn file_path(app:&tauri::AppHandle,id:&str)->Result<PathBuf,String> {
    let store=app.state::<Store>();
    let (path,root):(String,String)=store.db.lock().map_err(|_|"Workspace busy.")?.query_row("SELECT f.absolute_path,c.folder_path FROM files f JOIN courses c ON c.id=f.course_id WHERE f.id=?",[id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|_|"This file reference no longer exists.")?;
    let path=PathBuf::from(path);
    let canonical=path.canonicalize().map_err(|_|"The source file is missing or cannot be read.")?;
    let root=PathBuf::from(root).canonicalize().map_err(|_|"The course folder cannot be read.")?;
    if !canonical.starts_with(root) {return Err("The file is outside course storage. Locate it before indexing.".into());}
    Ok(path)
}
fn fingerprint(path:&Path)->Result<String,String> {
    let m=path.metadata().map_err(|_|"The source file is missing or cannot be read.")?;
    if !m.is_file(){return Err("The source is not a document file.".into());}
    Ok(format!("{}:{}:{}",path.to_string_lossy(),m.len(),m.modified().map_err(|_|"Cannot read modification time.")?.duration_since(UNIX_EPOCH).map_err(|_|"Invalid modification time.")?.as_nanos()))
}
#[tauri::command]
pub async fn document_probe(app:tauri::AppHandle,file_ids:Vec<String>)->Result<Value,String> {
    if file_ids.len()>25{return Err("Check at most 25 documents at a time.".into());}
    tauri::async_runtime::spawn_blocking(move||Ok(Value::Array(file_ids.into_iter().map(|id|match file_path(&app,&id).and_then(|p|fingerprint(&p)){Ok(f)=>json!({"file_id":id,"fingerprint":f}),Err(e)=>json!({"file_id":id,"error":e})}).collect()))).await.map_err(|_|"Document check interrupted.".to_string())?
}
#[tauri::command]
pub async fn document_extract(app:tauri::AppHandle,file_id:String)->Result<Value,String> {
    tauri::async_runtime::spawn_blocking(move||{
        let path=file_path(&app,&file_id)?;let before=fingerprint(&path)?;
        let extraction=document_extractor::extract_path(&path)?;
        if fingerprint(&path)?!=before{return Err("The document changed during extraction. Re-index it after saving your edits.".into());}
        Ok(json!({"file_id":file_id,"fingerprint":before,"extraction":extraction}))
    }).await.map_err(|_|"Document extraction interrupted. The original file is unchanged.".to_string())?
}
