//! Organizational public-client protocol. The registration's home tenant is never an authority.
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;
pub const AUTH: &str="https://login.microsoftonline.com/organizations/oauth2/v2.0";
pub const GRAPH: &str="https://graph.microsoft.com/v1.0";
pub const SCOPE: &str="offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read";
pub const VERIFY: &str="https://microsoft.com/devicelogin";
pub const APPROVAL: &str="Your university requires administrator approval for direct Microsoft 365 mailbox access. You can instead forward your university emails to Gmail and connect that mailbox to UniDesk.";

#[derive(Clone,Debug,Serialize,serde::Deserialize)]
pub struct MailError {pub code:String,pub kind:String,pub message:String,pub timestamp:String,pub correlation_id:Option<String>,pub http_status:Option<u16>}
impl MailError {
 pub fn new(code:&str,kind:&str,message:&str)->Self{Self{code:code.into(),kind:kind.into(),message:message.into(),timestamp:chrono::Utc::now().to_rfc3339(),correlation_id:None,http_status:None}}
 pub fn network()->Self{Self::new("network_unavailable","network","Could not reach Microsoft. Check your connection and retry; cached email remains available.")}
 pub fn details(&self)->String{format!("Timestamp: {}\nError code: {}\nDescription: {}\nAuthority: organizations\nHTTP status: {}\nCorrelation ID: {}",self.timestamp,self.code,self.message,self.http_status.map(|s|s.to_string()).unwrap_or_else(||"Not available".into()),self.correlation_id.as_deref().unwrap_or("Not available"))}
 pub fn http(status:u16,body:&Value,retry:Option<u64>)->Self{
  let oauth=body["error"].as_str().or(body["error"]["code"].as_str()).unwrap_or("");
  let mut numbers:Vec<u64>=body["error_codes"].as_array().map(|a|a.iter().filter_map(Value::as_u64).filter(|n|*n<1_000_000_000).take(3).collect()).unwrap_or_default();
  if numbers.is_empty(){numbers=body["error_description"].as_str().unwrap_or("").split("AADSTS").skip(1).take(3).filter_map(|s|s.chars().take_while(|c|c.is_ascii_digit()).take(9).collect::<String>().parse().ok()).collect();}
  let has=|codes:&[u64]|numbers.iter().any(|n|codes.contains(n));
  let mut e=if has(&[65001,90094,65004,650052,650057]) || matches!(oauth,"consent_required"|"admin_consent_required") || status==403 {
   Self::new("consent_required","consent",APPROVAL)
  }else if has(&[53000,53001,53002,53003,53004]){
   Self::new("organization_policy","consent","Your university's sign-in policy blocked this request. Contact university IT for approval.")
  }else if matches!(oauth,"expired_token"|"bad_verification_code"){
   Self::new(oauth,"expired","Sign-in code expired or is no longer valid. Retry to get a new code.")
  }else if matches!(oauth,"authorization_declined"|"access_denied"){
   Self::new(oauth,"cancelled","Microsoft sign-in was cancelled or declined. Retry when you are ready.")
  }else if has(&[50194]){
   Self::new("application_not_multitenant","configuration","This registration must support accounts in any organizational directory. Check its supported account types in Microsoft Entra.")
  }else if matches!(oauth,"invalid_client"|"unauthorized_client"|"invalid_scope") || has(&[700016,7000218]){
   Self::new("application_configuration","configuration","Check the Microsoft 365 Client ID, multitenant account support, delegated permissions, and Allow public client flows. UniDesk does not use a client secret.")
  }else if matches!(oauth,"invalid_grant"|"interaction_required"|"login_required") || status==401{
   Self::new("reconnect_required","expired","Microsoft sign-in expired or was revoked. Reconnect your university account; cached email remains available.")
  }else if status==429{
   Self::new("rate_limited","rate_limit",&format!("Microsoft is limiting requests. Retry after {} seconds.",retry.unwrap_or(60).clamp(1,86400)))
  }else if status==410{
   Self::new("sync_cursor_expired","sync","The sync cursor expired. Use Reset sync in Email settings.")
  }else{Self::new("microsoft_request_failed","provider","Microsoft could not complete the request. Retry; cached email remains available.")};
  // Only numeric service codes and a validated correlation UUID are copied. Never copy raw descriptions/JSON.
  if !numbers.is_empty(){e.code=numbers.iter().map(|n|format!("AADSTS{n}")).collect::<Vec<_>>().join(", ");}
  else if matches!(oauth,"invalid_client"|"unauthorized_client"|"invalid_scope"|"invalid_grant"|"interaction_required"|"login_required"|"consent_required"|"admin_consent_required"|"access_denied"|"authorization_declined"|"expired_token"|"bad_verification_code"){e.code=oauth.into();}
  e.correlation_id=body["correlation_id"].as_str().and_then(|s|uuid::Uuid::parse_str(s).ok()).map(|u|u.to_string());e.http_status=Some(status);e
 }
}
impl From<&str> for MailError {fn from(s:&str)->Self{Self::new("local_operation","local",s)}}
impl From<String> for MailError {fn from(s:String)->Self{Self::from(s.as_str())}}
impl std::fmt::Display for MailError {fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result{write!(f,"{}",self.message)}}
impl std::error::Error for MailError {}
pub struct Reply {pub status:u16,pub body:Value,pub retry_after:Option<u64>}
pub trait Transport {
 fn post(&mut self,url:&str,form:&[(&str,&str)])->Result<Reply,MailError>;
 fn get(&mut self,url:&str,access:&str)->Result<Reply,MailError>;
}
pub struct MicrosoftTransport(reqwest::blocking::Client);
impl MicrosoftTransport {pub fn new()->Result<Self,MailError>{Ok(Self(reqwest::blocking::Client::builder().timeout(Duration::from_secs(35)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_|MailError::network())?))}}
pub fn decode_response(response:reqwest::blocking::Response)->Result<Reply,MailError>{
 let status=response.status().as_u16();let retry_after=response.headers().get("retry-after").and_then(|h|h.to_str().ok()).and_then(|s|s.parse().ok());
 let body=match response.json(){Ok(body)=>body,Err(_) if !(200..300).contains(&status)=>return Err(MailError::http(status,&Value::Null,retry_after)),Err(_)=>return Err(MailError::new("invalid_response","provider","Microsoft returned an unreadable response. Please retry."))};
 Ok(Reply{status,body,retry_after})
}
impl Transport for MicrosoftTransport {
 fn post(&mut self,url:&str,form:&[(&str,&str)])->Result<Reply,MailError>{decode_response(self.0.post(url).form(form).send().map_err(|_|MailError::network())?)}
 fn get(&mut self,url:&str,access:&str)->Result<Reply,MailError>{decode_response(self.0.get(url).bearer_auth(access).send().map_err(|_|MailError::network())?)}
}
pub fn success(reply:Reply)->Result<Value,MailError>{if !(200..300).contains(&reply.status) || !reply.body["error"].is_null(){Err(MailError::http(reply.status,&reply.body,reply.retry_after))}else{Ok(reply.body)}}
pub fn validate_id(id:&str)->Result<(),MailError>{uuid::Uuid::parse_str(id).ok().filter(|id|!id.is_nil()).map(|_|()).ok_or_else(||MailError::new("invalid_client_id","configuration","Enter the Application (client) ID from Microsoft Entra in UUID format."))}
fn required<'a>(v:&'a Value,key:&str)->Result<&'a str,MailError>{v[key].as_str().filter(|s|!s.trim().is_empty()).ok_or_else(||MailError::new("incomplete_response","provider","Microsoft returned incomplete sign-in data. Please retry."))}
#[derive(Clone)]
pub struct Grant {pub client:String,pub device_code:String,pub user_code:String,pub verification_uri:String,pub expires_in:u64,pub interval:u64}
pub fn begin(transport:&mut impl Transport,id:&str)->Result<Grant,MailError>{
 validate_id(id)?;
 let data=success(transport.post(&format!("{AUTH}/devicecode"),&[("client_id",id),("scope",SCOPE)])?)?;
 // This provider uses Microsoft's global organizational endpoint exclusively.
 // Always display/open its documented HTTPS device-login page. Response aliases
 // (including older HTTP spellings) must neither block sign-in nor control a
 // browser destination. Never follow verification_uri supplied in the response.
 Ok(Grant{client:id.into(),device_code:required(&data,"device_code")?.into(),user_code:required(&data,"user_code")?.into(),verification_uri:VERIFY.into(),expires_in:data["expires_in"].as_u64().unwrap_or(900).clamp(1,3600),interval:data["interval"].as_u64().unwrap_or(5).clamp(5,300)})
}
pub enum Poll {Pending,SlowDown,Authorized{tokens:Value,profile:Value}}
pub fn poll(transport:&mut impl Transport,grant:&Grant)->Result<Poll,MailError>{
 let reply=transport.post(&format!("{AUTH}/token"),&[("client_id",&grant.client),("grant_type","urn:ietf:params:oauth:grant-type:device_code"),("device_code",&grant.device_code)])?;
 match reply.body["error"].as_str(){Some("authorization_pending")=>return Ok(Poll::Pending),Some("slow_down")=>return Ok(Poll::SlowDown),_=>{}}
 let tokens=success(reply)?;let access=required(&tokens,"access_token")?;required(&tokens,"refresh_token")?;
 let profile=success(transport.get(&format!("{GRAPH}/me?$select=id,mail,userPrincipalName,displayName"),access)?)?;
 account_email(&profile)?;required(&profile,"id")?;
 Ok(Poll::Authorized{tokens,profile})
}
pub fn account_email(profile:&Value)->Result<&str,MailError>{profile["mail"].as_str().filter(|s|!s.trim().is_empty()).or(profile["userPrincipalName"].as_str().filter(|s|!s.trim().is_empty())).ok_or_else(||MailError::new("missing_mailbox","provider","Microsoft did not return a mailbox address. Sign in with your university account."))}
pub fn refresh(transport:&mut impl Transport,id:&str,refresh:&str)->Result<Value,MailError>{
 validate_id(id)?;
 let result=success(transport.post(&format!("{AUTH}/token"),&[("client_id",id),("grant_type","refresh_token"),("refresh_token",refresh),("scope",SCOPE)])?)?;required(&result,"access_token")?;Ok(result)
}
#[cfg(test)]
#[path="microsoft_auth_tests.rs"]
mod tests;
