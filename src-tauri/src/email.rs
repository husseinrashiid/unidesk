//! Read-only Microsoft Graph adapter. Tokens never cross the webview boundary.
use reqwest::blocking::Client;
use serde_json::{json, Value};
use std::{collections::HashMap, sync::{Mutex, OnceLock}, time::{Duration, Instant}};
#[cfg(windows)]
use windows_sys::Win32::Security::Credentials::*;
use tauri::{Manager, State};
use super::Store;
use super::microsoft_auth::{self,MailError,MicrosoftTransport,Poll,Grant,GRAPH};

#[derive(Clone)]
struct Device { grant:Grant, session:String, expires:Instant, next_poll:Instant, interval:u64 }
struct Access { token: String, expires: Instant }
static DEVICE: OnceLock<Mutex<Option<Device>>> = OnceLock::new();
static ACCESS: OnceLock<Mutex<HashMap<String, Access>>> = OnceLock::new();
static REQUEST_LOCK: Mutex<()> = Mutex::new(());
static AUTH_SESSION: OnceLock<Mutex<String>> = OnceLock::new();
static DIAGNOSTICS: OnceLock<Mutex<Vec<MailError>>> = OnceLock::new();
fn cancel_session(session_id:Option<&str>)->Result<(),MailError>{
    let mut current=AUTH_SESSION.get_or_init(Default::default).lock().map_err(|_|"Sign-in is busy.")?;
    if session_id.map(|id|id==current.as_str()).unwrap_or(true){*current=String::new();*DEVICE.get_or_init(Default::default).lock().map_err(|_|"Sign-in is busy.")?=None;}
    Ok(())
}
fn finish(app:&tauri::AppHandle,stage:&str,result:Result<Value,MailError>)->Result<Value,MailError>{
    if let Err(error)=&result {
        eprintln!("UniDesk Microsoft {stage}: {} {} {}",error.timestamp,error.code,error.message);
        if let Ok(mut logs)=DIAGNOSTICS.get_or_init(Default::default).lock(){logs.push(error.clone());if logs.len()>20{logs.remove(0);}}
        let store=app.state::<Store>();
        if let Some(parent)=store.path.parent(){
            let path=parent.join("microsoft-email-diagnostics.jsonl");
            let truncate=std::fs::metadata(&path).map(|m|m.len()>65536).unwrap_or(false);
            use std::io::Write;
            if let Ok(mut file)=std::fs::OpenOptions::new().create(true).write(true).append(!truncate).truncate(truncate).open(path){
                if let Ok(line)=serde_json::to_string(&json!({"stage":stage,"error":error})){let _=writeln!(file,"{line}");}
            }
        }
    }
    result
}
fn client() -> Result<Client, String> {
    Client::builder().timeout(Duration::from_secs(35)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_| "Could not start the secure connection.".into())
}
fn field<'a>(v: &'a Value, key: &str) -> Result<&'a str, String> { v[key].as_str().filter(|s| !s.is_empty()).ok_or_else(|| "Microsoft returned incomplete data. Please retry.".into()) }
fn target(account: &str) -> Vec<u16> { format!("UniDesk/{}/{account}",if account.starts_with("gmail:") {"Google"} else {"Microsoft"}).encode_utf16().chain(Some(0)).collect() }
pub(crate) fn credential(account: &str, value: Option<&str>) -> Result<Option<String>, String> {
    let name = format!("UniDesk/{}/{account}", if account.starts_with("gmail:") { "Google" } else { "Microsoft" });
    let result = crate::device::secret(&name, if value.is_some() { "save" } else { "read" }, value)?;
    if value.is_none() && result.is_none() { return Err("Sign-in expired or was removed. Reconnect your account.".into()); }
    Ok(result)
}
fn response(response: reqwest::blocking::Response) -> Result<Value, MailError> {
    microsoft_auth::success(microsoft_auth::decode_response(response)?)
}
fn send(request: reqwest::blocking::RequestBuilder) -> Result<reqwest::blocking::Response, MailError> {
    request.send().map_err(|_| MailError::network())
}
fn remember(account: &str, value: &Value) -> Result<String, String> {
    let token = field(value, "access_token")?.to_string();
    if let Some(refresh) = value["refresh_token"].as_str() { credential(account, Some(refresh))?; }
    ACCESS.get_or_init(Default::default).lock().map_err(|_| "Mailbox is busy.")?.insert(account.into(), Access {
        token: token.clone(), expires: Instant::now() + Duration::from_secs(value["expires_in"].as_u64().unwrap_or(3600).saturating_sub(120)),
    });
    Ok(token)
}
fn token(account: &str, client_id: &str) -> Result<String, MailError> {
    if let Some(access) = ACCESS.get_or_init(Default::default).lock().map_err(|_| "Mailbox is busy.")?.get(account) {
        if access.expires > Instant::now() { return Ok(access.token.clone()); }
    }
    let refresh = credential(account, None)?.ok_or("Reconnect your account.")?;
    let result = microsoft_auth::refresh(&mut MicrosoftTransport::new()?,client_id,&refresh)?;
    Ok(remember(account, &result)?)
}
fn graph_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|_| "Invalid Microsoft request.")?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("graph.microsoft.com") || parsed.port().is_some() || !parsed.username().is_empty() || parsed.password().is_some() || !parsed.path().starts_with("/v1.0/me/") {
        return Err("Refused a mailbox request outside Microsoft Graph.".into());
    }
    Ok(parsed)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn graph_requests_never_send_credentials_to_other_origins() {
        assert!(graph_url("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=x").is_ok());
        for url in ["http://graph.microsoft.com/v1.0/me/messages", "https://graph.microsoft.com.evil.example/v1.0/me/messages", "https://graph.microsoft.com@evil.example/v1.0/me/messages", "https://graph.microsoft.com/v1.0/users/other/messages", "https://graph.microsoft.com:8080/v1.0/me/messages"] {
            assert!(graph_url(url).is_err());
        }
    }
    #[test]
    fn windows_credential_round_trip_uses_an_isolated_test_entry() {
        let account = format!("test-{}", uuid::Uuid::new_v4());
        struct Cleanup(String);
        impl Drop for Cleanup { fn drop(&mut self) { unsafe { CredDeleteW(target(&self.0).as_ptr(), CRED_TYPE_GENERIC, 0); } } }
        let _cleanup = Cleanup(account.clone());
        credential(&account, Some("test-refresh-value-not-a-real-token")).unwrap();
        assert_eq!(credential(&account,None).unwrap().as_deref(),Some("test-refresh-value-not-a-real-token"));
        unsafe { assert_ne!(CredDeleteW(target(&account).as_ptr(), CRED_TYPE_GENERIC, 0),0); }
        assert!(credential(&account,None).is_err());
    }
    #[test]
    fn cancelling_an_old_ui_session_cannot_cancel_a_new_signin() {
        *AUTH_SESSION.get_or_init(Default::default).lock().unwrap()="new-session".into();
        cancel_session(Some("old-session")).unwrap();
        assert_eq!(AUTH_SESSION.get().unwrap().lock().unwrap().as_str(),"new-session");
        cancel_session(Some("new-session")).unwrap();
        assert!(AUTH_SESSION.get().unwrap().lock().unwrap().is_empty());
        assert!(DEVICE.get().unwrap().lock().unwrap().is_none());
    }
}
fn get(account: &str, client_id: &str, url: &str) -> Result<Value, MailError> {
    let request=||send(client()?.get(graph_url(url)?).bearer_auth(token(account, client_id)?).header("Prefer", "IdType=\"ImmutableId\", outlook.body-content-type=\"text\", odata.maxpagesize=50"));
    let first=request()?;
    if first.status().as_u16()==401 {
        ACCESS.get_or_init(Default::default).lock().map_err(|_|"Mailbox is busy.")?.remove(account);
        return response(request()?);
    }
    response(first)
}

