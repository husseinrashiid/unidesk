//! OpenAI boundary: fixed HTTPS origin, Windows vault, bounded input, no request logging.
use crate::Store;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};
use tauri::Manager;

static JOBS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
fn vault(action: &str, key: Option<&str>) -> Result<Option<String>, String> {
    if action == "save" {
        let value = key.unwrap_or("").trim();
        if !value.starts_with("sk-") || value.len() < 20 || value.len() > 4000 || value.chars().any(char::is_whitespace) { return Err("Enter a valid OpenAI API key.".into()); }
    }
    crate::device::secret("UniDesk/OpenAI/APIKey", action, key.map(str::trim))
}
#[tauri::command]
pub async fn ai_credentials(action: String, key: Option<String>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
    if !["status", "save", "remove"].contains(&action.as_str()) {
        return Err("Unknown AI setting.".into());
    }
    if action == "remove" {
        if let Ok(jobs) = JOBS.get_or_init(Default::default).lock() {
            for job in jobs.values() {
                job.store(true, Ordering::SeqCst);
            }
        }
    }
    vault(&action, key.as_deref())?;
    Ok(json!({"configured":vault("status",None)?.is_some()}))
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub fn ai_cancel(request_id: String) {
    if let Ok(jobs) = JOBS.get_or_init(Default::default).lock() {
        if let Some(job) = jobs.get(&request_id) {
            job.store(true, Ordering::SeqCst);
        }
    }
}
pub fn api_error(status: u16) -> String {
    match status{401|403=>"AI connection needs attention. Check the API key and model access in Settings → AI. Local search remains available.",429=>"AI request couldn't be completed because the configured API account currently cannot process more requests. Local search remains available.",400|404=>"This model could not process the request. Choose a model supporting Responses and structured outputs in AI settings.",_=>"Couldn't reach the AI service. Your files and indexed search are still available. Try again."}.into()
}
pub fn response_text(body: &Value) -> Result<String, String> {
    if body["status"] != "completed" {
        return Err("AI returned an incomplete answer. Try a smaller request; your previous results are kept.".into());
    }
    let text = body["output"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|item| item["content"].as_array().into_iter().flatten())
        .filter(|item| item["type"] == "output_text")
        .filter_map(|item| item["text"].as_str())
        .collect::<Vec<_>>()
        .join("");
    if text.is_empty() || text.len() > 250_000 {
        return Err(
            "AI did not return a usable structured answer. Previous results are kept.".into(),
        );
    }
    Ok(text)
}
#[tauri::command]
pub async fn ai_generate(
    app: tauri::AppHandle,
    request_id: String,
    model: String,
    instructions: String,
    input: String,
    schema: Value,
) -> Result<Value, String> {
    if request_id.len() > 80
        || model.is_empty()
        || model.len() > 100
        || !model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-._:".contains(c))
        || input.len() > 100_000
        || instructions.len() > 12_000
        || schema.to_string().len() > 30_000
    {
        return Err(
            "AI request exceeds the local safety limits. Reduce the selected material.".into(),
        );
    }
    {
        let store = app.state::<Store>();
        let db = store.db.lock().map_err(|_| "Workspace is busy.")?;
        let enabled: String = db
            .query_row(
                "SELECT value FROM settings WHERE key='ai_enabled'",
                [],
                |r| r.get(0),
            )
            .unwrap_or_default();
        if enabled != "true" {
            return Err(
                "Cloud AI is off. Enable it in Settings → AI. Local search remains available."
                    .into(),
            );
        }
    }
    let key = vault("status", None)?
        .ok_or("Add an OpenAI API key in Settings → AI. Local search remains available.")?;
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut jobs = JOBS
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| "AI is busy.")?;
        if !jobs.is_empty() {
            return Err(
                "Another AI request is still finishing. Please wait before retrying.".into(),
            );
        }
        jobs.insert(request_id.clone(), cancelled.clone());
    }
    let result=tauri::async_runtime::spawn_blocking(move||->Result<Value,String>{
  let client=reqwest::blocking::Client::builder().timeout(Duration::from_secs(120)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_|api_error(503))?;
  let response=client.post("https://api.openai.com/v1/responses").bearer_auth(key).json(&json!({"model":model,"instructions":instructions,"input":input,"store":false,"max_output_tokens":10000,"text":{"format":{"type":"json_schema","name":"unidesk_academic","strict":true,"schema":schema}}})).send().map_err(|_|api_error(503))?;
  if !response.status().is_success(){return Err(api_error(response.status().as_u16()));}
  let body:Value=response.json().map_err(|_|"AI returned unreadable data. Previous results are kept.")?;
  let store=app.state::<Store>();let db=store.db.lock().map_err(|_|"Workspace is busy.")?;
  let _=db.execute("INSERT INTO ai_usage(id,model,input_tokens,output_tokens) VALUES(?1,?2,?3,?4)",rusqlite::params![uuid::Uuid::new_v4().to_string(),model,body["usage"]["input_tokens"].as_i64().unwrap_or(0),body["usage"]["output_tokens"].as_i64().unwrap_or(0)]);
  if cancelled.load(Ordering::SeqCst){return Err("AI request cancelled. Its result was discarded; the provider may still charge for processing.".into());}
  Ok(json!({"text":response_text(&body)?,"model":model}))
 }).await.map_err(|_|"AI request stopped. Your files remain available.".to_string()).and_then(|r|r);
    if let Ok(mut jobs) = JOBS.get_or_init(Default::default).lock() {
        jobs.remove(&request_id);
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refusal_and_incomplete_do_not_become_answers() {
        assert!(response_text(&json!({"status":"incomplete"})).is_err());
        assert!(response_text(&json!({"status":"completed","output":[{"content":[{"type":"refusal","refusal":"no"}]}]})).is_err());
        assert_eq!(response_text(&json!({"status":"completed","output":[{"content":[{"type":"output_text","text":"{}"}]}]})).unwrap(),"{}");
    }
    #[test]
    fn service_errors_are_safe() {
        assert!(api_error(401).contains("Settings"));
        assert!(api_error(429).contains("Local search"));
    }
}
