//! Gmail public desktop OAuth and read-only API. No tokens cross the webview.
use std::{collections::HashMap, io::{Read,Write}, net::TcpListener, path::PathBuf, sync::{Mutex,OnceLock}, time::{Duration,Instant}};
use base64::{Engine,engine::general_purpose::URL_SAFE_NO_PAD};
use reqwest::blocking::Client;
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use tauri::Manager;
use crate::{Store,email::credential,microsoft_auth::MailError};
const SCOPE:&str="https://www.googleapis.com/auth/gmail.readonly";
const API:&str="https://gmail.googleapis.com/gmail/v1/users/me";
static SESSION:OnceLock<Mutex<(String,Option<Result<Value,MailError>>)>>=OnceLock::new();
static TOKENS:OnceLock<Mutex<HashMap<String,(String,Instant)>>>=OnceLock::new();
static LOCK:Mutex<()>=Mutex::new(());
static DIAG_DIR:OnceLock<PathBuf>=OnceLock::new();
fn init_diagnostics(app:&tauri::AppHandle){DIAG_DIR.get_or_init(||app.state::<Store>().path.parent().map(PathBuf::from).unwrap_or_default());}
fn log_raw(status:u16,body:&Value){
    let Some(dir)=DIAG_DIR.get() else {return};
    if dir.as_os_str().is_empty(){return}
    let path=dir.join("gmail-diagnostics.jsonl");
    let truncate=std::fs::metadata(&path).map(|m|m.len()>65536).unwrap_or(false);
    if let Ok(mut file)=std::fs::OpenOptions::new().create(true).write(true).append(!truncate).truncate(truncate).open(path){
        if let Ok(text)=serde_json::to_string(&json!({"timestamp":chrono::Utc::now().to_rfc3339(),"http_status":status,"error":body["error"],"error_description":body["error_description"]})){let _=writeln!(file,"{text}");}
    }
}
fn error(code:&str)->MailError {
    let (kind,message)=match code {
        "invalid_client"|"unauthorized_client" =>("configuration","Google rejected this OAuth client. Use a Google OAuth client of type Desktop app and enter both values from its downloaded JSON configuration."),
        "invalid_config" =>("configuration","Enter a Google OAuth Client ID in the form ...apps.googleusercontent.com, exactly as shown in your downloaded Desktop app JSON."),
        "secret_required" =>("configuration","Expand \"Google Desktop app configuration\" below and enter the client secret from the same downloaded Desktop app JSON file, then try Connect Gmail again."),
        "secret_too_long" =>("configuration","That client secret looks incorrect. Copy installed.client_secret exactly from the downloaded Desktop app JSON file."),
        "invalid_request"|"redirect_uri_mismatch"|"unsupported_grant_type"|"invalid_scope" =>("configuration","Google rejected the desktop OAuth configuration. Enter the client ID and client secret from the same downloaded Desktop app JSON file, then reconnect."),
        "invalid_grant"|"401" =>("auth","Gmail connection needs attention. Reconnect to renew access."),
        "access_denied" =>("cancelled","Google sign-in was cancelled or access was declined. Retry when ready."),
        "admin_policy_enforced" =>("policy","This Google account's administrator has blocked third-party app access. Use a personal Gmail account, or ask the administrator to allow this app."),
        "org_internal" =>("configuration","This Google OAuth client is restricted to an internal organization and cannot authorize this account. Recreate it with an External audience."),
        "expired" =>("expired","Google sign-in timed out. Retry to open a new sign-in window."),
        "429"|"rateLimitExceeded"|"userRateLimitExceeded" =>("rate_limit","Google is limiting requests. Please retry after 300 seconds."),
        "403" =>("policy","Google denied mailbox access. Check that Gmail API is enabled, your account is an OAuth test user, and read-only Gmail access was granted."),
        "404" =>("missing","This Gmail message or sync history is no longer available."),
        "network" =>("network","Gmail is unavailable. Check your connection; cached email is still available."),
        _ =>("provider","Gmail could not finish this request. Retry or reconnect from Email settings."),
    };MailError::new(code,kind,message)
}
fn checked(result:Result<Value,MailError>)->Result<Value,MailError>{if let Err(e)=&result {eprintln!("UniDesk Gmail: {} {} {}",e.timestamp,e.code,e.message);}result}
fn client()->Result<Client,MailError>{Client::builder().timeout(Duration::from_secs(35)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_|error("network"))}
fn provider_error(data:&Value,status:u16)->MailError{
    let raw=data["error"].as_str().or_else(||data["error"]["status"].as_str()).or_else(||data["error"]["errors"][0]["reason"].as_str()).unwrap_or("");
    let code=match raw {"invalid_grant"|"invalid_client"|"unauthorized_client"|"invalid_request"|"redirect_uri_mismatch"|"unsupported_grant_type"|"invalid_scope"|"admin_policy_enforced"|"org_internal"|"access_denied"|"rateLimitExceeded"|"userRateLimitExceeded"=>raw.to_string(),_=>status.to_string()};
    let mut e=error(&code);e.http_status=Some(status);e
}
fn decode(r:reqwest::blocking::Response)->Result<Value,MailError>{
    let status=r.status().as_u16();let mut bytes=Vec::new();r.take(45_000_001).read_to_end(&mut bytes).map_err(|_|error("network"))?;
    if bytes.len()>45_000_000{return Err(error("response_too_large"));}
    let data:Value=serde_json::from_slice(&bytes).map_err(|_|error("invalid_response"))?;
    if !(200..300).contains(&status){log_raw(status,&data);return Err(provider_error(&data,status));}Ok(data)
}
#[cfg(test)]
thread_local! {static MOCK_POST:std::cell::RefCell<Option<Result<Value,MailError>>>=const {std::cell::RefCell::new(None)};static LAST_FORM:std::cell::RefCell<Vec<(String,String)>>=const {std::cell::RefCell::new(Vec::new())};static MOCK_GET:std::cell::RefCell<Option<Result<Value,MailError>>>=const {std::cell::RefCell::new(None)};}
fn post(fields:&[(&str,&str)])->Result<Value,MailError>{
    #[cfg(test)] {if let Some(result)=MOCK_POST.with(|v|v.borrow_mut().take()){LAST_FORM.with(|v|*v.borrow_mut()=fields.iter().map(|(k,v)|(k.to_string(),v.to_string())).collect());return result;}}
    decode(client()?.post("https://oauth2.googleapis.com/token").form(fields).send().map_err(|_|error("network"))?)}
