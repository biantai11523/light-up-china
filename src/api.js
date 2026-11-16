const ORIGIN = import.meta.env.VITE_API_URL || 'https://light-up-china-shared-wtx.tingxuan9701.chatgpt.site';
let session = null;
async function request(path, options = {}) {
  const response = await fetch(`${ORIGIN}${path}`, { ...options, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', ...options.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(body.error || '暂时连接不上，稍后再试'); error.status = response.status; error.current = body.current; error.conflicts = body.conflicts; throw error; }
  return body;
}
export function getState() { return request('/api/state'); }
async function authorizedRequest(path,method,input) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!session) session = (await request('/api/session', { method: 'POST' })).token;
    try { return await request(path, { method, headers: { Authorization: `Bearer ${session}` }, body: JSON.stringify(input) }); }
    catch (error) { if (error.status === 401 && attempt === 0) session = null; else throw error; }
  }
}
export function saveCity(id,input){return authorizedRequest(`/api/cities/${id}`,'PUT',input);}
export function saveCities(updates){return authorizedRequest('/api/cities/batch','POST',{updates});}
