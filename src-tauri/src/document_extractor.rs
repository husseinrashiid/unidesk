//! Local, read-only extraction. No network, Office automation, macros, or OCR.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs::File, io::{Cursor, Read}, path::Path};

pub const MAX_FILE: u64 = 100 * 1024 * 1024;
const MAX_TEXT: usize = 20 * 1024 * 1024;
const MAX_XML: u64 = 16 * 1024 * 1024;
pub const EXTRACTOR_VERSION: &str = "local-3";
#[cfg(test)]
#[path = "document_extractor_tests.rs"]
mod tests;

#[derive(Clone, Debug, Serialize)]
pub struct Segment {
    pub cells: Option<Vec<String>>,
    pub text: String,
    pub page: Option<usize>,
    pub slide: Option<usize>,
    pub heading: Option<String>,
    pub line_start: Option<usize>,
    pub line_end: Option<usize>,
}
impl Segment {
    fn text(text: String) -> Self { Self { cells: None, text, page: None, slide: None, heading: None, line_start: None, line_end: None } }
}
#[derive(Debug, Serialize)]
pub struct Extraction {
    pub content_hash: String,
    pub extractor_version: &'static str,
    pub segments: Vec<Segment>,
    pub word_count: usize,
    pub page_count: Option<usize>,
    pub slide_count: Option<usize>,
    pub status: &'static str,
}
pub fn supported(extension: &str) -> bool { matches!(extension.to_ascii_lowercase().as_str(), "pdf"|"docx"|"pptx"|"txt"|"md"|"markdown") }

pub fn extract_path(path: &Path) -> Result<Extraction, String> {
    let ext = path.extension().and_then(|s|s.to_str()).unwrap_or("").to_ascii_lowercase();
    if !supported(&ext) { return Err("This file type does not support text extraction.".into()); }
    let file = File::open(path).map_err(|_|"The source file is missing or cannot be read. Open or locate the file and try again.")?;
    if !file.metadata().map_err(|_|"Cannot read file information.")?.is_file() { return Err("Choose a document file.".into()); }
    let mut bytes=Vec::new();
    file.take(MAX_FILE+1).read_to_end(&mut bytes).map_err(|_|"Could not read the document.")?;
    if bytes.len() as u64 > MAX_FILE { return Err("Indexing supports documents up to 100 MB. The original file is still available.".into()); }
    std::panic::catch_unwind(|| extract_bytes(&ext, &bytes)).unwrap_or_else(|_|Err("This document could not be parsed safely. The original file is unchanged.".into()))
}