fn required<'a>(v:&'a Value,k:&str)->Result<&'a str,MailError>{v[k].as_str().filter(|s|!s.is_empty()).ok_or_else(||error("invalid_response"))}
fn validate_id(id:&str)->Result<(),MailError>{if !id.ends_with(".apps.googleusercontent.com") || id.len()>300 || id.len()<30 || !id.bytes().all(|c|c.is_ascii_alphanumeric()||b".-_".contains(&c)){return Err(error("invalid_config"));}Ok(())}
fn remember(account:&str,data:&Value)->Result<String,MailError>{
    let access=required(data,"access_token")?.to_string();
    if let Some(scope)=data["scope"].as_str(){if !scope.split_whitespace().any(|s|s==SCOPE){return Err(error("403"));}}
    if let Some(refresh)=data["refresh_token"].as_str(){credential(account,Some(refresh))?;}
    TOKENS.get_or_init(Default::default).lock().map_err(|_|error("busy"))?.insert(account.into(),(access.clone(),Instant::now()+Duration::from_secs(data["expires_in"].as_u64().unwrap_or(3600).clamp(120,86400)-60)));Ok(access)
}
fn config_secret(id:&str)->Option<String>{credential(&format!("gmail:config:{id}"),None).ok().flatten()}
fn token(account:&str,id:&str)->Result<String,MailError>{
    if let Some((access,expires))=TOKENS.get_or_init(Default::default).lock().map_err(|_|error("busy"))?.get(account){if *expires>Instant::now(){return Ok(access.clone());}}
    let refresh=credential(account,None).map_err(|_|error("invalid_grant"))?.ok_or_else(||error("invalid_grant"))?;
    let secret=config_secret(id);let mut fields=vec![("client_id",id),("refresh_token",refresh.as_str()),("grant_type","refresh_token")];if let Some(s)=&secret{fields.push(("client_secret",s));}remember(account,&post(&fields)?)
}

