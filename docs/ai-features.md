# AI features

UniDesk indexes your course documents locally and can optionally use a cloud model to answer questions about them. Extraction and search work fully offline; only the optional "Ask" features call out to a configured provider.

## Where to use it

| Feature | Location |
| --- | --- |
| Local PDF/DOCX/PPTX/TXT/Markdown extraction and search | Course → Materials |
| Cited questions over selected files, summaries, and study notes | Course → Ask; document file menu |
| Dates, deadlines, progress, and grade-calculator routing | Ask UniDesk |
| Editable syllabus detection and selective import | Course → Syllabus |
| Original past-exam questions and topic recurrence | Course → Previous Exams |
| Exam-scoped material selection | Exam → Materials |
| Cited exam answers, study guides, and practice questions | Exam → Study guide & practice |
| API key, cloud on/off, model roles, source limits, token usage | Settings → AI |

## How it works

- Local extraction and background indexing preserve provenance back to the original file; a stale index is detected and re-indexed rather than silently serving old results. Search works fully offline.
- The optional cloud provider (OpenAI) is used only when you explicitly ask a question or request generation — opening a screen or file never triggers a request. API keys are stored in Windows Credential Manager, never in SQLite.
- Ask Course retrieves a bounded set of passages first, validates source IDs and exact supporting quotations, and resolves the displayed filename/location from local metadata. Source-only mode is the default; broader general-knowledge explanation is a separate, explicit option. Conversations and results are saved locally and can be copied, deleted, or regenerated.
- Syllabus extraction works from one selected indexed document at a time. Detected course details, schedule, grading categories, exams, assignments, and readings stay as an editable draft — nothing is written until you review and confirm it, and repeated imports don't recreate already-imported records.
- Past-exam analysis validates verbatim question text and citations, and stores detected topic labels for recurrence search — it does not predict future exam content.
- Practice generation supports multiple question counts, formats, and difficulty; answers stay hidden until revealed, and saved sets reopen offline. Changing the indexed source material marks existing generated results as stale.

## Data and privacy

Requests include only relevant excerpts and display names — never absolute file paths, course directory structure, or unrelated mailbox contents. Generation requests are bounded (a limited number of sources per request, a character and time limit per request). Structured extraction processes documents in bounded batches and refuses documents that exceed its size limit rather than silently truncating them. Cancelling a request discards its result; a request already sent to the provider may still complete and be billed.

## Limits

Output quality, latency, and quota depend entirely on your own configured API key and provider account. Citation checks confirm that a quotation exists in the cited source, not that the model's interpretation is correct — review original material before acting on anything consequential. Summaries and guides cover retrieved or sampled excerpts, not a guaranteed-complete reading of a long document. There is no OCR, audio/recording transcription, or hosted account system — this stays a bring-your-own-key feature.
