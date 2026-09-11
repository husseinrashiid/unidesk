use crate::{device, Store};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::PathBuf, time::Duration};
use tauri::Manager;

const VAULT: &str = "UniDesk/Sync/Connection";
fn connection() -> Result<(reqwest::Url,String),String> {
    let value:Value=serde_json::from_str(&device::secret(VAULT,"read",None)?.ok_or("Sync is not connected")?).map_err(|_|"Reconnect sync")?;
    let endpoint=reqwest::Url::parse(value["endpoint"].as_str().ok_or("Missing server")?).map_err(|_|"Invalid sync server")?;
    Ok((endpoint,value["token"].as_str().ok_or("Missing sync token")?.into()))
}
fn request(method:reqwest::Method, route:&str) -> Result<reqwest::blocking::RequestBuilder,String> {
    if crate::cloud::is_supabase()? { return crate::cloud::request(method,route); }
    let (base,token)=connection()?;
    let url=base.join(&format!("v1/{route}")).map_err(|_|"Invalid server route")?;
    let client=reqwest::blocking::Client::builder().timeout(Duration::from_secs(120)).redirect(reqwest::redirect::Policy::none()).build().map_err(|e|e.to_string())?;
    Ok(client.request(method,url).bearer_auth(token))
}
fn response_bytes(response:reqwest::blocking::Response,limit:u64)->Result<Vec<u8>,String> {
    if !response.status().is_success() { return Err(format!("Sync server returned HTTP {}. Check the connection and account token.",response.status().as_u16())); }
    let mut bytes=Vec::new();response.take(limit+1).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
    if bytes.len() as u64>limit { return Err("Sync transfer exceeds the size limit".into()); } Ok(bytes)
}
#[tauri::command]
pub async fn sync_configure(action:String,endpoint:Option<String>,token:Option<String>)->Result<Value,String> {
    tauri::async_runtime::spawn_blocking(move || {
        if action=="save" {
            let mut url=reqwest::Url::parse(endpoint.as_deref().unwrap_or("").trim()).map_err(|_|"Enter a valid HTTPS sync server URL")?;
            let loopback=matches!(url.host_str(),Some("127.0.0.1"|"localhost"|"[::1]"));
            if (url.scheme()!="https" && !(cfg!(debug_assertions)&&loopback&&url.scheme()=="http")) || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() { return Err("Use HTTPS for sync. HTTP loopback is allowed only in debug builds.".into()); }
            if !url.path().ends_with('/') { url.set_path(&format!("{}/",url.path())); }
            let token=token.unwrap_or_default();
            if token.len()<32||token.len()>200||!token.chars().all(|c|c.is_ascii_alphanumeric()||c=='_'||c=='-') { return Err("Enter the account token issued by your sync server".into()); }
            device::secret(VAULT,"save",Some(&json!({"endpoint":url,"token":token}).to_string()))?;
        } else if action=="remove" { device::secret(VAULT,"remove",None)?; }
        else if action!="status" { return Err("Unknown sync setting".into()); }
        if crate::cloud::is_supabase()? {let s=crate::cloud::config()?.unwrap();return Ok(json!({"configured":true,"endpoint":s["endpoint"]}));}
        match connection() { Ok((url,_))=>Ok(json!({"configured":true,"endpoint":url})),Err(_)=>Ok(json!({"configured":false,"endpoint":""})) }
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn sync_request(route:String,body:Value)->Result<Value,String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !["info","push","pull","remove-device","restore-device"].contains(&route.as_str()) { return Err("Unsupported sync route".into()); }
        if crate::cloud::is_supabase()? {return crate::cloud::sync(&route,body);}
        let bytes=response_bytes(request(reqwest::Method::POST,&route)?.json(&body).send().map_err(|_|"Sync server is unavailable. Changes remain saved locally.")?,32_000_000)?;
        serde_json::from_slice(&bytes).map_err(|_|"Invalid sync server response".into())
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn sync_file(app:tauri::AppHandle,operation:String,id:Option<String>,hash:Option<String>,filename:Option<String>,course_id:Option<String>)->Result<Value,String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store=app.state::<Store>();
        if operation=="evict" {
            let id=id.ok_or("Missing file identity")?;
            let db=store.db.lock().map_err(|_|"Database busy")?;
            let (path,root,hash,state):(String,String,String,String)=db.query_row("SELECT f.absolute_path,c.folder_path,b.hash,b.state FROM files f JOIN courses c ON c.id=f.course_id JOIN sync_blobs b ON b.file_id=f.id WHERE f.id=?",[&id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(|_|"This file has not been synchronized yet")?;
            let pending:i64=db.query_row("SELECT COUNT(*) FROM sync_outbox WHERE table_name='files' AND record_key=json_array(?)",[&id],|r|r.get(0)).map_err(|e|e.to_string())?;
            if state!="available_offline"||pending>0{return Err("Finish uploading this file before removing its local copy".into());}
            let path=PathBuf::from(path);
            if path.exists(){
                let canonical=path.canonicalize().map_err(|e|e.to_string())?;
                if !canonical.starts_with(PathBuf::from(root).canonicalize().map_err(|e|e.to_string())?){return Err("Only UniDesk-managed course copies can be removed".into());}
                if canonical.metadata().map_err(|e|e.to_string())?.len()>100_000_000{return Err("This file changed locally; sync it before removing the copy".into());}
                let bytes=fs::read(&canonical).map_err(|e|e.to_string())?;
                if format!("{:x}",Sha256::digest(&bytes))!=hash{return Err("This file changed locally. Sync it before removing the copy".into());}
                db.execute("UPDATE sync_blobs SET state='cloud_available',direction='download',auto_download=0,local_signature='' WHERE file_id=?",[&id]).map_err(|e|e.to_string())?;
                #[cfg(windows)] let removed=trash::delete(&canonical).map_err(|e|e.to_string());
                #[cfg(not(windows))] let removed=fs::remove_file(&canonical).map_err(|e|e.to_string());
                if let Err(error)=removed{let _=db.execute("UPDATE sync_blobs SET state='available_offline',auto_download=1 WHERE file_id=?",[&id]);return Err(error);}
            }
            db.execute("UPDATE sync_blobs SET state='cloud_available',direction='download',auto_download=0,local_signature='',last_error='',retry_count=0 WHERE file_id=?",[&id]).map_err(|e|e.to_string())?;
            return Ok(json!({"removed":true}));
        }
        if operation=="prepare" {
            let id=id.ok_or("Missing file")?;
            let path:String=store.db.lock().map_err(|_|"Database busy")?.query_row("SELECT absolute_path FROM files WHERE id=?",[&id],|row|row.get(0)).map_err(|_|"File is no longer available")?;
            let file=fs::File::open(&path).map_err(|_|"A course file is missing. Locate it before syncing.")?;
            let meta=file.metadata().map_err(|e|e.to_string())?;
            if meta.len()>100_000_000 {return Err("File sync supports files up to 100 MB".into());}
            let signature=format!("{}:{}:{:?}",path,meta.len(),meta.modified());
            let staged=store.path.parent().ok_or("Missing storage")?.join("SyncUploads");
            let known:Result<(String,String),_>=store.db.lock().map_err(|_|"Database busy")?.query_row("SELECT hash,local_signature FROM sync_blobs WHERE file_id=?",[&id],|row|Ok((row.get(0)?,row.get(1)?)));
            if let Ok((hash,previous))=known {if previous==signature && staged.join(&hash).is_file(){return Ok(json!({"hash":hash,"signature":signature}));}}
            let mut bytes=Vec::new();file.take(100_000_001).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
            if bytes.len()>100_000_000 {return Err("File exceeds 100 MB".into());}
            let hash=format!("{:x}",Sha256::digest(&bytes));
            fs::create_dir_all(&staged).map_err(|e|e.to_string())?;
            let destination=staged.join(&hash);
            if !destination.exists() {
                let temp=staged.join(format!("{}.tmp",uuid::Uuid::new_v4()));fs::write(&temp,bytes).map_err(|e|e.to_string())?;
                if let Err(error)=fs::rename(&temp,&destination){let _=fs::remove_file(temp);if !destination.exists(){return Err(error.to_string());}}
            }
            return Ok(json!({"hash":hash,"signature":signature}));
        }
        if operation!="upload" && operation!="download" && operation!="path" {return Err("Unknown file sync operation".into());}
        let hash=hash.ok_or("Missing content hash")?;
        if hash.len()!=64 || !hash.bytes().all(|c|c.is_ascii_hexdigit()&&!c.is_ascii_uppercase()) { return Err("Invalid content hash".into()); }
        if operation=="upload" {
            // The immutable staged bytes match the already committed logical file version.
            let staged=store.path.parent().ok_or("Missing storage")?.join("SyncUploads").join(&hash);
            let check=request(reqwest::Method::HEAD,&format!("blobs/{hash}"))?.send().map_err(|_|"File server unavailable")?;
            if check.status().is_success(){return Ok(json!({"hash":hash}));}
            if ![400,404].contains(&check.status().as_u16()) {return Err("Could not check file availability".into());}
            let bytes=fs::read(staged).map_err(|_|"Staged file missing; modify or reimport the local file to retry")?;
            if format!("{:x}",Sha256::digest(&bytes))!=hash {return Err("Staged file hash mismatch".into());}
            let response=request(reqwest::Method::POST,&format!("blobs/{hash}"))?.header("Content-Type","application/octet-stream").body(bytes).send().map_err(|_|"File upload interrupted; it will retry")?;
            if response.status().as_u16()!=409 {response_bytes(response,32000)?;}
            return Ok(json!({"hash":hash}));
        }
        let filename=crate::safe_name(&filename.ok_or("Missing filename")?)?;
        let course_id=course_id.ok_or("Missing course")?;
        let id=crate::safe_name(&id.ok_or("Missing file identity")?)?;
        let saved:Result<String,_>=store.db.lock().map_err(|_|"Database busy")?.query_row("SELECT folder_path FROM courses WHERE id=?",[&course_id],|row|row.get(0));
        let course_root=match saved { Ok(path)=>PathBuf::from(path),Err(_)=>{
            let base=if cfg!(target_os="android") {app.path().app_data_dir().map(|p|p.join("files"))} else {app.path().document_dir()}.map_err(|e|e.to_string())?;
            base.join("University").join(crate::safe_name(&format!("Course-{course_id}"))?)
        }};
        let folder=course_root.join(".sync").join(id).join(&hash);
        let target=folder.join(filename);
        if operation=="path" {return Ok(json!({"path":target}));}
        if target.is_file() && format!("{:x}",Sha256::digest(fs::read(&target).map_err(|e|e.to_string())?))==hash { return Ok(json!({"path":target,"signature":file_signature(&target)?})); }
        let bytes=response_bytes(request(reqwest::Method::GET,&format!("blobs/{hash}"))?.send().map_err(|_|"File download interrupted; it will retry")?,100_000_000)?;
        if format!("{:x}",Sha256::digest(&bytes))!=hash { return Err("Downloaded file did not match its content hash".into()); }
        fs::create_dir_all(&folder).map_err(|e|e.to_string())?;
        let temp:PathBuf=folder.join(format!("{}.tmp",uuid::Uuid::new_v4()));
        fs::write(&temp,bytes).map_err(|e|e.to_string())?;
        if let Err(error)=fs::rename(&temp,&target) { let _=fs::remove_file(&temp);return Err(error.to_string()); }
        Ok(json!({"path":target,"signature":file_signature(&target)?}))
    }).await.map_err(|e|e.to_string())?
}

fn file_signature(path:&std::path::Path)->Result<String,String>{let meta=fs::metadata(path).map_err(|e|e.to_string())?;Ok(format!("{}:{}:{:?}",path.to_string_lossy(),meta.len(),meta.modified()))}
#[tauri::command]
pub async fn sync_scan(app:tauri::AppHandle)->Result<(),String>{
 tauri::async_runtime::spawn_blocking(move||{
  let store=app.state::<Store>();
  let mut db=store.db.lock().map_err(|_|"Database busy")?;
  let rows:Vec<(String,String,String)>={let mut statement=db.prepare("SELECT f.id,f.absolute_path,b.local_signature FROM files f JOIN sync_blobs b ON b.file_id=f.id WHERE b.state='available_offline'").map_err(|e|e.to_string())?;let values=statement.query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;values};
  let tx=db.transaction().map_err(|e|e.to_string())?;
  for(id,path,previous) in rows {
   let path=std::path::Path::new(&path);let Ok(signature)=file_signature(path) else{continue};
   if previous.is_empty(){tx.execute("UPDATE sync_blobs SET local_signature=? WHERE file_id=?",[signature,id]).map_err(|e|e.to_string())?;}
   else if previous!=signature{let size=fs::metadata(path).map_err(|e|e.to_string())?.len();tx.execute("UPDATE files SET size=?,modified_at=? WHERE id=?",rusqlite::params![size as i64,chrono::Utc::now().to_rfc3339(),id]).map_err(|e|e.to_string())?;}
  }
  tx.commit().map_err(|e|e.to_string())?;Ok(())
 }).await.map_err(|e|e.to_string())?
}