#[tauri::command]
pub async fn email_auth(app: tauri::AppHandle, action: String, client_id: Option<String>, session_id:Option<String>) -> Result<Value, MailError> {
    let log_app=app.clone();
    let result=tauri::async_runtime::spawn_blocking(move || {
        if action=="diagnostics" {
            let details=DIAGNOSTICS.get_or_init(Default::default).lock().map_err(|_|"Diagnostics are busy.")?.iter().map(MailError::details).collect::<Vec<_>>().join("\n\n");
            return Ok(json!({"details":details}));
        }
        if action=="open" {crate::device::open_url(microsoft_auth::VERIFY).map_err(|_|"Could not open Microsoft sign-in.")?;return Ok(json!(null));}
        if action=="cancel" {
            cancel_session(session_id.as_deref())?;
            return Ok(json!(null));
        }
        if action=="begin" {
            let id=client_id.ok_or("Enter a Microsoft 365 Client ID first.")?;let id=id.trim();microsoft_auth::validate_id(id)?;
            let session=uuid::Uuid::new_v4().to_string();
            {let mut current=AUTH_SESSION.get_or_init(Default::default).lock().map_err(|_|"Sign-in is busy.")?;*current=session.clone();*DEVICE.get_or_init(Default::default).lock().map_err(|_|"Sign-in is busy.")?=None;}
            let grant=microsoft_auth::begin(&mut MicrosoftTransport::new()?,id)?;
            let current=AUTH_SESSION.get_or_init(Default::default).lock().map_err(|_|"Sign-in is busy.")?;
            if *current!=session{return Err(MailError::new("login_cancelled","cancelled","Sign-in was cancelled. Retry when you are ready."));}
            let reply=json!({"sessionId":session,"userCode":grant.user_code,"verificationUrl":grant.verification_uri,"expiresIn":grant.expires_in,"interval":grant.interval});
            *DEVICE.get_or_init(Default::default).lock().map_err(|_|"Sign-in is busy.")?=Some(Device{expires:Instant::now()+Duration::from_secs(grant.expires_in),next_poll:Instant::now()+Duration::from_secs(grant.interval),interval:grant.interval,grant,session});
            return Ok(reply);
        }
        if action!="poll"{return Err("Unknown sign-in operation.".into());}
        let snapshot={
            let mut guard=DEVICE.get_or_init(Default::default).lock().map_err(|_|"Sign-in is busy.")?;
            let device=guard.as_mut().ok_or("Start sign-in again.")?;
            if session_id.as_deref()!=Some(device.session.as_str()){return Err(MailError::new("login_cancelled","cancelled","This sign-in session is no longer active. Retry to get a new code."));}
            if device.expires<=Instant::now(){*guard=None;return Err(MailError::new("expired_token","expired","Sign-in code expired. Retry to get a new code."));}
            if device.next_poll>Instant::now(){return Ok(json!({"pending":true,"interval":device.interval}));}
            device.next_poll=Instant::now()+Duration::from_secs(device.interval);device.clone()
        };
        let polled=microsoft_auth::poll(&mut MicrosoftTransport::new()?,&snapshot.grant);
        // Network requests run without the session lock, so Cancel remains responsive.
        let _request=REQUEST_LOCK.lock().map_err(|_|"Mailbox is busy.")?;
        let mut current=AUTH_SESSION.get_or_init(Default::default).lock().map_err(|_|"Sign-in is busy.")?;
        if *current!=snapshot.session{return Err(MailError::new("login_cancelled","cancelled","Sign-in was cancelled. Retry when you are ready."));}
        let mut guard=DEVICE.get_or_init(Default::default).lock().map_err(|_|"Sign-in is busy.")?;
        match polled {
            Ok(Poll::Pending)=>Ok(json!({"pending":true,"interval":snapshot.interval})),
            Ok(Poll::SlowDown)=>{if let Some(d)=guard.as_mut(){d.interval=(d.interval+5).min(300);d.next_poll=Instant::now()+Duration::from_secs(d.interval);return Ok(json!({"pending":true,"interval":d.interval}));}Err("Start sign-in again.".into())},
            Err(error)=>{*guard=None;*current=String::new();Err(error)},
            Ok(Poll::Authorized{tokens,profile})=>{
                let email=microsoft_auth::account_email(&profile)?;
                let store:State<Store>=app.state();let db=store.db.lock().map_err(|_|"Database is busy.")?;
                let existing:Option<String>=db.query_row("SELECT id FROM email_accounts WHERE lower(email_address)=lower(?) AND client_id=?",[email,snapshot.grant.client.as_str()],|r|r.get(0)).ok();
                let account=existing.unwrap_or_else(||uuid::Uuid::new_v4().to_string());
                remember(&account,&tokens)?;
                let saved=db.execute("INSERT INTO email_accounts(id,provider,email_address,display_name,client_id,connected) VALUES(?,'microsoft',?,?,?,1) ON CONFLICT(id) DO UPDATE SET connected=1,display_name=excluded.display_name,email_address=excluded.email_address,sync_error='',retry_after=NULL",rusqlite::params![account,email,profile["displayName"].as_str().unwrap_or(email),snapshot.grant.client]);
                if saved.is_err(){let _=crate::device::secret(&format!("UniDesk/Microsoft/{account}"),"remove",None);ACCESS.get_or_init(Default::default).lock().map_err(|_|"Mailbox is busy.")?.remove(&account);return Err("Could not save your account. Retry sign-in.".into());}
                *guard=None;*current=String::new();
                Ok(json!({"connected":true,"accountId":account,"emailAddress":email}))
            }
        }
    }).await.unwrap_or_else(|_|Err("Sign-in could not finish. Please retry.".into()));
    finish(&log_app,"authentication",result)
}

