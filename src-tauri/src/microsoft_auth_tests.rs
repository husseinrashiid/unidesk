use super::*;
use serde_json::json;
use std::collections::VecDeque;
const CLIENT:&str="11111111-2222-3333-4444-555555555555";
struct Mock {replies:VecDeque<Result<Reply,MailError>>,calls:Vec<(String,Vec<(String,String)>)>}
impl Mock {fn new(replies:Vec<Reply>)->Self{Self{replies:replies.into_iter().map(Ok).collect(),calls:Vec::new()}}}
impl Transport for Mock {
 fn post(&mut self,url:&str,form:&[(&str,&str)])->Result<Reply,MailError>{self.calls.push((url.into(),form.iter().map(|(k,v)|(k.to_string(),v.to_string())).collect()));self.replies.pop_front().unwrap()}
 fn get(&mut self,url:&str,access:&str)->Result<Reply,MailError>{self.calls.push((url.into(),vec![("bearer".into(),access.into())]));self.replies.pop_front().unwrap()}
}
fn reply(status:u16,body:Value)->Reply{Reply{status,body,retry_after:None}}
fn device()->Reply{reply(200,json!({"device_code":"internal-device-value","user_code":"ABCD-EFGH","verification_uri":VERIFY,"interval":5,"expires_in":900}))}
fn authorized()->Reply{reply(200,json!({"access_token":"test-access","refresh_token":"test-refresh","expires_in":3600}))}
#[test]fn invalid_client_ids_fail_before_any_request(){let mut mock=Mock::new(vec![]);for id in ["","not-a-client","00000000-0000-0000-0000-000000000000"]{assert_eq!(begin(&mut mock,id).err().unwrap().code,"invalid_client_id");}assert!(mock.calls.is_empty());}
#[test]fn device_request_is_multitenant_organizational_public_client_with_only_delegated_scopes(){
 let mut mock=Mock::new(vec![device()]);let grant=begin(&mut mock,CLIENT).unwrap();assert_eq!(grant.user_code,"ABCD-EFGH");assert_eq!(grant.verification_uri,VERIFY);assert_eq!(mock.calls[0].0,format!("{AUTH}/devicecode"));assert!(AUTH.contains("/organizations/"));let form=&mock.calls[0].1;assert_eq!(form.len(),2);assert_eq!(form[0],("client_id".into(),CLIENT.into()));assert_eq!(form[1].1,SCOPE);assert!(!SCOPE.contains("Write") && !SCOPE.contains("Send") && !SCOPE.contains(".default"));
}
#[test]fn successful_device_signin_confirms_the_university_profile_not_the_registration_owner(){
 let mut mock=Mock::new(vec![device(),authorized(),reply(200,json!({"id":"aub-user","mail":"student@mail.aub.edu","displayName":"University student"}))]);let grant=begin(&mut mock,CLIENT).unwrap();let Poll::Authorized{profile,tokens}=poll(&mut mock,&grant).unwrap()else{panic!()};assert_eq!(account_email(&profile).unwrap(),"student@mail.aub.edu");assert_eq!(tokens["refresh_token"],"test-refresh");assert!(mock.calls[1].0.contains("/organizations/oauth2/v2.0/token"));assert_eq!(mock.calls[1].1.len(),3);assert!(mock.calls[2].0.starts_with("https://graph.microsoft.com/v1.0/me?"));
}
#[test]fn pending_and_slow_down_are_protocol_states_not_failures(){let mut mock=Mock::new(vec![device(),reply(400,json!({"error":"authorization_pending"})),reply(400,json!({"error":"slow_down"}))]);let grant=begin(&mut mock,CLIENT).unwrap();assert!(matches!(poll(&mut mock,&grant).unwrap(),Poll::Pending));assert!(matches!(poll(&mut mock,&grant).unwrap(),Poll::SlowDown));}
#[test]fn expired_and_declined_codes_stop_cleanly(){for (code,kind) in [("expired_token","expired"),("authorization_declined","cancelled"),("access_denied","cancelled")]{let mut mock=Mock::new(vec![device(),reply(400,json!({"error":code}))]);let grant=begin(&mut mock,CLIENT).unwrap();assert_eq!(poll(&mut mock,&grant).err().unwrap().kind,kind);}}
#[test]fn admin_consent_errors_are_safe_and_actionable_without_raw_description_or_secrets(){
 for number in [65001,90094]{let error=MailError::http(400,&json!({"error":"invalid_grant","error_codes":[number],"error_description":"Need admin approval. SECRET-REFRESH user-private-data","refresh_token":"SECRET-REFRESH","access_token":"SECRET-ACCESS","correlation_id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}),None);assert_eq!(error.message,APPROVAL);assert_eq!(error.kind,"consent");let details=error.details();assert!(details.contains(&format!("AADSTS{number}")));assert!(!details.contains("SECRET") && !details.contains("user-private-data"));assert!(chrono::DateTime::parse_from_rfc3339(&error.timestamp).is_ok());}
 assert_eq!(MailError::http(403,&json!({"error":{"code":"ErrorAccessDenied","message":"secret"}}),None).message,APPROVAL);
 assert_eq!(MailError::http(400,&json!({"error":"invalid_grant","error_codes":[53003]}),None).kind,"consent");
}
#[test]fn refresh_uses_the_same_organizational_authority_without_secret_or_redirect(){let mut mock=Mock::new(vec![authorized()]);let result=refresh(&mut mock,CLIENT,"stored-test-refresh").unwrap();assert_eq!(result["access_token"],"test-access");assert_eq!(mock.calls[0].0,format!("{AUTH}/token"));assert_eq!(mock.calls[0].1.len(),4);assert!(mock.calls[0].1.iter().any(|(k,v)|k=="grant_type" && v=="refresh_token"));assert!(!mock.calls[0].1.iter().any(|(k,_)|k=="client_secret"||k=="redirect_uri"));}
#[test]fn revoked_refresh_can_be_followed_by_a_fresh_successful_device_flow(){let mut mock=Mock::new(vec![reply(400,json!({"error":"invalid_grant"})),device(),authorized(),reply(200,json!({"id":"aub-user","mail":"student@aub.edu.lb"}))]);assert_eq!(refresh(&mut mock,CLIENT,"revoked-test-token").err().unwrap().kind,"expired");let grant=begin(&mut mock,CLIENT).unwrap();assert!(matches!(poll(&mut mock,&grant).unwrap(),Poll::Authorized{..}));}
#[test]fn network_failures_and_invalid_registration_are_not_success(){let mut mock=Mock::new(vec![]);mock.replies.push_back(Err(MailError::network()));assert_eq!(begin(&mut mock,CLIENT).err().unwrap().kind,"network");let mut mock=Mock::new(vec![reply(400,json!({"error":"invalid_client","error_codes":[700016]}))]);assert_eq!(begin(&mut mock,CLIENT).err().unwrap().kind,"configuration");}
#[test]fn missing_tokens_are_rejected(){let mut mock=Mock::new(vec![device(),reply(200,json!({"access_token":"test-access"}))]);let grant=begin(&mut mock,CLIENT).unwrap();assert!(poll(&mut mock,&grant).is_err());}
#[test]fn response_address_variants_cannot_block_signin_or_control_the_browser_destination(){
 for uri in [VERIFY,"http://microsoft.com/devicelogin","https://www.microsoft.com/devicelogin/","https://aka.ms/devicelogin","https://microsoft.com/link","https://evil.example/","javascript:alert(1)",""] {
  let mut mock=Mock::new(vec![reply(200,json!({"device_code":"internal-test-code","user_code":"ABCD-EFGH","verification_uri":uri})),authorized(),reply(200,json!({"id":"aub-user","mail":"student@aub.edu.lb"}))]);
  let grant=begin(&mut mock,CLIENT).unwrap();assert_eq!(grant.verification_uri,VERIFY);assert_eq!(grant.user_code,"ABCD-EFGH");assert!(matches!(poll(&mut mock,&grant).unwrap(),Poll::Authorized{..}));
 }
}
