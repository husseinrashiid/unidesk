// The CLI's generated test credentials stay in memory and child environment only.
import {spawnSync} from 'node:child_process';
const cli=process.env.SUPABASE_CLI??'supabase';
const result=spawnSync(cli,['status','--workdir',process.env.SUPABASE_WORKDIR??'.local/supabase-runtime','--output','json'],{encoding:'utf8'});
if(result.status!==0)throw Error('Start the local Supabase stack first');
const status=JSON.parse(result.stdout);
const run=spawnSync(process.execPath,['--import','tsx','--test','tests/supabase.integration.ts'],{stdio:'inherit',env:{...process.env,SUPABASE_URL:status.API_URL,SUPABASE_ANON_KEY:status.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:status.SERVICE_ROLE_KEY}});
process.exit(run.status??1);
