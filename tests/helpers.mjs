import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createWorker } from '../server/worker.js';
export function fixture() {
  const db=new DatabaseSync(':memory:');
  for(const file of readdirSync('server/migrations').filter(f=>f.endsWith('.sql')))db.exec(readFileSync(`server/migrations/${file}`,'utf8'));
  class Statement{
    constructor(sql,params=[]){this.sql=sql;this.params=params;}
    bind(...params){return new Statement(this.sql,params);}
    async first(){return db.prepare(this.sql).get(...this.params) || null;}
    async all(){return {results:db.prepare(this.sql).all(...this.params)};}
  }
  const DB={prepare(sql){return new Statement(sql);},async batch(statements){db.exec('BEGIN');try{const results=[];for(const s of statements)results.push({results:db.prepare(s.sql).all(...s.params)});db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}};
  const map=JSON.parse(readFileSync('public/data/china.json','utf8'));
  const worker=createWorker(map.cities.map(c=>c.id));
  const env={DB,SESSION_SECRET:'local-test-only-secret-not-for-production'};
  const origin='https://biantai11523.github.io';
  const request=(path,options={})=>worker.fetch(new Request(`https://api.test${path}`,{...options,headers:{Origin:origin,'Content-Type':'application/json',...options.headers}}),env);
  const session=async()=>{const r=await request('/api/session',{method:'POST'});return (await r.json()).token;};
  const write=(token,id,input)=>request(`/api/cities/${id}`,{method:'PUT',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(input)});
  return {db,DB,worker,env,request,session,write,map};
}
export function input(overrides={}){return {active:true,expectedVersion:0,operationId:crypto.randomUUID(),date:'2025-05-01',note:'西湖边的日落',author:'测试旅人',...overrides};}
