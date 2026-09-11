import { createServer, type IncomingMessage } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { syncSchema, validateRecord, type Change, type RemoteRecord } from '../src/features/sync/protocol';

const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
export function createSyncService(directory: string, accounts: Record<string,string>) {
  fs.mkdirSync(directory, {recursive:true});
  const db = new DatabaseSync(path.join(directory,'sync.db'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS records(account TEXT,entity TEXT,key TEXT,payload TEXT,version INTEGER,PRIMARY KEY(account,entity,key));
    CREATE TABLE IF NOT EXISTS revisions(version INTEGER PRIMARY KEY AUTOINCREMENT,account TEXT,entity TEXT,key TEXT,payload TEXT,device TEXT,mutation TEXT,UNIQUE(account,device,mutation));
    CREATE TABLE IF NOT EXISTS devices(account TEXT,id TEXT,name TEXT,seen TEXT,PRIMARY KEY(account,id));`);
  function authenticate(req: IncomingMessage) {
    const token = /^Bearer ([A-Za-z0-9_-]{32,200})$/.exec(req.headers.authorization ?? '')?.[1];
    if (!token) throw Error('Unauthorized');
    const digest = Buffer.from(hash(token),'hex');
    for (const [stored,account] of Object.entries(accounts)) {
      if (/^[a-f0-9]{64}$/.test(stored) && timingSafeEqual(Buffer.from(stored,'hex'),digest)) return account;
    }
    throw Error('Unauthorized');
  }
  async function body(req: IncomingMessage, max: number) {
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of req) { size+=chunk.length; if(size>max) throw Error('Request too large'); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  const remote = (r: Record<string, unknown>): RemoteRecord => ({table:String(r.entity),key:String(r.key),payload:r.payload===null?null:JSON.parse(String(r.payload)),version:Number(r.version)});
  const server = createServer(async (req,res) => {
    try {
      const account = authenticate(req);
      const blobDir = path.join(directory,'blobs',hash(account));
      const blob = /^\/v1\/blobs\/([a-f0-9]{64})$/.exec(req.url ?? '');
      if (blob) {
        const filename = path.join(blobDir,blob[1]);
        if (req.method==='POST') {
          const bytes = await body(req,100_000_000);
          if(hash(bytes)!==blob[1]) throw Error('Content hash mismatch');
          fs.mkdirSync(blobDir,{recursive:true});
          const temp = filename+'.'+randomBytes(8).toString('hex')+'.tmp';
          fs.writeFileSync(temp,bytes,{flag:'wx'});
          try { fs.renameSync(temp,filename); } catch(error) { fs.unlinkSync(temp); if(!fs.existsSync(filename)) throw error; }
          res.writeHead(200,{'Content-Type':'application/json'}); res.end('{}'); return;
        }
        if((req.method==='GET'||req.method==='HEAD') && fs.existsSync(filename)) {
          res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':fs.statSync(filename).size});
          if(req.method==='HEAD') res.end(); else fs.createReadStream(filename).pipe(res); return;
        }
        res.writeHead(404);res.end();return;
      }
      if(req.method!=='POST') throw Error('Unsupported request');
      const input = JSON.parse((await body(req,32_000_000)).toString('utf8'));
      if(input.protocol!==1) throw Error('Unsupported sync protocol');
      if(typeof input.device!=='string' || !/^[a-zA-Z0-9-]{16,80}$/.test(input.device)) throw Error('Invalid device');
      db.prepare("INSERT INTO devices VALUES(?,?,?,datetime('now')) ON CONFLICT(account,id) DO UPDATE SET name=excluded.name,seen=excluded.seen").run(account,input.device,String(input.name??'UniDesk').slice(0,100));
      let result: unknown;
      if(req.url==='/v1/info') result={workspace:hash(account),protocol:1,devices:db.prepare('SELECT id,name,seen FROM devices WHERE account=?').all(account)};
      else if(req.url==='/v1/push') {
        const changes = input.changes as Change[];
        if(!Array.isArray(changes) || changes.length>10000) throw Error('Invalid changes');
        const seen=new Set<string>();
        for(const c of changes) {
          validateRecord(c.table,c.key,c.payload);
          if(!Number.isSafeInteger(c.base)||c.base<0||typeof c.mutation!=='string'||c.mutation.length>1200) throw Error('Invalid version');
          const id=JSON.stringify([c.table,c.key]); if(seen.has(id)) throw Error('Duplicate record'); seen.add(id);

        }
        db.exec('BEGIN IMMEDIATE');
        try {
          for (const c of changes) if(c.payload && !db.prepare('SELECT 1 FROM revisions WHERE account=? AND device=? AND mutation=?').get(account,input.device,c.mutation) && Number(db.prepare('SELECT version FROM records WHERE account=? AND entity=? AND key=?').get(account,c.table,c.key)?.version??0)===c.base) for(const relation of syncSchema[c.table].foreign) {
            const value=c.payload[relation.column];if(value===null||value===undefined) continue;
            const parentKey=JSON.stringify([value]);
            const changedParent=changes.find(p=>p.table===relation.table&&p.key===parentKey);
            const parent=changedParent ? changedParent.payload : db.prepare('SELECT payload FROM records WHERE account=? AND entity=? AND key=?').get(account,relation.table,parentKey)?.payload;
            if(!parent) throw Error('A related record is missing or was deleted on another device. Restore its parent or remove the pending child before syncing.');
          }
          const conflicts: RemoteRecord[]=[]; const accepted: RemoteRecord[]=[];
          for(const c of changes) {
            const replay=db.prepare('SELECT * FROM revisions WHERE account=? AND device=? AND mutation=?').get(account,input.device,c.mutation);
            if(replay) {
              if(replay.entity!==c.table || replay.key!==c.key || replay.payload!==(c.payload===null?null:JSON.stringify(c.payload))) throw Error('Mutation identity reused');
              accepted.push(remote(replay));continue;
            }
            const current=db.prepare('SELECT * FROM records WHERE account=? AND entity=? AND key=?').get(account,c.table,c.key);
            if(Number(current?.version??0)!==c.base) { if(current) conflicts.push(remote(current)); else throw Error('Invalid base version'); }
          }
          if(!conflicts.length) for(const c of changes) {
            if(accepted.some(r=>r.table===c.table&&r.key===c.key)) continue;
            const payload=c.payload===null?null:JSON.stringify(c.payload);
            const version=Number(db.prepare('INSERT INTO revisions(account,entity,key,payload,device,mutation) VALUES(?,?,?,?,?,?)').run(account,c.table,c.key,payload,input.device,c.mutation).lastInsertRowid);
            db.prepare('INSERT INTO records VALUES(?,?,?,?,?) ON CONFLICT(account,entity,key) DO UPDATE SET payload=excluded.payload,version=excluded.version').run(account,c.table,c.key,payload,version);
            accepted.push({table:c.table,key:c.key,payload:c.payload,version});
          }
          db.exec('COMMIT'); result={accepted:conflicts.length?[]:accepted,conflicts};
        } catch(error) { db.exec('ROLLBACK');throw error; }
      } else if(req.url==='/v1/pull') {
        if(!Number.isSafeInteger(input.cursor)||input.cursor<0) throw Error('Invalid cursor');
        const cursor=Number(db.prepare('SELECT COALESCE(MAX(version),0) AS cursor FROM records WHERE account=?').get(account)?.cursor);
        if(input.cursor>cursor) throw Error('Server history changed; restore the server backup before syncing');
        const records=db.prepare('SELECT * FROM records WHERE account=? AND version>? ORDER BY version').all(account,input.cursor).map(remote);
        result={records,cursor};
      } else throw Error('Unknown endpoint');
      const encoded=JSON.stringify(result);
      if(Buffer.byteLength(encoded)>32_000_000) throw Error('Sync response exceeds the 32 MB limit');
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(encoded);
    } catch(error) {
      const message=error instanceof Error?error.message:'Sync failed';
      res.writeHead(message==='Unauthorized'?401:400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:message}));
    }
  });
  server.requestTimeout=120_000;
  server.on('close',()=>db.close());
  return server;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const accountFile=process.env.UNIDESK_SYNC_ACCOUNTS;
  if(!accountFile) throw Error('Set UNIDESK_SYNC_ACCOUNTS to a JSON file mapping SHA-256 token hashes to workspace IDs. See SYNC.md.');
  const accounts=JSON.parse(fs.readFileSync(accountFile,'utf8')) as Record<string,string>;
  createSyncService(path.resolve(process.env.UNIDESK_SYNC_DATA??'.local/sync-server'),accounts)
    .listen(Number(process.env.PORT??8787),process.env.HOST??'127.0.0.1',()=>console.log('UniDesk sync service listening'));
}