#[tauri::command]
pub async fn email_request(app: tauri::AppHandle, account_id: String, operation: String, value: Option<String>) -> Result<Value, MailError> {
    let log_app=app.clone();
    let result=tauri::async_runtime::spawn_blocking(move || {
        let _request = REQUEST_LOCK.lock().map_err(|_| "Mailbox is busy.")?;
        let (client_id, connected): (String,i64) = {
            let store: State<Store> = app.state();
            let db = store.db.lock().map_err(|_| "Database is busy.")?;
            db.query_row("SELECT client_id,connected FROM email_accounts WHERE id=? AND mail_provider='microsoft'", [&account_id], |r| Ok((r.get(0)?,r.get(1)?))).map_err(|_| "This mailbox is no longer configured.")?
        };
        if operation == "disconnect" {
            crate::device::secret(&format!("UniDesk/Microsoft/{account_id}"), "remove", None)?;
            ACCESS.get_or_init(Default::default).lock().map_err(|_| "Mailbox is busy.")?.remove(&account_id);
            let store: State<Store> = app.state();
            store.db.lock().map_err(|_| "Database is busy.")?.execute("UPDATE email_accounts SET connected=0 WHERE id=? AND mail_provider='microsoft'", [&account_id]).map_err(|_| "Could not update account status.")?;
            return Ok(json!(null));
        }
        if connected == 0 { return Err("Reconnect your mailbox to sync or download messages.".into()); }
        let value = value.unwrap_or_default();
        match operation.as_str() {
            "page" => get(&account_id, &client_id, &value),
            "attachments" => {
                let mut url = reqwest::Url::parse(&format!("{GRAPH}/me/messages/")).unwrap();
                url.path_segments_mut().unwrap().pop_if_empty().push(&value).push("attachments");
                url.set_query(Some("$select=id,name,contentType,size,isInline&$top=100"));
                get(&account_id, &client_id, url.as_str())
            },
            "body" => {
                let mut url = reqwest::Url::parse(&format!("{GRAPH}/me/messages/")).unwrap();
                url.path_segments_mut().unwrap().pop_if_empty().push(&value);
                url.set_query(Some("$select=uniqueBody,body"));
                get(&account_id, &client_id, url.as_str())
            },
            "open" => {
                let url = reqwest::Url::parse(&value).map_err(|_| "Invalid Outlook link.")?;
                if url.scheme() != "https" || ![Some("outlook.office.com"),Some("outlook.office365.com"),Some("outlook.live.com")].contains(&url.host_str()) || !url.username().is_empty() || url.password().is_some() { return Err("This is not a supported Outlook link.".into()); }
                crate::device::open_url(url.as_str()).map_err(|_| "Could not open Outlook.".to_string())?;
                Ok(json!(null))
            },
            _ => Err("Unsupported read-only mailbox operation.".into()),
        }
    }).await.unwrap_or_else(|_|Err("Mailbox request could not finish.".into()));
    finish(&log_app,"mailbox",result)
}

