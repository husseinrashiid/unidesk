#[path = "../src/document_extractor.rs"]
mod document_extractor;
fn main() {
    let result=std::env::args_os().nth(1).ok_or("Document path required.".to_string()).and_then(|p|document_extractor::extract_path(std::path::Path::new(&p)));
    match result {Ok(value)=>println!("{}",serde_json::to_string(&value).unwrap()),Err(error)=>{eprintln!("{error}");std::process::exit(1);}}
}