fn exchange(id:&str,code:&str,verifier:&str,redirect:&str)->Result<Value,MailError>{
    let secret=config_secret(id);let mut fields=vec![("client_id",id),("code",code),("code_verifier",verifier),("redirect_uri",redirect),("grant_type","authorization_code")];if let Some(s)=&secret{fields.push(("client_secret",s));}
    let tokens=post(&fields)?;required(&tokens,"access_token")?;required(&tokens,"refresh_token")?;Ok(tokens)
}
fn api_url(path:&str)->Result<reqwest::Url,MailError>{
    let url=reqwest::Url::parse(&format!("{API}/{path}")).map_err(|_|error("invalid_request"))?;
    if url.scheme()!="https"||url.host_str()!=Some("gmail.googleapis.com")||!url.path().starts_with("/gmail/v1/users/me/"){return Err(error("invalid_request"));}Ok(url)
}
fn get(account:&str,id:&str,path:&str)->Result<Value,MailError>{
    #[cfg(test)] {if let Some(result)=MOCK_GET.with(|v|v.borrow_mut().take()){api_url(path)?;return result;}}
    let request=||client()?.get(api_url(path)?).bearer_auth(token(account,id)?).send().map_err(|_|error("network"));
    let first=request()?;if first.status().as_u16()==401{TOKENS.get_or_init(Default::default).lock().map_err(|_|error("busy"))?.remove(account);return decode(request()?);}decode(first)
}
fn escaped(s:&str)->String{reqwest::Url::parse("https://localhost/").map(|mut u|{u.path_segments_mut().unwrap().push(s);u.path()[1..].to_string()}).unwrap_or_default()}
fn remove_credential(account:&str)->Result<(),MailError>{
crate::device::secret(&format!("UniDesk/Google/{account}"), "remove", None).map_err(|_| error("credential_remove"))?; Ok(())
}
fn callback(target:&str,state:&str)->Result<Option<String>,MailError>{
    let u=reqwest::Url::parse(&format!("http://127.0.0.1{target}")).map_err(|_|error("callback"))?;
    if u.path()!="/oauth2callback" {return Ok(None);}
    let pairs:HashMap<_,_>=u.query_pairs().into_owned().collect();if pairs.get("state").map(String::as_str)!=Some(state){return Ok(None);}
    if pairs.contains_key("error"){return Err(error("access_denied"));}Ok(pairs.get("code").filter(|c|c.len()<8192).cloned())
}
#[tauri::command]
pub async fn gmail_auth(app:tauri::AppHandle,action:String,client_id:Option<String>,client_secret:Option<String>,session_id:Option<String>)->Result<Value,MailError>{
    init_diagnostics(&app);
    if action=="cancel"{let mut s=SESSION.get_or_init(Default::default).lock().map_err(|_|error("busy"))?;if session_id.as_deref()==Some(s.0.as_str()){s.0.clear();s.1=None;}return Ok(json!(null));}
    if action=="status"{let mut s=SESSION.get_or_init(Default::default).lock().map_err(|_|error("busy"))?;if session_id.as_deref()!=Some(s.0.as_str()){return Err(error("access_denied"));}return checked(s.1.take().unwrap_or(Ok(json!({"pending":true}))));}
    if action!="begin"{return Err(error("invalid_request"));}
    let id=client_id.unwrap_or_default().trim().to_string();validate_id(&id)?;
    let existing_secret=config_secret(&id);
    let submitted_secret=client_secret.filter(|s|!s.trim().is_empty());
    if existing_secret.is_none() && submitted_secret.is_none(){return Err(error("secret_required"));}
    if let Some(secret)=submitted_secret{if secret.len()>2000{return Err(error("secret_too_long"));}credential(&format!("gmail:config:{id}"),Some(secret.trim()))?;}
    let listener=TcpListener::bind("127.0.0.1:0").map_err(|_|error("callback_bind"))?;listener.set_nonblocking(true).map_err(|_|error("callback_bind"))?;
    let redirect=format!("http://127.0.0.1:{}/oauth2callback",listener.local_addr().map_err(|_|error("callback_bind"))?.port());
    let state=uuid::Uuid::new_v4().to_string();let session=uuid::Uuid::new_v4().to_string();let verifier=format!("{}{}",uuid::Uuid::new_v4().simple(),uuid::Uuid::new_v4().simple());let challenge=URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut url=reqwest::Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();url.query_pairs_mut().extend_pairs([("client_id",id.as_str()),("redirect_uri",redirect.as_str()),("response_type","code"),("scope",SCOPE),("access_type","offline"),("prompt","consent select_account"),("state",state.as_str()),("code_challenge",challenge.as_str()),("code_challenge_method","S256")]);
    *SESSION.get_or_init(Default::default).lock().map_err(|_|error("busy"))?=(session.clone(),None);
    if crate::device::open_url(url.as_str()).is_err(){return Err(error("browser_open"));}
    let result_session=session.clone();
    tauri::async_runtime::spawn_blocking(move||{
        let result=(||->Result<Value,MailError>{
            let deadline=Instant::now()+Duration::from_secs(600);
            loop {
                if SESSION.get_or_init(Default::default).lock().map_err(|_|error("busy"))?.0!=result_session{return Err(error("access_denied"));}
                if Instant::now()>deadline{return Err(error("expired"));}
                let (mut stream,_)=match listener.accept(){Ok(v)=>v,Err(e) if e.kind()==std::io::ErrorKind::WouldBlock=>{std::thread::sleep(Duration::from_millis(100));continue;},Err(_)=>return Err(error("callback"))};
                stream.set_read_timeout(Some(Duration::from_secs(2))).ok();stream.set_write_timeout(Some(Duration::from_secs(2))).ok();let mut bytes=[0u8;16384];let n=stream.read(&mut bytes).unwrap_or(0);let request=String::from_utf8_lossy(&bytes[..n]);let target=request.lines().next().and_then(|s|s.strip_prefix("GET ")).and_then(|s|s.split_whitespace().next()).unwrap_or("");
                let code=callback(target,&state);let text=if matches!(code,Ok(Some(_))){"Sign-in received. Return to UniDesk to confirm the connected account."}else{"Sign-in was not completed. Return to UniDesk and retry."};let _=write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",text.len(),text);
                let code=match code?{Some(c)=>c,None=>continue};
                let tokens=exchange(&id,&code,&verifier,&redirect)?;
                let profile=decode(client()?.get(format!("{API}/profile")).bearer_auth(required(&tokens,"access_token")?).send().map_err(|_|error("network"))?)?;
                let email=required(&profile,"emailAddress")?.to_lowercase();if !email.contains('@')||email.len()>320{return Err(error("invalid_response"));}
                let _lock=LOCK.lock().map_err(|_|error("busy"))?;let current=SESSION.get_or_init(Default::default).lock().map_err(|_|error("busy"))?;if current.0!=result_session{return Err(error("access_denied"));}
                let account=format!("gmail:{email}");remember(&account,&tokens)?;
                app.state::<Store>().db.lock().map_err(|_|error("database"))?.execute("INSERT INTO email_accounts(id,provider,mail_provider,email_address,display_name,client_id,connected) VALUES(?,'microsoft','gmail',?,?,?,1) ON CONFLICT(id) DO UPDATE SET client_id=excluded.client_id,connected=1,sync_error='',retry_after=NULL",rusqlite::params![account,email,email,id]).map_err(|_|error("database"))?;
                return Ok(json!({"connected":true,"accountId":account,"emailAddress":email}));
            }
        })();
        if let Ok(mut current)=SESSION.get_or_init(Default::default).lock(){if current.0==result_session{current.1=Some(checked(result));}}
    });
    Ok(json!({"sessionId":session}))
}
#[tauri::command]
pub async fn gmail_request(app:tauri::AppHandle,account_id:String,operation:String,value:Option<String>)->Result<Value,MailError>{
    init_diagnostics(&app);
    checked(tauri::async_runtime::spawn_blocking(move||{
        let _lock=LOCK.lock().map_err(|_|error("busy"))?;
        let store=app.state::<Store>();let (id,connected):(String,i64)=store.db.lock().map_err(|_|error("database"))?.query_row("SELECT client_id,connected FROM email_accounts WHERE id=? AND mail_provider='gmail'",[&account_id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|_|error("account_missing"))?;
        if operation=="disconnect"{remove_credential(&account_id)?;TOKENS.get_or_init(Default::default).lock().map_err(|_|error("busy"))?.remove(&account_id);store.db.lock().map_err(|_|error("database"))?.execute("UPDATE email_accounts SET connected=0 WHERE id=?",[&account_id]).map_err(|_|error("database"))?;return Ok(json!(null));}
        let value=value.unwrap_or_default();
        if operation=="open"{let u=reqwest::Url::parse(&value).map_err(|_|error("invalid_request"))?;if u.scheme()!="https"||u.host_str()!=Some("mail.google.com")||!u.username().is_empty()||u.password().is_some()||u.port().is_some(){return Err(error("invalid_request"));}crate::device::open_url(u.as_str()).map_err(|_|error("browser_open"))?;return Ok(json!(null));}
        if connected==0{return Err(error("invalid_grant"));}
        match operation.as_str(){
            "profile"=>get(&account_id,&id,"profile"),
            "message"=>get(&account_id,&id,&format!("messages/{}?format=full",escaped(&value))),
            "list"|"history"=>{let p:Value=serde_json::from_str(&value).map_err(|_|error("invalid_request"))?;let mut u=api_url(if operation=="list"{"messages"}else{"history"})?;{let mut q=u.query_pairs_mut();q.append_pair("maxResults","25");if operation=="list"{q.append_pair("q",p["query"].as_str().unwrap_or("newer_than:90d -in:spam -in:trash"));}else{q.append_pair("startHistoryId",required(&p,"history")?);q.append_pair("historyTypes","messageAdded");}if let Some(page)=p["page"].as_str(){q.append_pair("pageToken",page);}}get(&account_id,&id,u.as_str().strip_prefix(&format!("{API}/")).unwrap())},
            "attachment"=>{let p:Value=serde_json::from_str(&value).map_err(|_|error("invalid_request"))?;get(&account_id,&id,&format!("messages/{}/attachments/{}",escaped(required(&p,"message")?),escaped(required(&p,"attachment")?)))},
            _=>Err(error("invalid_request"))
        }
    }).await.unwrap_or_else(|_|Err(error("worker"))))
}
pub(crate) fn attachment_bytes(account:&str,id:&str,message:&str,attachment:&str)->Result<Vec<u8>,MailError>{
    let _lock=LOCK.lock().map_err(|_|error("busy"))?;
    let v=if let Some(part)=attachment.strip_prefix("inline:") {
        let message=get(account,id,&format!("messages/{}?format=full",escaped(message)))?;
        fn find<'a>(value:&'a Value,part:&str,depth:usize)->Option<&'a Value>{if depth>30{return None;}if value["partId"].as_str().unwrap_or("")==part && value["filename"].as_str().map(|s|!s.is_empty()).unwrap_or(false){return Some(&value["body"]);}value["parts"].as_array()?.iter().find_map(|v|find(v,part,depth+1))}
        find(&message["payload"],part,0).cloned().ok_or_else(||error("404"))?
    }else{get(account,id,&format!("messages/{}/attachments/{}",escaped(message),escaped(attachment)))?};
    let bytes=URL_SAFE_NO_PAD.decode(required(&v,"data")?.trim_end_matches('=')).map_err(|_|error("attachment_encoding"))?;
    if bytes.len()>30_000_000{return Err(error("attachment_too_large"));}Ok(bytes)
}
#[cfg(test)]mod tests{use super::*;
#[test]fn validates_config(){assert!(validate_id("123456789012-test.apps.googleusercontent.com").is_ok());for id in ["","123","https://evil.example","foo.apps.googleusercontent.com/evil"]{assert!(validate_id(id).is_err());}}
#[test]fn callback_requires_state_and_path(){assert_eq!(callback("/oauth2callback?state=good&code=abc","good").unwrap(),Some("abc".into()));assert!(callback("/oauth2callback?state=wrong&code=abc","good").unwrap().is_none());assert!(callback("/evil?state=good&code=abc","good").unwrap().is_none());assert_eq!(callback("/oauth2callback?state=good&error=access_denied","good").unwrap_err().code,"access_denied");}
#[test]fn pkce_rfc_vector(){assert_eq!(URL_SAFE_NO_PAD.encode(Sha256::digest(b"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")),"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");}
#[test]fn errors_are_safe_and_actionable(){for c in ["invalid_client","invalid_request","redirect_uri_mismatch","invalid_grant","access_denied","expired","network","429","403"]{let e=error(c);assert!(!e.message.contains("access_token"));assert!(!e.message.contains('{'));assert!(!e.timestamp.is_empty());}}
#[test]fn oauth_error_codes_are_preserved_without_provider_descriptions(){
 for code in ["invalid_request","invalid_client","redirect_uri_mismatch"]{let e=provider_error(&json!({"error":code,"error_description":"sensitive provider detail"}),400);assert_eq!(e.code,code);assert!(!e.message.contains("sensitive"));}
 assert_eq!(provider_error(&json!({"error":"unexpected"}),418).code,"418");
}
}

