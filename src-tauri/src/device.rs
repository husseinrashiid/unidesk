use serde_json::{json, Value};
#[cfg(target_os = "android")]
static MOBILE: std::sync::OnceLock<tauri::plugin::PluginHandle<tauri::Wry>> = std::sync::OnceLock::new();

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("unidesk-device").setup(|_app, _api| {
        #[cfg(target_os = "android")]
        MOBILE.set(_api.register_android_plugin("local.unidesk.app", "DevicePlugin")?).map_err(|_| "Device integration already initialized")?;
        Ok(())
    }).build()
}

#[cfg(target_os = "android")]
pub fn mobile(action: &str, args: Value) -> Result<Value, String> {
    MOBILE.get().ok_or("Device integration is unavailable")?.run_mobile_plugin(action, args).map_err(|e| e.to_string())
}

// Exact Windows target names preserve existing sign-ins across the upgrade.
fn platform_secret(name: &str, action: &str, value: Option<&str>) -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Security::Credentials::*;
        let mut target: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        unsafe {
            if action == "remove" {
                if CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) == 0 && windows_sys::Win32::Foundation::GetLastError() != 1168 { return Err("Could not remove the stored credential".into()); }
                return Ok(None);
            }
            if action == "save" {
                let mut bytes = value.ok_or("Missing credential")?.as_bytes().to_vec();
                if bytes.len() > CRED_MAX_CREDENTIAL_BLOB_SIZE as usize { return Err("Credential exceeds the device storage limit".into()); }
                let mut cred: CREDENTIALW = std::mem::zeroed();
                cred.Type = CRED_TYPE_GENERIC; cred.TargetName = target.as_mut_ptr();
                cred.CredentialBlobSize = bytes.len() as u32; cred.CredentialBlob = bytes.as_mut_ptr();
                cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
                let saved = CredWriteW(&cred, 0); bytes.fill(0);
                if saved == 0 { return Err("Could not save the credential securely".into()); }
                return Ok(None);
            }
            let mut ptr = std::ptr::null_mut();
            if CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut ptr) == 0 {
                if windows_sys::Win32::Foundation::GetLastError() == 1168 { return Ok(None); }
                return Err("Could not read the stored credential".into());
            }
            let result = String::from_utf8(std::slice::from_raw_parts((*ptr).CredentialBlob, (*ptr).CredentialBlobSize as usize).to_vec()).map_err(|_| "Stored credential is unreadable".to_string());
            CredFree(ptr.cast()); return result.map(Some);
        }
    }
    #[cfg(target_os = "android")]
    { return Ok(mobile("secret", json!({"name":name,"action":action,"value":value}))?["value"].as_str().map(String::from)); }
    #[cfg(not(any(windows, target_os = "android")))]
    { let _ = (name,action,value); Err("Secure storage is not available on this platform".into()) }
}

pub fn open_path(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "android")]
    { mobile("openFile", json!({"path":path.to_string_lossy(),"share":false}))?; Ok(()) }
    #[cfg(not(target_os = "android"))]
    { open::that(path).map_err(|e|e.to_string()) }
}
pub fn share_path(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "android")]
    { mobile("openFile", json!({"path":path.to_string_lossy(),"share":true}))?; Ok(()) }
    #[cfg(not(target_os = "android"))]
    { let _=path; Err("Sharing is not supported on this platform".into()) }
}
pub fn export_path(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "android")]
    { mobile("exportFile", json!({"path":path.to_string_lossy()}))?; Ok(()) }
    #[cfg(not(target_os = "android"))]
    { let _=path; Err("Export picker is not supported on this platform".into()) }
}
pub fn open_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "android")]
    { mobile("openUrl", json!({"url":url}))?; Ok(()) }
    #[cfg(not(target_os = "android"))]
    { open::that(url).map_err(|e|e.to_string()) }
}

#[tauri::command]
pub async fn pick_documents(multiple: Option<bool>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "android")]
        { serde_json::from_value(mobile("pickDocuments", json!({"multiple":multiple.unwrap_or(true)}))?["sources"].clone()).map_err(|_| "Could not read selected documents".into()) }
        #[cfg(not(target_os = "android"))]
        { let _ = multiple; Err("Document provider selection is only available on Android".into()) }
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn stage_document(source: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "android")]
        { mobile("stageDocument", json!({"source":source}))?["path"].as_str().map(String::from).ok_or("Document could not be imported".into()) }
        #[cfg(not(target_os = "android"))]
        { Ok(source) }
    }).await.map_err(|e| e.to_string())?
}

/// Shared native boundary: callers never write credentials to the app database.
pub trait SecureStorage {
    fn get(&self, name:&str)->Result<Option<String>,String>;
    fn set(&self, name:&str, value:&str)->Result<(),String>;
    fn remove(&self, name:&str)->Result<(),String>;
}
pub struct NativeSecureStorage;
impl SecureStorage for NativeSecureStorage {
    fn get(&self,name:&str)->Result<Option<String>,String>{platform_secret(name,"read",None)}
    fn set(&self,name:&str,value:&str)->Result<(),String>{platform_secret(name,"save",Some(value)).map(|_|())}
    fn remove(&self,name:&str)->Result<(),String>{platform_secret(name,"remove",None).map(|_|())}
}
pub fn secret(name:&str,action:&str,value:Option<&str>)->Result<Option<String>,String>{
    #[cfg(debug_assertions)] let scoped=std::env::var("UNIDESK_TEST_VAULT_PREFIX").ok().filter(|prefix|prefix.starts_with("UniDesk/Test/")).map(|prefix|format!("{prefix}/{name}"));
    #[cfg(debug_assertions)] let name=scoped.as_deref().unwrap_or(name);
    match action { "read"=>NativeSecureStorage.get(name), "save"=>NativeSecureStorage.set(name,value.ok_or("Missing secret")?).map(|_|None), "remove"=>NativeSecureStorage.remove(name).map(|_|None), _=>Err("Unknown secure storage action".into()) }
}
