const ALLOWED_ORIGINS = new Set(['https://biantai11523.github.io','http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:4173']);
const encoder = new TextEncoder();
export function createWorker(validCityIds) {
  const validCities = new Set(validCityIds);
  return {
    async fetch(request, env) {
      const url = new URL(request.url), origin = request.headers.get('Origin');
      const allowed = ALLOWED_ORIGINS.has(origin) || origin === url.origin;
      const headers = { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Vary':'Origin', ...(allowed ? {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Max-Age':'86400'} : {}) };
      const json = (body, status = 200) => new Response(JSON.stringify(body),{status,headers});
      if(request.method==='OPTIONS')return new Response(null,{status:allowed?204:403,headers});
      if(url.pathname==='/health')return json({ok:true,app:'点亮共享地图'});
      try {
        if(!env.DB)return json({error:'共享数据服务尚未就绪'},503);
        if(url.pathname==='/api/state' && request.method==='GET') {
          const [visits,history] = await env.DB.batch([
            env.DB.prepare('SELECT * FROM visits'),
            env.DB.prepare('SELECT * FROM activity ORDER BY updated_at DESC, rowid DESC LIMIT 50')
          ]);
          return json({ records:Object.fromEntries(visits.results.map(row=>[row.city_id,toRecord(row)])),activity:history.results.map(row=>({cityId:row.city_id,operationId:row.operation_id,...toRecord(row)})),serverTime:new Date().toISOString() });
        }
        if(!allowed)return json({error:'请从点亮地图页面发起操作'},403);
        if(!env.SESSION_SECRET)return json({error:'共享服务尚未完成配置'},503);
        if(url.pathname==='/api/session' && request.method==='POST') {
          if(!await limit(env,request,'session',20))return json({error:'操作频繁，请一分钟后再试'},429);
          const payload=btoa(JSON.stringify({id:crypto.randomUUID(),expires:Date.now()+3600000}));
          return json({token:`${payload}.${await signature(payload,env.SESSION_SECRET)}`});
        }
        if(url.pathname==='/api/cities/batch' && request.method==='POST') {
          if(!await authenticated(request,env))return json({error:'会话已过期，请重试'},401);
          if(Number(request.headers.get('Content-Length') || 0)>524288)return json({error:'批量内容过长'},413);
          const raw=await request.text();if(raw.length>524288)return json({error:'批量内容过长'},413);
          let input;try{input=JSON.parse(raw);}catch{return json({error:'记录格式有误'},400);}
          const updates=input?.updates;
          if(!Array.isArray(updates)||!updates.length||updates.length>validCities.size)return json({error:'请选择有效的城市'},400);
          const ids=new Set(),operations=new Set();
          for(const update of updates){
            const error=validate(update);
            if(error)return json({error},400);
            if(typeof update.id!=='string'||!validCities.has(update.id))return json({error:'包含无效城市'},400);
            if(ids.has(update.id)||operations.has(update.operationId))return json({error:'城市或操作编号重复'},400);
            ids.add(update.id);operations.add(update.operationId);
          }
          if(!await limit(env,request,'write',60))return json({error:'操作频繁，请一分钟后再试'},429);
          return await saveBatch(env.DB,updates,json);
        }
        const match=url.pathname.match(/^\/api\/cities\/(\d{6})$/);
        if(match && request.method==='PUT') {
          if(!await authenticated(request,env))return json({error:'会话已过期，请重试'},401);
          if(!validCities.has(match[1]))return json({error:'找不到这个城市'},400);
          if(Number(request.headers.get('Content-Length') || 0)>4096)return json({error:'记录内容过长'},413);
          const raw=await request.text();if(raw.length>4096)return json({error:'记录内容过长'},413);
          let input;try{input=JSON.parse(raw);}catch{return json({error:'记录格式有误'},400);}
          const error=validate(input);if(error)return json({error},400);
          if(!await limit(env,request,'write',60))return json({error:'操作频繁，请一分钟后再试'},429);
          const cityId=match[1];
          const existing=await env.DB.prepare('SELECT * FROM activity WHERE operation_id = ?').bind(input.operationId).first();
          if(existing){
            if(existing.city_id!==cityId)return json({error:'操作编号已被使用'},409);
            const current=await env.DB.prepare('SELECT * FROM visits WHERE city_id = ?').bind(cityId).first();
            return json({record:toRecord(existing),current:toRecord(current),idempotent:true});
          }
          const now=new Date().toISOString();
          const author=input.author.trim(),note=input.note.trim();
          const result=await env.DB.batch([
            env.DB.prepare(`INSERT INTO visits (city_id,active,version,date,note,author,updated_at,last_operation)
              SELECT ?,?,1,?,?,?,?,? WHERE ? = 0
              ON CONFLICT(city_id) DO UPDATE SET active=excluded.active,version=visits.version+1,date=excluded.date,note=excluded.note,author=excluded.author,updated_at=excluded.updated_at,last_operation=excluded.last_operation
              WHERE visits.version = ? RETURNING *`).bind(cityId,input.active?1:0,input.date,note,author,now,input.operationId,input.expectedVersion,input.expectedVersion),
            env.DB.prepare(`UPDATE visits SET active=?,version=version+1,date=?,note=?,author=?,updated_at=?,last_operation=? WHERE city_id=? AND version=? AND last_operation<>? AND ? > 0 RETURNING *`).bind(input.active?1:0,input.date,note,author,now,input.operationId,cityId,input.expectedVersion,input.operationId,input.expectedVersion),
            env.DB.prepare(`INSERT OR IGNORE INTO activity (operation_id,city_id,active,version,date,note,author,updated_at) SELECT last_operation,city_id,active,version,date,note,author,updated_at FROM visits WHERE city_id=? AND last_operation=?`).bind(cityId,input.operationId)
          ]);
          const updated=result[0].results[0] || result[1].results[0];
          if(!updated){
            const current=await env.DB.prepare('SELECT * FROM visits WHERE city_id=?').bind(cityId).first();
            // A repeated request may race its first execution; retain idempotency after the atomic batch too.
            if(current?.last_operation===input.operationId)return json({record:toRecord(current),idempotent:true});
            return json({error:'这座城市刚被更新，请确认后再保存',current:current?toRecord(current):{version:0,active:false}},409);
          }
          return json({record:toRecord(updated)});
        }
        return json({error:'接口不存在'},404);
      }catch(error){
        console.error('Map API failed',error instanceof Error ? error.message : 'unknown');
        return json({error:'共享服务暂时不可用，请稍后重试'},503);
      }
    }
  };
}
function toRecord(row){return {active:!!row.active,version:row.version,date:row.date,note:row.note,author:row.author,updatedAt:row.updated_at};}
export function validate(input){
  if(!input || typeof input!=='object')return '记录格式有误';
  if(typeof input.active!=='boolean')return '点亮状态有误';
  if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)return '版本号有误';
  if(typeof input.operationId!=='string'||!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(input.operationId))return '操作编号有误';
  if(typeof input.author!=='string'||!input.author.trim()||input.author.length>24)return '称呼需要 1–24 个字';
  if(typeof input.note!=='string'||input.note.length>240)return '备注最多 240 个字';
  if(typeof input.date!=='string')return '日期格式有误';
  if(input.date){
    const day=new Date(`${input.date}T00:00:00.000Z`);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||Number.isNaN(day.getTime())||day.toISOString().slice(0,10)!==input.date||input.date<'1900-01-01'||day.getTime()>Date.now()+86400000)return '请填写有效的到访日期';
  }
  return null;
}
async function saveBatch(db,updates,json){
  const now=new Date().toISOString();
  const payload=JSON.stringify(updates.map(row=>({...row,active:row.active?1:0,author:row.author.trim(),note:row.note.trim(),updatedAt:now})));
  const currentQuery=()=>db.prepare("SELECT v.* FROM visits v JOIN json_each(?) r ON v.city_id=json_extract(r.value,'$.id')").bind(payload);
  const historyQuery=()=>db.prepare("SELECT a.* FROM activity a JOIN json_each(?) r ON a.operation_id=json_extract(r.value,'$.operationId')").bind(payload);
  const recordsFrom=rows=>Object.fromEntries(rows.map(row=>[row.city_id,toRecord(row)]));
  const reply=(rows,current,idempotent=false)=>json({records:recordsFrom(rows),current:recordsFrom(current),idempotent});
  const prior=(await historyQuery().all()).results;
  if(prior.length){
    const exact=prior.length===updates.length&&updates.every(row=>prior.some(p=>p.operation_id===row.operationId&&p.city_id===row.id));
    if(!exact)return json({error:'操作编号已被使用，请重新选择后保存'},400);
    return reply(prior,(await currentQuery().all()).results,true);
  }
  // Materialize the full input and its version check before inserting any row.
  // A stale version prevents the entire batch, including its history, from being written.
  const result=await db.batch([
    db.prepare(`WITH requested AS MATERIALIZED (
      SELECT json_extract(value,'$.id') AS city_id,json_extract(value,'$.active') AS active,
      json_extract(value,'$.expectedVersion') AS expected_version,json_extract(value,'$.date') AS date,
      json_extract(value,'$.note') AS note,json_extract(value,'$.author') AS author,
      json_extract(value,'$.updatedAt') AS updated_at,json_extract(value,'$.operationId') AS operation_id
      FROM json_each(?)
    ), permitted AS MATERIALIZED (
      SELECT 1 AS allowed WHERE NOT EXISTS (
        SELECT 1 FROM requested r LEFT JOIN visits v ON v.city_id=r.city_id
        WHERE coalesce(v.version,0)<>r.expected_version
      ) AND NOT EXISTS (SELECT 1 FROM requested r JOIN activity a ON a.operation_id=r.operation_id)
    )
    INSERT INTO visits (city_id,active,version,date,note,author,updated_at,last_operation)
    SELECT r.city_id,r.active,r.expected_version+1,r.date,r.note,r.author,r.updated_at,r.operation_id
    FROM requested r CROSS JOIN permitted p WHERE p.allowed=1
    ON CONFLICT(city_id) DO UPDATE SET active=excluded.active,version=excluded.version,date=excluded.date,
      note=excluded.note,author=excluded.author,updated_at=excluded.updated_at,last_operation=excluded.last_operation
    RETURNING *`).bind(payload),
    db.prepare(`INSERT OR IGNORE INTO activity (operation_id,city_id,active,version,date,note,author,updated_at)
      SELECT v.last_operation,v.city_id,v.active,v.version,v.date,v.note,v.author,v.updated_at
      FROM visits v JOIN json_each(?) r ON v.city_id=json_extract(r.value,'$.id')
      AND v.last_operation=json_extract(r.value,'$.operationId')`).bind(payload),
    currentQuery(),historyQuery()
  ]);
  const changed=result[0].results,current=result[2].results,history=result[3].results;
  if(changed.length===updates.length)return reply(changed,current);
  // Handle an identical retry that raced the first successful request.
  if(history.length===updates.length&&updates.every(row=>history.some(p=>p.operation_id===row.operationId&&p.city_id===row.id)))return reply(history,current,true);
  const currentRecords=recordsFrom(current);
  return json({error:'部分城市已有新修改，本批次未保存',current:currentRecords,
    conflicts:updates.filter(row=>(currentRecords[row.id]?.version||0)!==row.expectedVersion).map(row=>row.id)},409);
}
async function signature(payload,secret){
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(payload)))));
}
async function authenticated(request,env){
  try{
    const token=request.headers.get('Authorization')?.replace(/^Bearer /,'');if(!token)return false;
    const pieces=token.split('.');if(pieces.length!==2)return false;
    const [payload,mac]=pieces,parsed=JSON.parse(atob(payload));
    if(typeof parsed.expires!=='number'||parsed.expires<Date.now())return false;
    const key=await crypto.subtle.importKey('raw',encoder.encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);
    return await crypto.subtle.verify('HMAC',key,Uint8Array.from(atob(mac),c=>c.charCodeAt(0)),encoder.encode(payload));
  }catch{return false;}
}
async function limit(env,request,scope,max){
  const ip=request.headers.get('CF-Connecting-IP') || 'local';
  const digest=await crypto.subtle.digest('SHA-256',encoder.encode(`${env.SESSION_SECRET}:${ip}`));
  const id=`${scope}:${Array.from(new Uint8Array(digest)).slice(0,12).map(b=>b.toString(16).padStart(2,'0')).join('')}`;
  const bucket=Math.floor(Date.now()/60000);
  const row=await env.DB.prepare('INSERT INTO rate_limits (id,bucket,count) VALUES (?,?,1) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN rate_limits.bucket=excluded.bucket THEN rate_limits.count+1 ELSE 1 END,bucket=excluded.bucket RETURNING count').bind(id,bucket).first();
  return row.count<=max;
}
