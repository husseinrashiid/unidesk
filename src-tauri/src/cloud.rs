//! Supabase Auth/REST/Storage adapter. Passwords and session tokens never enter SQLite.
use crate::device;
use serde_json::{json,Value};
use std::{sync::Mutex,time::Duration};
const VAULT:&str="UniDesk/Sync/Connection";
static SESSION_LOCK:Mutex<()>=Mutex::new(());
fn client()->Result<reqwest::blocking::Client,String>{reqwest::blocking::Client::builder().timeout(Duration::from_secs(120)).redirect(reqwest::redirect::Policy::none()).build().map_err(|e|e.to_string())}
pub fn config()->Result<Option<Value>,String>{device::secret(VAULT,"read",None)?.map(|s|serde_json::from_str(&s).map_err(|_|"Reconnect the sync account".into())).transpose()}
pub fn is_supabase()->Result<bool,String>{Ok(config()?.map(|v|v["provider"]=="supabase").unwrap_or(false))}
fn endpoint(value:&str)->Result<reqwest::Url,String>{
 let mut url=reqwest::Url::parse(value.trim()).map_err(|_|"Enter a valid Supabase HTTPS URL")?;
 let local=matches!(url.host_str(),Some("localhost"|"127.0.0.1"|"[::1]"));
 if (url.scheme()!="https"&&!(cfg!(debug_assertions)&&local&&url.scheme()=="http"))||!url.username().is_empty()||url.password().is_some()||url.query().is_some()||url.fragment().is_some(){return Err("Use your Supabase HTTPS endpoint".into());}
 if !url.path().ends_with('/') {url.set_path(&format!("{}/",url.path()));} Ok(url)
}
fn read_json(response:reqwest::blocking::Response,account:bool)->Result<Value,String>{
 use std::io::Read;
 let status=response.status();
 let mut bytes=Vec::new();response.take(32_000_001).read_to_end(&mut bytes).map_err(|_|"Account response interrupted")?;
 if bytes.len()>32_000_000{return Err("Account response too large".into());}
 if !status.is_success(){
  if account{return Err(match status.as_u16(){400|401|403=>"Account sign-in expired or failed. Sign in again, or check email confirmation and your server settings.",429=>"Too many account requests. Please try again later.",_=>"The account server is unavailable. Local work remains available."}.into());}
  let value:Value=serde_json::from_slice(&bytes).unwrap_or(Value::Null);let message=value["message"].as_str().unwrap_or("");
  return Err(if message.contains("Update UniDesk")||message.contains("Unsupported entity")||message.contains("Incomplete record")||message.contains("Unsupported field"){"Update UniDesk to continue syncing. Local work is still available."}
   else if message.contains("device was removed"){"This device was removed. Restore its access from another connected device."}
   else if message.contains("Related record missing"){"A related record was deleted elsewhere. Restore its parent or remove the pending child, then retry."}
   else if status.as_u16()==401||message.contains("Authentication required"){"Your sync session expired. Sign in again. Local changes are saved."}
   else if status.as_u16()==403{"The server denied access. Check the account and UniDesk database policies."}
   else if message.contains("cursor"){"The server history changed. Restore its database backup before syncing this workspace."}
   else if status.is_server_error(){"Cloud sync is temporarily unavailable. Your changes are saved locally."}
   else{"The server rejected this sync batch. Check that all UniDesk Supabase migrations are installed; local work is retained."}.into());
 }
serde_json::from_slice(&bytes).map_err(|_|"Invalid account server response".into())
}
fn save_session(mut settings:Value,session:Value)->Result<Value,String>{
 if session["access_token"].as_str().is_none()||session["refresh_token"].as_str().is_none()||session["user"]["id"].as_str().is_none(){return Err("Confirm your email, then sign in to finish connecting.".into());}
 settings["access_token"]=session["access_token"].clone();settings["refresh_token"]=session["refresh_token"].clone();settings["user"]=json!({"id":session["user"]["id"],"email":session["user"]["email"]});
 settings["expires_at"]=json!(chrono::Utc::now().timestamp()+session["expires_in"].as_i64().unwrap_or(3600));
 device::secret(VAULT,"save",Some(&settings.to_string()))?;Ok(settings)
}
fn session()->Result<Value,String>{
 let _guard=SESSION_LOCK.lock().map_err(|_|"Account is busy")?;
 let settings=config()?.ok_or("Sign in to sync")?;
 if settings["provider"]!="supabase"{return Err("Supabase account is not configured".into());}
 if settings["expires_at"].as_i64().unwrap_or(0)>chrono::Utc::now().timestamp()+60{return Ok(settings);}
 let url=endpoint(settings["endpoint"].as_str().ok_or("Missing endpoint")?)?;
 let response=client()?.post(url.join("auth/v1/token?grant_type=refresh_token").map_err(|_|"Invalid endpoint")?).header("apikey",settings["api_key"].as_str().ok_or("Missing public key")?).json(&json!({"refresh_token":settings["refresh_token"]})).send().map_err(|_|"Offline. Sign-in and local data are retained.")?;
 let updated=read_json(response,true)?;
 if updated["user"]["id"]!=settings["user"]["id"] {return Err("Account identity changed; sign in again".into());}
 save_session(settings,updated)
}
pub fn request(method:reqwest::Method,route:&str)->Result<reqwest::blocking::RequestBuilder,String>{
 let s=session()?;let base=endpoint(s["endpoint"].as_str().ok_or("Missing endpoint")?)?;
 let path=if let Some(hash)=route.strip_prefix("blobs/"){format!("storage/v1/object/unidesk-files/{}/{hash}",s["user"]["id"].as_str().ok_or("Missing user")?)}else{route.to_string()};
 Ok(client()?.request(method,base.join(&path).map_err(|_|"Invalid route")?).header("apikey",s["api_key"].as_str().ok_or("Missing key")?).bearer_auth(s["access_token"].as_str().ok_or("Missing session")?))
}
pub fn sync(route:&str,body:Value)->Result<Value,String>{read_json(request(reqwest::Method::POST,"rest/v1/rpc/unidesk_sync")?.json(&json!({"p_route":route,"p_body":body})).send().map_err(|_|"Your changes are saved locally. UniDesk could not reach sync right now.")?,false)}

