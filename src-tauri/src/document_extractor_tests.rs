use super::*;
use std::io::Write;
fn office_fixture(parts:&[(&str,&str)])->Vec<u8> {
    let mut zip=zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name,text) in parts {zip.start_file(*name,zip::write::SimpleFileOptions::default()).unwrap();zip.write_all(text.as_bytes()).unwrap();}
    zip.finish().unwrap().into_inner()
}
fn pdf_fixture(texts:&[&str])->Vec<u8> {
    let mut objects=vec!["<< /Type /Catalog /Pages 2 0 R >>".to_string(),format!("<< /Type /Pages /Count {} /Kids [{}] >>",texts.len(),(0..texts.len()).map(|i|format!("{} 0 R",4+i*2)).collect::<Vec<_>>().join(" ")),"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".into()];
    for (i,text) in texts.iter().enumerate(){objects.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {} 0 R >>",5+i*2));let stream=format!("BT /F1 12 Tf 50 700 Td ({text}) Tj ET");objects.push(format!("<< /Length {} >>\nstream\n{}\nendstream",stream.len(),stream));}
    let mut result="%PDF-1.4\n".to_string();let mut offsets=Vec::new();
    for (i,o) in objects.iter().enumerate(){offsets.push(result.len());result.push_str(&format!("{} 0 obj\n{}\nendobj\n",i+1,o));}
    let xref=result.len();result.push_str(&format!("xref\n0 {}\n0000000000 65535 f \n",objects.len()+1));for offset in offsets{result.push_str(&format!("{offset:010} 00000 n \n"));}
    result.push_str(&format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF",objects.len()+1));result.into_bytes()
}
#[test] fn pdf_pages_have_exact_provenance_and_empty_pages_keep_their_numbers(){
    let e=extract_bytes("pdf",&pdf_fixture(&["Ethical egoism", "", "Cultural relativism"])).unwrap();
    assert_eq!(e.page_count,Some(3));assert_eq!(e.segments.len(),2);assert_eq!(e.segments[1].page,Some(3));assert!(e.segments[1].text.contains("Cultural relativism"));
    assert_eq!(extract_bytes("pdf",&pdf_fixture(&[""])).unwrap().status,"Text unavailable");
}
#[test] fn pdf_positioned_rows_preserve_parser_line_boundaries(){
    // Separate Tj operators with a vertical move, as produced by real PDF tables.
    let e=extract_bytes("pdf",&pdf_fixture(&["Program: Example) Tj 0 -18 Td (Degree: Bachelor) Tj 0 -18 Td (Credits: 120"])).unwrap();
    let lines=e.segments[0].text.lines().map(str::trim).filter(|s|!s.is_empty()).collect::<Vec<_>>();
    assert_eq!(lines,vec!["Program: Example","Degree: Bachelor","Credits: 120"]);
}
#[test] fn docx_preserves_headings_tables_unicode_and_xml_entities(){
    let bytes=office_fixture(&[("word/document.xml",r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Objections</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Truth &amp; culture — أخلاق</w:t></w:r><w:del><w:r><w:delText>Deleted text</w:delText></w:r></w:del></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#)]);
    let e=extract_bytes("docx",&bytes).unwrap();assert_eq!(e.segments[1].heading.as_deref(),Some("Objections"));assert_eq!(e.segments[1].text,"Truth & culture — أخلاق");assert_eq!(e.page_count,None);
}
#[test] fn pptx_uses_presentation_order_and_retains_empty_slide_numbers(){
    let bytes=office_fixture(&[("ppt/presentation.xml",r#"<p:presentation xmlns:p="urn:p" xmlns:r="urn:r"><p:sldIdLst><p:sldId id="7" r:id="second"/><p:sldId id="8" r:id="first"/></p:sldIdLst></p:presentation>"#),("ppt/_rels/presentation.xml.rels",r#"<Relationships><Relationship Id="first" Target="slides/slide1.xml"/><Relationship Id="second" Target="slides/slide7.xml"/></Relationships>"#),("ppt/slides/slide7.xml",r#"<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>Actual first slide</a:t></a:r></a:p></p:sld>"#),("ppt/slides/slide1.xml",r#"<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:p><a:r><a:t>Actual second slide</a:t></a:r></a:p></p:sld>"#)]);
    let e=extract_bytes("pptx",&bytes).unwrap();assert_eq!(e.slide_count,Some(2));assert_eq!(e.segments[0].text,"Actual first slide");assert_eq!(e.segments[1].slide,Some(2));
}
#[test] fn plain_text_headings_lines_encodings_and_hashes(){
    let e=extract_bytes("md","# Ethics\nA café\n## Questions\nWhy?".as_bytes()).unwrap();assert_eq!(e.segments[1].heading.as_deref(),Some("Questions"));assert_eq!(e.segments[1].line_start,Some(3));assert_eq!(e.segments[1].line_end,Some(4));
    let mut utf16=vec![255,254];for u in "مرحبا".encode_utf16(){utf16.extend(u.to_le_bytes());}assert_eq!(extract_bytes("txt",&utf16).unwrap().segments[0].text,"مرحبا");
    assert_ne!(e.content_hash,extract_bytes("txt",b"changed").unwrap().content_hash);assert_eq!(extract_bytes("txt",b"").unwrap().status,"Text unavailable");
}
#[test] fn unsupported_corrupt_binary_and_dtd_are_errors(){
    assert!(extract_bytes("mp3",b"audio").is_err());assert!(extract_bytes("pdf",b"broken").is_err());assert!(extract_bytes("docx",b"broken").is_err());assert!(extract_bytes("txt",b"\0binary").is_err());
    assert!(paragraphs("<!DOCTYPE foo [<!ENTITY x 'external'>]><foo><p>&x;</p></foo>",true).is_err());
}
#[test] fn extraction_does_not_modify_source(){
    let folder=std::env::temp_dir().join(format!("unidesk-extract-{}",uuid::Uuid::new_v4()));std::fs::create_dir(&folder).unwrap();let path=folder.join("source.pdf");let bytes=pdf_fixture(&["Read only source"]);std::fs::write(&path,&bytes).unwrap();extract_path(&path).unwrap();assert_eq!(std::fs::read(&path).unwrap(),bytes);std::fs::remove_file(&path).unwrap();std::fs::remove_dir(&folder).unwrap();
}
