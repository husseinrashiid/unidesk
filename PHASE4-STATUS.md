# Phase 4 — UniDesk 0.4.2

All seven implementation checkpoints and the 17-item core completion target are implemented. Cloud-provider behavior has been verified with simulated responses, not a live OpenAI account. Configure an API key in Settings → AI to use new cloud generations.

## Where to use it

| Feature | Location |
| --- | --- |
| Local PDF/DOCX/PPTX/TXT/Markdown extraction and search | Course → Materials |
| Cited questions, selected files, summaries and study notes | Course → Ask; document file menu |
| Dates, deadlines, progress and grade-calculator routing | Ask UniDesk |
| Editable syllabus detection and selected import | Course → Syllabus |
| Original past questions and factual topic recurrence | Course → Previous Exams |
| Exam file selection | Exam → Materials |
| Selected cached emails, cited exam answers, guides and practice | Exam → Study guide & practice |
| Secure key, cloud on/off, model roles, source limit and token usage | Settings → AI |

## Completed behavior

- Existing local extraction and background indexing preserve provenance, original files, stale-index handling and offline search.
- The OpenAI provider uses Responses structured outputs with `store:false`. API keys use Windows Credential Manager, never SQLite. Fast and Balanced default to configurable `gpt-5-mini`; Advanced requires explicit configuration/selection. No cloud request occurs merely from opening a screen or file. API billing is separate from ChatGPT subscriptions.
- Ask Course retrieves bounded passages first, validates source IDs and exact supporting quotations, and resolves displayed filenames/locations from local metadata. Source-only mode defaults on; optional general explanation is separate. Conversations and generated results persist locally and can be copied, deleted or regenerated. Ask UniDesk routes supported structured questions directly to records and the existing grade calculator.
- Syllabus extraction uses one selected indexed PDF/DOCX in bounded batches. Course details, instructors, schedules, grading categories, exams/quizzes, assignments, policies and readings remain editable drafts. Missing dates/weights require review. Existing records are compared, repeated imports blocked, and stale updates roll back transactionally. Deleting an analysis keeps imported academic records.
- Past-exam analysis validates verbatim question text/citations, retains types and explicit years, and stores detected topic labels. Search and recurrence count distinct analyzed uploads, without predicting future exams.
- Exam scope uses attached files and explicitly selected cached course emails. Practice supports 5/10/20 questions, Mixed/MCQ/Short answer/Essay, difficulty and optional focus. Suggested answers stay hidden until revealed. Saved practice sets, cited guides, summaries and notes reopen offline. Indexed-source changes mark results stale.

## Data and privacy

Additive migrations 007–011 extend the existing database without recreating it. Existing Phase 3 upgrades retain the pre-document migration snapshot; version-6 installations receive a snapshot before AI migrations. Academic data, original files and Microsoft integration remain intact.

Requests include relevant excerpts and display names, never absolute Windows paths, course directories or unrelated mailbox contents. Questions/generation use 1–20 sources; native requests are limited to 100,000 input characters and 120 seconds. Structured extraction processes eight passages per request and refuses documents over 200 passages instead of silently skipping their remainder. Cancel discards the result and stops later batches; already-sent requests may finish and incur provider charges. Service failures preserve cached outputs and local search.

## Verification

- 60 Node tests passed: legacy migration/backup/reopen, existing academic/email/filesystem checks, source isolation, quotation validation, malformed practice outputs, missing syllabus dates/weights, stale/duplicate transaction protection, original question validation and distinct-upload recurrence.
- 21 Rust tests passed: native extraction, Microsoft authentication, isolated Windows Credential Manager, safe OpenAI errors and refusal/incomplete-response handling.
- Five existing Phase 1–4 browser suites passed. The new AI suite passed using simulated OpenAI responses with real local extraction/database operations: selected-file answers, source opening, no-evidence/fabricated-citation rejection, reviewed syllabus updates, question/topic browsing, exam guide/practice generation, answer reveal, cache reuse and offline reopening.
- Packaged Windows smoke passed with migration version 11, native PDF/DOCX/PPTX indexing, scaling, timer recovery and full-process restart persistence.
- Screenshots are in `.local/review/phase4-ask-course.png`, `phase4-syllabus-review.png`, `phase4-exam-practice.png`, and the existing light/dark search images.

## Practical limits

Live API-key validity, model access/quota, model output quality and generation latency remain unverified until an OpenAI API key is configured. Citation checks verify source identity and matching quotations, not the correctness of every model interpretation. Review original material for consequential academic decisions.

Summaries/guides cover retrieved or sampled excerpts, not guaranteed complete coverage of long books or every exam topic. Full syllabus/past-exam extraction is separately batched. Duplicate uploads can inflate recurrence counts. The local question router handles common academic intents rather than arbitrary natural-language SQL. Source buttons open originals in their default app; location labels identify pages/slides/sections. Practice answer boxes are session-only; generated questions, solutions and citations are saved.

Optional semantic embeddings, flashcards and streaming were not added. No OCR, recording transcription, audio processing, remote vector database, cloud file sync or hosted account system was introduced.

Implementation references: [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini).