pub fn extract_bytes(ext: &str, bytes: &[u8]) -> Result<Extraction, String> {
    let hash=format!("{:x}",Sha256::digest(bytes));
    let mut page_count=None;
    let mut slide_count=None;
    let segments=match ext {
        "pdf" => {
            let doc=pdf_extract::Document::load_mem(bytes).map_err(|_|"Cannot extract this PDF. It may be damaged or password-protected.")?;
            let pages=doc.get_pages();
            if pages.len()>5000 { return Err("This PDF exceeds the 5,000-page indexing limit.".into()); }
            page_count=Some(pages.len());
            let mut output=Vec::new(); let mut size=0;
            for page in pages.keys() {
                let mut text=String::new();
                // Geometry-aware output preserves line changes and spaces between table cells.
                // lopdf's Document::extract_text concatenates positioned PDF text runs.
                let mut device=pdf_extract::PlainTextOutput::new(&mut text);
                pdf_extract::output_doc_page(&doc,&mut device,*page).map_err(|_|"A PDF page could not be read. The document was not partially indexed.")?;
                size+=text.len(); if size>MAX_TEXT {return Err("Extracted text exceeds the 20 MB indexing limit.".into());}
                let mut s=Segment::text(text); s.page=Some(*page as usize); output.push(s);
            }
            output
        },
        "docx"|"pptx" => office(ext,bytes,&mut slide_count)?,
        "txt"|"md"|"markdown" => plain(&decode(bytes)?,ext!="txt"),
        _ => return Err("This file type does not support text extraction.".into()),
    };
    if segments.iter().map(|s|s.text.len()).sum::<usize>()>MAX_TEXT {return Err("Extracted text exceeds the 20 MB indexing limit.".into());}
    let segments:Vec<_>=segments.into_iter().filter(|s|!s.text.trim().is_empty()).collect();
    let word_count=segments.iter().map(|s|s.text.split_whitespace().count()).sum();
    Ok(Extraction { content_hash:hash,extractor_version:EXTRACTOR_VERSION, status:if segments.is_empty(){"Text unavailable"}else{"Extracted"}, segments,word_count,page_count,slide_count })
}
fn decode(bytes:&[u8])->Result<String,String> {
    if bytes.starts_with(&[0xff,0xfe]) || bytes.starts_with(&[0xfe,0xff]) {
        if bytes.len()%2!=0 {return Err("The document contains invalid UTF-16 text.".into());}
        let little=bytes[0]==0xff;
        let units:Vec<_>=bytes[2..].chunks_exact(2).map(|b|if little {u16::from_le_bytes([b[0],b[1]])} else {u16::from_be_bytes([b[0],b[1]])}).collect();
        return String::from_utf16(&units).map_err(|_|"The document contains invalid UTF-16 text.".into());
    }
    let text=std::str::from_utf8(bytes).map_err(|_|"Save this text document as UTF-8 or UTF-16, then re-index it.")?;
    if text.contains('\0') {return Err("The file contains binary data rather than readable text.".into());}
    Ok(text.trim_start_matches('\u{feff}').into())
}
fn plain(text:&str,markdown:bool)->Vec<Segment> {
    let lines:Vec<_>=text.lines().collect(); let mut result=Vec::new(); let mut start=0; let mut heading=None;
    while start<lines.len() {
        if markdown && lines[start].starts_with('#') { heading=Some(lines[start].trim_start_matches('#').trim().to_string()); }
        let mut end=(start+40).min(lines.len());
        if markdown { if let Some(next)=(start+1..end).find(|i|lines[*i].starts_with('#')) {end=next;} }
        let mut s=Segment::text(lines[start..end].join("\n"));s.heading=heading.clone();s.line_start=Some(start+1);s.line_end=Some(end);result.push(s);start=end;
    }
    result
}
fn xml_entry(zip:&mut zip::ZipArchive<Cursor<&[u8]>>,name:&str)->Result<String,String> {
    let file=zip.by_name(name).map_err(|_|"The Office document is missing a required part.")?;
    if file.size()>MAX_XML {return Err("An Office document part exceeds the 16 MB extraction limit.".into());}
    let mut data=Vec::new();file.take(MAX_XML+1).read_to_end(&mut data).map_err(|_|"The Office document could not be decompressed.")?;
    if data.len() as u64>MAX_XML {return Err("The Office document part is too large.".into());}
    decode(&data)
}
fn paragraphs(xml:&str,docx:bool)->Result<Vec<(String,bool)>,String> {
    let doc=roxmltree::Document::parse(xml).map_err(|_|"The Office document contains invalid XML.")?;
    let mut out=Vec::new();
    for p in doc.descendants().filter(|n|n.is_element() && n.tag_name().name()=="p") {
        let mut text=String::new();
        for n in p.descendants().filter(|n|n.is_element()) {
            if n.ancestors().any(|a|a.is_element() && matches!(a.tag_name().name(),"del"|"moveFrom")) {continue;}
            match n.tag_name().name() {"t"=>text.push_str(n.text().unwrap_or("")),"tab"=>text.push('\t'),"br"|"cr"=>text.push('\n'),_=>{}}
        }
        let heading=docx && p.descendants().any(|n|n.is_element() && ((n.tag_name().name()=="pStyle" && n.attributes().any(|a|a.name()=="val" && (a.value().to_ascii_lowercase().starts_with("heading") || a.value()=="Title"))) || n.tag_name().name()=="outlineLvl"));
        if !text.trim().is_empty(){out.push((text,heading));}
    }
    Ok(out)
}
fn office(ext:&str,bytes:&[u8],slide_count:&mut Option<usize>)->Result<Vec<Segment>,String> {
    let mut zip=zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_|"Cannot read this Office document. It may be damaged or password-protected.")?;
    if zip.len()>20000 {return Err("This Office archive has too many parts.".into());}
    if ext=="docx" {
        let xml=xml_entry(&mut zip,"word/document.xml")?;
        let mut heading=None; let mut result=Vec::new();
        let doc=roxmltree::Document::parse(&xml).map_err(|_|"The Office document contains invalid XML.")?;
        for node in doc.descendants().filter(|n| n.is_element() && ((n.tag_name().name()=="p" && !n.ancestors().any(|a|a.is_element() && a.tag_name().name()=="tbl")) || n.tag_name().name()=="tr")) {
            if node.tag_name().name()=="tr" {
                let cells:Vec<String>=node.children().filter(|n|n.is_element() && n.tag_name().name()=="tc").map(|cell| {
                    cell.descendants().filter(|n|n.is_element() && n.tag_name().name()=="p").map(|p| {
                        p.descendants().filter(|n|n.is_element() && n.tag_name().name()=="t" && !n.ancestors().any(|a|a.is_element() && matches!(a.tag_name().name(),"del"|"moveFrom"))).filter_map(|n|n.text()).collect::<Vec<_>>().join("")
                    }).collect::<Vec<_>>().join("\n")
                }).collect();
                let mut segment=Segment::text(cells.join("\t"));segment.cells=Some(cells);segment.heading=heading.clone();result.push(segment);
            } else {
                let text=node.descendants().filter(|n|n.is_element() && n.tag_name().name()=="t" && !n.ancestors().any(|a|a.is_element() && matches!(a.tag_name().name(),"del"|"moveFrom"))).filter_map(|n|n.text()).collect::<Vec<_>>().join("");
                let is_heading=node.descendants().any(|n|n.is_element() && ((n.tag_name().name()=="pStyle" && n.attributes().any(|a|a.name()=="val" && (a.value().to_ascii_lowercase().starts_with("heading") || a.value()=="Title"))) || n.tag_name().name()=="outlineLvl"));
                if is_heading {heading=Some(text.clone());} let mut segment=Segment::text(text);segment.heading=heading.clone();result.push(segment);
            }
        }
        return Ok(result);
    }
    // Presentation relationship order, not slide filenames, defines visible slide numbers.
    let manifest=xml_entry(&mut zip,"ppt/presentation.xml")?;
    let rels=xml_entry(&mut zip,"ppt/_rels/presentation.xml.rels")?;
    let doc=roxmltree::Document::parse(&manifest).map_err(|_|"Invalid presentation order.")?;
    let rel_doc=roxmltree::Document::parse(&rels).map_err(|_|"Invalid presentation relationships.")?;
    let mut result=Vec::new(); let mut count=0; let mut size=0;
    for slide in doc.descendants().filter(|n|n.is_element() && n.tag_name().name()=="sldId") {
        count+=1; if count>5000 {return Err("This presentation exceeds the 5,000-slide indexing limit.".into());}
        let id=slide.attributes().find(|a|a.name()=="id" && a.namespace().is_some()).map(|a|a.value()).ok_or("Missing slide relationship.")?;
        let rel=rel_doc.descendants().find(|n|n.attribute("Id")==Some(id)).ok_or("Missing slide relationship.")?;
        if rel.attribute("TargetMode")==Some("External"){return Err("External slide references are not indexed.".into());}
        let target=rel.attribute("Target").ok_or("Missing slide file.")?;
        let name=if target.starts_with("/ppt/"){target[1..].to_string()}else{format!("ppt/{target}")};
        if name.split('/').any(|s|s=="..") || name.contains('\\') {return Err("Invalid slide path.".into());}
        let xml=xml_entry(&mut zip,&name)?;
        let text=paragraphs(&xml,false)?.into_iter().map(|p|p.0).collect::<Vec<_>>().join("\n");
        size+=text.len(); if size>MAX_TEXT{return Err("Extracted text exceeds the 20 MB indexing limit.".into());}
        let mut s=Segment::text(text);s.slide=Some(count);result.push(s);
    }
    *slide_count=Some(count);Ok(result)
}
