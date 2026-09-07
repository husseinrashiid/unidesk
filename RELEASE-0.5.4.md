UniDesk 0.5.4 — in-app PDF viewing

Opening a registered PDF from any course file list, recent files, academic attachment, or Materials now displays its original pages inside UniDesk. Materials > Read document also opens the PDF viewer for PDFs. Non-PDF file behavior is preserved.

The viewer includes page navigation, page number entry, zoom, fit width, selectable text, highlighted text search, password entry, and Open externally. Scanned PDFs render as pages; text search requires a PDF text layer. Files larger than 150 MB use the external viewer option.

PDF.js and its worker, fonts, character maps, and image codecs are bundled locally. No online document service is used. Embedded PDF scripting and interactive annotations are not enabled. File bytes are read by registered file ID; the database and original files are preserved.

Validation: 69 automated tests, browser checks opening a PDF from Previous Exams and Materials with page navigation/search/zoom, and a Windows WebView check for native PDF bytes, rendering under the packaged security policy, navigation, search, and reopening.

Close UniDesk, run D:\App\UniDesk-Setup.exe, and select Do not uninstall if prompted. Your saved courses and documents remain intact.
