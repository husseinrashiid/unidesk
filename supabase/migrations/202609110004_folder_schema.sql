INSERT INTO public.unidesk_entity_schema(entity,descriptor) VALUES
('file_folders','{"columns":["id","course_id","category","name","created_at"],"keys":["id"],"local":[],"foreign":[{"column":"course_id","table":"courses","to":"id"}]}'::jsonb);

UPDATE public.unidesk_entity_schema
SET descriptor = jsonb_set(
  jsonb_set(descriptor, '{columns}', (descriptor->'columns') || '["folder_id"]'::jsonb),
  '{foreign}', (descriptor->'foreign') || '[{"column":"folder_id","table":"file_folders","to":"id"}]'::jsonb
)
WHERE entity='files';
