-- Recover the mappings saved before the sender-rule UI was retired.
-- Preserve existing instructor records, links and academic data.
INSERT OR IGNORE INTO professors(id,name,email)
SELECT 'legacy-email:' || lower(trim(r.sender_email)),
       CASE WHEN count(DISTINCT nullif(trim(c.professor),''))=1
            THEN max(nullif(trim(c.professor),'')) ELSE lower(trim(r.sender_email)) END,
       lower(trim(r.sender_email))
FROM email_sender_rules r JOIN courses c ON c.id=r.course_id
WHERE trim(r.sender_email)<>''
  AND NOT EXISTS(SELECT 1 FROM professors p WHERE lower(trim(p.email))=lower(trim(r.sender_email)))
GROUP BY lower(trim(r.sender_email));
INSERT OR IGNORE INTO course_professors(course_id,professor_id)
SELECT r.course_id,p.id FROM email_sender_rules r
JOIN courses c ON c.id=r.course_id
JOIN professors p ON lower(trim(p.email))=lower(trim(r.sender_email));