#[cfg(test)] mod lifecycle_tests {
use super::*;
struct Cleanup(String);impl Drop for Cleanup{fn drop(&mut self){let _=remove_credential(&self.0);if let Ok(mut t)=TOKENS.get_or_init(Default::default).lock(){t.remove(&self.0);}}}
#[test]fn code_exchange_uses_pkce_and_loopback_and_requires_refresh(){
 MOCK_POST.with(|v|*v.borrow_mut()=Some(Ok(json!({"access_token":"fixture-access","refresh_token":"fixture-refresh"}))));
 exchange("test-client","fixture-code","verifier","http://127.0.0.1:4242/oauth2callback").unwrap();
 LAST_FORM.with(|v|{let v=v.borrow();assert!(v.contains(&("code_verifier".into(),"verifier".into())));assert!(v.contains(&("grant_type".into(),"authorization_code".into())));assert!(!v.iter().any(|(k,_)|k=="client_secret"));});
 MOCK_POST.with(|v|*v.borrow_mut()=Some(Ok(json!({"access_token":"fixture-access"}))));assert!(exchange("test","code","v","http://127.0.0.1:4242/oauth2callback").is_err());
}
#[test]fn refresh_reuses_secure_credential_and_disconnect_removes_it(){
 let account=format!("gmail:test:{}",uuid::Uuid::new_v4());let _cleanup=Cleanup(account.clone());credential(&account,Some("fixture-refresh")).unwrap();
 MOCK_POST.with(|v|*v.borrow_mut()=Some(Ok(json!({"access_token":"fixture-renewed","expires_in":3600,"scope":SCOPE}))));assert_eq!(token(&account,"test-client").unwrap(),"fixture-renewed");
 LAST_FORM.with(|v|assert!(v.borrow().contains(&("grant_type".into(),"refresh_token".into()))));
 assert_eq!(token(&account,"test-client").unwrap(),"fixture-renewed");remove_credential(&account).unwrap();TOKENS.get().unwrap().lock().unwrap().remove(&account);assert_eq!(token(&account,"test-client").unwrap_err().code,"invalid_grant");
}
#[test]fn revoked_or_offline_refresh_preserves_cached_data_and_can_reconnect(){
 let account=format!("gmail:test:{}",uuid::Uuid::new_v4());let _cleanup=Cleanup(account.clone());credential(&account,Some("fixture-refresh")).unwrap();
 for code in ["invalid_grant","network","invalid_client"]{MOCK_POST.with(|v|*v.borrow_mut()=Some(Err(error(code))));assert_eq!(token(&account,"test-client").unwrap_err().code,code);assert!(credential(&account,None).unwrap().is_some());}
 remember(&account,&json!({"access_token":"reconnected","refresh_token":"new-refresh","scope":SCOPE})).unwrap();assert_eq!(token(&account,"test-client").unwrap(),"reconnected");
}
}