#[tauri::command]
pub async fn sync_account(action:String,url:Option<String>,public_key:Option<String>,email:Option<String>,password:Option<String>)->Result<Value,String>{
 tauri::async_runtime::spawn_blocking(move||{
  let _guard=SESSION_LOCK.lock().map_err(|_|"Account is busy")?;
  if action=="signout" {device::secret(VAULT,"remove",None)?;return Ok(json!({"configured":false}));}
  if action=="signin"||action=="signup" {
   let base=endpoint(url.as_deref().unwrap_or(""))?;let key=public_key.unwrap_or_default();
   if key.is_empty()||key.starts_with("sb_secret_"){return Err("Use the publishable/anon API key, never the service role key".into());}
   if key.starts_with("eyJ") {
    use base64::Engine;
    if let Some(payload)=key.split('.').nth(1).and_then(|p|base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(p).ok()).and_then(|p|serde_json::from_slice::<Value>(&p).ok()) {if payload["role"]=="service_role"{return Err("Service role keys must not be stored in the app".into());}}
   }
   let email=email.unwrap_or_default().trim().to_string();let password=password.unwrap_or_default();
   if !email.contains('@')||password.is_empty(){return Err("Enter your account email and password".into());}
   let route=if action=="signup"{"auth/v1/signup"}else{"auth/v1/token?grant_type=password"};
   let result=read_json(client()?.post(base.join(route).map_err(|_|"Invalid endpoint")?).header("apikey",&key).json(&json!({"email":email,"password":password})).send().map_err(|_|"Account server is unavailable")?,true)?;
   if result["access_token"].is_null(){return Ok(json!({"configured":false,"message":"Check your email to confirm the account, then sign in."}));}
   save_session(json!({"provider":"supabase","endpoint":base,"api_key":key}),result)?;
  }else if action!="status"{return Err("Unknown account action".into());}
  match config()? {Some(s)=>Ok(json!({"configured":true,"provider":s["provider"],"endpoint":s["endpoint"],"publicKey":s["api_key"],"email":s["user"]["email"]})),None=>Ok(json!({"configured":false}))}
 }).await.map_err(|e|e.to_string())?
}
