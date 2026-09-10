import { randomBytes,createHash } from 'node:crypto';
import { readFileSync,writeFileSync,existsSync } from 'node:fs';
const [file,workspace]=process.argv.slice(2);
if(!file||!workspace) throw Error('Usage: node scripts/sync-account.mjs <accounts.json> <workspace-id>');
const accounts=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};
const token=randomBytes(32).toString('base64url');
accounts[createHash('sha256').update(token).digest('hex')]=workspace;
writeFileSync(file,JSON.stringify(accounts,null,2)+'\n',{mode:0o600});
// Provisioning is explicitly run by the server administrator. Never log tokens in the service.
console.log(`Account token (shown once): ${token}`);