#[cfg(test)] mod attachment_tests{
use super::*;
#[test]fn attachment_bytes_are_unchanged_for_common_formats_and_inline_parts(){
 for bytes in [b"%PDF-1.7 fixture".as_slice(),b"PK fixture DOCX".as_slice(),b"PK fixture PPTX".as_slice(),b"PK fixture ZIP".as_slice()]{MOCK_GET.with(|v|*v.borrow_mut()=Some(Ok(json!({"data":URL_SAFE_NO_PAD.encode(bytes)}))));assert_eq!(attachment_bytes("gmail:test","id","message","attachment").unwrap(),bytes);}
 MOCK_GET.with(|v|*v.borrow_mut()=Some(Ok(json!({"payload":{"parts":[{"partId":"1","filename":"Lecture.pdf","body":{"data":URL_SAFE_NO_PAD.encode(b"inline-file")}}]}}))));assert_eq!(attachment_bytes("gmail:test","id","message","inline:1").unwrap(),b"inline-file");
}
#[test]fn missing_corrupt_and_large_attachments_fail_without_importing(){
 MOCK_GET.with(|v|*v.borrow_mut()=Some(Err(error("404"))));assert_eq!(attachment_bytes("gmail:test","id","m","a").unwrap_err().code,"404");
 MOCK_GET.with(|v|*v.borrow_mut()=Some(Ok(json!({"data":"@@@"}))));assert!(attachment_bytes("gmail:test","id","m","a").is_err());
 MOCK_GET.with(|v|*v.borrow_mut()=Some(Ok(json!({"data":URL_SAFE_NO_PAD.encode(vec![0u8;30_000_001])}))));assert_eq!(attachment_bytes("gmail:test","id","m","a").unwrap_err().code,"attachment_too_large");
}
}
