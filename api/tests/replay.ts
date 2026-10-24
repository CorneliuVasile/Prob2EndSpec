import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {buildApp} from '../src/server.js';
const reference=readFileSync(resolve('tests/reference_recording.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));
const app=buildApp(':memory:');
const oldToNew=new Map<string,string>();let passed=0;
function normalize(value:any):any{
 if(Array.isArray(value))return value.map(normalize);
 if(value&&typeof value==='object'){return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,(k==='id'||k==='quest_id')&&typeof v==='string'?(oldToNew.get(v)||v):normalize(v)]));}
 return value;
}
try{
 for(let i=0;i<reference.length;i++){
  const row=reference[i];const path=row.path.replace(/\b(q\d+|c\d+)\b/g,(m:string)=>oldToNew.get(m)||m);
  const response=await app.inject({method:row.method,url:path,headers:{'x-now':row.x_now},...(row.body?{payload:row.body}:{})});
  const actual=response.statusCode===204?undefined:response.json();
  if(row.status!==response.statusCode)throw new Error(`line ${i+1}: status expected ${row.status}, got ${response.statusCode}`);
  const associate=(expected:any,got:any)=>{
    if(!expected||!got||typeof expected!=='object'||typeof got!=='object')return;
    if(typeof expected.id==='string'&&typeof got.id==='string')oldToNew.set(expected.id,got.id);
    if(Array.isArray(expected)&&Array.isArray(got))expected.forEach((e,j)=>associate(e,got[j]));
    else for(const key of Object.keys(expected)) associate(expected[key],got[key]);
  };
  associate(row.response,actual);
  const expected=normalize(row.response);
  if(JSON.stringify(expected)!==JSON.stringify(actual))throw new Error(`line ${i+1} ${row.method} ${row.path}\nexpected ${JSON.stringify(expected)}\ngot      ${JSON.stringify(actual)}`);
  passed++;
 }
 console.log(`PASS: ${passed}/${reference.length} recorded HTTP interactions matched`);
}finally{await app.close();}