#[tauri::command]
pub async fn email_save_attachment(app: tauri::AppHandle, attachment_id: String, course_id: String, category: String, conflict: Option<String>) -> Result<Value, MailError> {
    let log_app=app.clone();
    let result=tauri::async_runtime::spawn_blocking(move || {
        let _request=REQUEST_LOCK.lock().map_err(|_| "Mailbox is busy.")?;
        let store: State<Store> = app.state();
        let (account,client_id,message,attachment,name,size,connected,provider): (String,String,String,String,String,i64,i64,String) = {
            let db=store.db.lock().map_err(|_| "Database is busy.")?;
            db.query_row("SELECT e.account_id,a.client_id,e.provider_message_id,t.provider_attachment_id,t.filename,t.size,a.connected,a.mail_provider FROM email_attachments t JOIN emails e ON e.id=t.email_id JOIN email_accounts a ON a.id=e.account_id WHERE t.id=? AND t.attachment_type='file'", [&attachment_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?))).map_err(|_| "This file attachment is no longer available.")?
        };
        if connected==0 {return Err("Reconnect the mailbox to download this attachment.".into());}
        if size>30_000_000 {return Err("For attachments over 30 MB, save from your mailbox and use UniDesk's normal file import.".into());}
        let bytes=if provider=="gmail" {crate::gmail::attachment_bytes(&account,&client_id,&message,&attachment)?} else {
        let mut url=reqwest::Url::parse(&format!("{GRAPH}/me/messages/")).unwrap();
        url.path_segments_mut().unwrap().pop_if_empty().push(&message).push("attachments").push(&attachment).push("$value");
        let reply=send(client()?.get(graph_url(url.as_str())?).bearer_auth(token(&account,&client_id)?))?;
        if !reply.status().is_success() { response(reply)?; return Err("Could not download the attachment.".into()); }
        use std::io::Read;
        let mut bytes=Vec::new();
        reply.take(30_000_001).read_to_end(&mut bytes).map_err(|_| "Attachment download was interrupted. Nothing was imported.")?;
        if bytes.len()>30_000_000 {return Err("This attachment is larger than the 30 MB download limit.".into());}
        bytes
        };
        let result=super::import_file(store.clone(),course_id,category,None,Some(name),Some(bytes),conflict,None)?;
        if let Some(id)=result["id"].as_str() {
            let db=store.db.lock().map_err(|_| "File was saved, but its email link could not be recorded.")?;
            db.execute("UPDATE email_attachments SET downloaded=1,file_id=?,local_path=(SELECT absolute_path FROM files WHERE id=?) WHERE id=?",rusqlite::params![id,id,attachment_id]).map_err(|_| "File was saved, but its email link could not be recorded.")?;
        }
        Ok(result)
    }).await.unwrap_or_else(|_|Err("Attachment download could not finish.".into()));
    finish(&log_app,"attachment",result)
}
