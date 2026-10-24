import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type Difficulty = 'easy' | 'medium' | 'hard';
type QuestRow = {id:string; title:string; difficulty:Difficulty; due_date:string|null; recurrence:string|null; ordinal:number};
type CompletionRow = {id:string; quest_id:string; day:string; base_xp:number; created_at:string; ordinal:number; undone:number};
const xpFor: Record<Difficulty,number> = { easy:10, medium:25, hard:50 };
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
function validDate(s:string) { if(!datePattern.test(s)) return false; const d = new Date(s+'T00:00:00Z'); return !isNaN(d.valueOf()) && d.toISOString().slice(0,10)===s; }
function validTimeZone(s:string) { try {new Intl.DateTimeFormat('en-US',{timeZone:s}); return true;}catch{return false;} }
function localDay(now:Date, tz:string) {return new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(now).replace(/^(\d{2})\/(\d{2})\/(\d{4})$/,'$3-$1-$2');}
function dayDiff(a:string,b:string) {return Math.round((Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000);}
function cleanQuest(q:QuestRow, done:boolean){return {id:q.id,title:q.title,difficulty:q.difficulty,due_date:q.due_date,recurrence:q.recurrence,done};}
function cleanCompletion(c:CompletionRow){return {id:c.id,quest_id:c.quest_id,day:c.day,base_xp:c.base_xp,created_at:c.created_at};}
export function buildApp(dbPath=process.env.DB_PATH || resolve('data','habits.sqlite')) {
  mkdirSync(dirname(dbPath), {recursive:true});
  const db=new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1),timezone TEXT NOT NULL);
    INSERT OR IGNORE INTO settings(id,timezone) VALUES(1,'Europe/Bucharest');
    CREATE TABLE IF NOT EXISTS quests(id TEXT PRIMARY KEY,title TEXT NOT NULL,difficulty TEXT NOT NULL,due_date TEXT,recurrence TEXT,ordinal INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS completions(id TEXT PRIMARY KEY,quest_id TEXT NOT NULL,day TEXT NOT NULL,base_xp INTEGER NOT NULL,created_at TEXT NOT NULL,ordinal INTEGER NOT NULL,undone INTEGER NOT NULL DEFAULT 0);
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_daily ON completions(quest_id,day) WHERE undone=0;
    CREATE TABLE IF NOT EXISTS counters(name TEXT PRIMARY KEY,value INTEGER NOT NULL);`);
  const app=Fastify({logger:false});
  app.addHook('onClose',async()=>{db.close();});
  app.addHook('onRequest',async(req)=>{const header=req.headers['x-now']; if(header!==undefined && (typeof header!=='string'||!timestampPattern.test(header)||Number.isNaN(Date.parse(header)))){throw Object.assign(new Error('invalid X-Now'),{statusCode:400});}});
  app.setErrorHandler((error: unknown, _req, reply) => {
    const statusCode = typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Internal server error';
    reply.code(statusCode).send({ error: message });
  });
  app.addHook('onSend',async(_req,reply,payload)=>{reply.header('access-control-allow-origin','*');reply.header('access-control-allow-methods','GET,POST,PUT,DELETE,OPTIONS');reply.header('access-control-allow-headers','content-type,x-now');return payload;});
  app.options('/*',(_req,reply)=>reply.code(204).send());
  const tz=()=> (db.prepare('SELECT timezone FROM settings WHERE id=1').get() as {timezone:string}).timezone;
  const now=(headers:Record<string,unknown>)=>new Date(typeof headers['x-now']==='string'?headers['x-now']:Date.now());
  const allCompletions=()=> db.prepare('SELECT * FROM completions WHERE undone=0 ORDER BY ordinal ASC').all() as CompletionRow[];
  function me(time:Date){
    const items=allCompletions(); const days=[...new Set(items.map(c=>c.day))].sort(); let sum=items.reduce((n,c)=>n+c.base_xp,0); let run=0,previous:string|undefined;const lengths=new Map<string,number>();
    for(const day of days){run=(previous&&dayDiff(day,previous)===1)?run+1:1;lengths.set(day,run);sum+=2*Math.min(run,7);previous=day;}
    const today=localDay(time,tz()); const streak= previous && (dayDiff(today,previous)===0||dayDiff(today,previous)===1) ? lengths.get(previous)! : 0;
    let level=1,threshold=100,remaining=sum; while(remaining>=threshold){remaining-=threshold;level++;threshold=level*100;}
    return {timezone:tz(),xp:sum,level,xp_into_level:remaining,xp_to_next_level:threshold-remaining,streak};
  }
  function done(q:QuestRow,day:string){const row=db.prepare('SELECT id FROM completions WHERE quest_id=? AND undone=0 AND (? IS NULL OR day=?) LIMIT 1').get(q.id,q.recurrence,day);return !!row;}
  function nextId(table:string,prefix:string){const key=table;const found=db.prepare('SELECT value FROM counters WHERE name=?').get(key) as {value:number}|undefined; const n=(found?.value||0)+1;db.prepare('INSERT INTO counters(name,value) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value').run(key,n);return prefix+n;}
  app.get('/me',(req)=>me(now(req.headers)));
  app.put('/me',(req,reply)=>{const body=req.body as Record<string,unknown>|null; if(!body||typeof body.timezone!=='string'||!validTimeZone(body.timezone)){return reply.code(400).send({error:'invalid timezone'});}db.prepare('UPDATE settings SET timezone=? WHERE id=1').run(body.timezone);return me(now(req.headers));});
  app.post('/quests',(req,reply)=>{const b=req.body as Record<string,unknown>|null;
    if(!b||typeof b.title!=='string'||b.title.length<1||b.title.length>100) return reply.code(400).send({error:'invalid title'});
    if(typeof b.difficulty!=='string'||!(b.difficulty in xpFor))return reply.code(400).send({error:'invalid difficulty'});
    if(b.due_date!=null&&b.recurrence!=null)return reply.code(400).send({error:'a quest cannot have both due_date and recurrence'});
    if(b.due_date!=null&&(typeof b.due_date!=='string'||!validDate(b.due_date)))return reply.code(400).send({error:'invalid due_date'});
    if(b.recurrence!=null&&b.recurrence!=='daily')return reply.code(400).send({error:'invalid recurrence'});
    const q:QuestRow={id:nextId('quests','q'),title:b.title,difficulty:b.difficulty as Difficulty,due_date:typeof b.due_date==='string'?b.due_date:null,recurrence:b.recurrence==='daily'?'daily':null,ordinal:(db.prepare('SELECT COALESCE(MAX(ordinal),0)+1 AS n FROM quests').get() as {n:number}).n};
    db.prepare('INSERT INTO quests(id,title,difficulty,due_date,recurrence,ordinal) VALUES(?,?,?,?,?,?)').run(q.id,q.title,q.difficulty,q.due_date,q.recurrence,q.ordinal);
    return reply.code(201).send(cleanQuest(q,false));
  });
  app.get('/quests',(req)=>{const day=localDay(now(req.headers),tz());return (db.prepare('SELECT * FROM quests ORDER BY ordinal DESC').all() as QuestRow[]).map(q=>cleanQuest(q,done(q,day)));});
  app.get('/completions',()=> (db.prepare('SELECT * FROM completions WHERE undone=0 ORDER BY ordinal DESC').all() as CompletionRow[]).map(cleanCompletion));
  app.post<{Params:{id:string}}>('/quests/:id/complete',(req,reply)=>{
    const q=db.prepare('SELECT * FROM quests WHERE id=?').get(req.params.id) as QuestRow|undefined;if(!q)return reply.code(404).send({error:'quest not found'});
    const time=now(req.headers); const day=localDay(time,tz());
    const previous=db.prepare('SELECT * FROM completions WHERE quest_id=? AND undone=0 AND (? IS NULL OR day=?) ORDER BY ordinal LIMIT 1').get(q.id,q.recurrence,day) as CompletionRow|undefined;
    if(previous)return reply.code(200).send({completion:cleanCompletion(previous),me:me(time)});
    const points=xpFor[q.difficulty];const base=q.due_date&&day>q.due_date?Math.floor(points/2):points;
    const newC:CompletionRow={id:nextId('completions','c'),quest_id:q.id,day,base_xp:base,created_at:time.toISOString().replace('.000Z','Z'),ordinal:(db.prepare('SELECT COALESCE(MAX(ordinal),0)+1 AS n FROM completions').get() as {n:number}).n,undone:0};
    db.prepare('INSERT INTO completions(id,quest_id,day,base_xp,created_at,ordinal,undone) VALUES(?,?,?,?,?,?,0)').run(newC.id,newC.quest_id,newC.day,newC.base_xp,newC.created_at,newC.ordinal);
    return reply.code(201).send({completion:cleanCompletion(newC),me:me(time)});
  });
  app.delete<{Params:{id:string}}>('/completions/:id',(req,reply)=>{const out=db.prepare('UPDATE completions SET undone=1 WHERE id=? AND undone=0').run(req.params.id);if(out.changes===0)return reply.code(404).send({error:'completion not found'});return reply.code(204).send();});
  app.post('/test/reset',(_req,reply)=>{db.exec("DELETE FROM completions;DELETE FROM quests;DELETE FROM counters;UPDATE settings SET timezone='Europe/Bucharest' WHERE id=1;");return reply.code(204).send();});
  return app;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const app=buildApp();app.listen({port:Number(process.env.PORT||3001),host:'0.0.0.0'}).then(()=>console.log('API listening on port '+(process.env.PORT||3001))).catch(e=>{console.error(e);process.exit(1)});}
