// Validates the production RPC/RLS migration in disposable PostgreSQL, with
// minimal auth/storage schema stand-ins. This does not test GoTrue or Storage HTTP.
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const container=process.env.UNIDESK_TEST_POSTGRES_CONTAINER;
if(!container) throw Error('Set UNIDESK_TEST_POSTGRES_CONTAINER to a disposable PostgreSQL container');
const database=`unidesk_test_${Date.now()}`;
function run(args,input){const r=spawnSync('docker',['exec','-i',container,...args],{input,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr||r.error?.message||r.stdout);return r.stdout;}
run(['createdb','-U','postgres',database]);
const bootstrap=`
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $f$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT jsonb_build_object('session_id',nullif(current_setting('request.jwt.claim.session_id',true),'')) $f$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint);
CREATE TABLE storage.objects(bucket_id text,name text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $f$ SELECT string_to_array($1,'/') $f$;
GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT,INSERT ON storage.objects TO authenticated;
`;
const migrations=readdirSync('supabase/migrations').sort().map(f=>readFileSync(`supabase/migrations/${f}`,'utf8')).join('\n');
const checks=`
INSERT INTO auth.users VALUES('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
DO $$ DECLARE body jsonb; result jsonb; first_version bigint; BEGIN
 body:='{"protocol":1,"device":"device-00000000001","changes":[{"table":"synced_preferences","key":"[\\"week_start\\"]","payload":{"id":"week_start","value":"monday"},"base":0,"mutation":"device1:1"}]}';
 result:=public.unidesk_sync('push',body); first_version:=(result->'accepted'->0->>'version')::bigint;
 IF first_version IS NULL THEN RAISE EXCEPTION 'Push failed: %',result; END IF;
 IF public.unidesk_sync('push',body)<>result THEN RAISE EXCEPTION 'Replay differs'; END IF;
 body:=jsonb_set(body,'{changes,0,mutation}','"device1:2"');body:=jsonb_set(body,'{changes,0,payload,value}','"sunday"');
 IF jsonb_array_length(public.unidesk_sync('push',body)->'conflicts')<>1 THEN RAISE EXCEPTION 'Missing CAS conflict'; END IF;
 body:=jsonb_set(body,'{changes,0,base}',to_jsonb(first_version));body:=jsonb_set(body,'{changes,0,payload}','null');
 IF public.unidesk_sync('push',body)->'accepted'->0->'payload'<>'null'::jsonb THEN RAISE EXCEPTION 'Missing tombstone'; END IF;
 result:=public.unidesk_sync('pull','{"protocol":1,"device":"device-00000000002","cursor":0}');
 IF jsonb_array_length(result->'records')<>1 OR result->'records'->0->'payload'<>'null'::jsonb THEN RAISE EXCEPTION 'Pull failed'; END IF;
 BEGIN PERFORM public.unidesk_sync('push','{"protocol":1,"device":"device-00000000001","changes":[{"table":"synced_preferences","key":"[\\"api_key\\"]","payload":null,"base":0,"mutation":"bad"}]}');RAISE EXCEPTION 'Invalid preference accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Invalid preference accepted' THEN RAISE; END IF; END;
 BEGIN PERFORM public.unidesk_sync('push','{"device":"device-00000000001"}');RAISE EXCEPTION 'Invalid protocol accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Invalid protocol accepted' THEN RAISE; END IF; END;
 BEGIN INSERT INTO public.unidesk_records(owner,entity,record_key,version,origin_device_id) VALUES(auth.uid(),'synced_preferences','[]',42,'bad');RAISE EXCEPTION 'Direct writes allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.unidesk_records) THEN RAISE EXCEPTION 'RLS owner leak'; END IF;
 IF jsonb_array_length(public.unidesk_sync('pull','{"protocol":1,"device":"device-00000000003","cursor":0}')->'records')<>0 THEN RAISE EXCEPTION 'RPC owner leak'; END IF;
 BEGIN INSERT INTO storage.objects VALUES('unidesk-files','00000000-0000-4000-8000-000000000001/'||repeat('a',64));RAISE EXCEPTION 'Storage owner leak'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 INSERT INTO storage.objects VALUES('unidesk-files',auth.uid()::text||'/'||repeat('a',64));
END $$;
RESET ROLE;
SELECT 'Supabase migration, RPC replay/CAS/tombstones, owner RLS and storage policies passed' AS result;
`;
try { console.log(run(['psql','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1'],bootstrap+migrations+checks)); }
finally { run(['dropdb','-U','postgres',database]); }
