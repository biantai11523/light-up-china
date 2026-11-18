const ORIGIN = import.meta.env.VITE_API_URL || 'https://light-up-china-shared-wtx.tingxuan9701.chatgpt.site';
let session = null;
async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const headers = { ...options.headers };
    if (options.body) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${ORIGIN}${path}`, {
      ...options, headers, credentials: 'omit', cache: 'no-store', signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const error = new Error(body?.error || '暂时连接不上，稍后再试');
      Object.assign(error, { status: response.status, current: body?.current, conflicts: body?.conflicts });
      throw error;
    }
    try { return await response.json(); }
    catch { throw new Error('共享服务的响应不完整'); }
  } finally {
    clearTimeout(timeout);
  }
}
const isMap = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isRecord = row => isMap(row) && typeof row.active === 'boolean' && typeof row.note === 'string'
  && typeof row.author === 'string' && Number.isSafeInteger(row.version) && row.version > 0;
const isLayer = rows => isMap(rows) && Object.values(rows).every(isRecord);
export async function getState() {
  const state = await request('/api/state');
  // Older deployments return just the joint records. An incomplete response must not replace the cache.
  const valid = state?.layers === undefined
    ? isLayer(state?.records) && Array.isArray(state.activity)
    : ['together', 'xuan', 'xi'].every(profile => isLayer(state.layers?.[profile])) && Array.isArray(state.activityAll);
  if (!valid) throw new Error('共享地图数据尚未完整返回');
  return state;
}
async function authorizedRequest(path,method,input) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!session) session = (await request('/api/session', { method: 'POST' })).token;
    try { return await request(path, { method, headers: { Authorization: `Bearer ${session}` }, body: JSON.stringify(input) }); }
    catch (error) { if (error.status === 401 && attempt === 0) session = null; else throw error; }
  }
}
const profilePath=profile=>profile==='together'?'/api':`/api/profiles/${profile}`;
export async function saveCity(id, input, profile = 'together') {
  const result = await authorizedRequest(`${profilePath(profile)}/cities/${id}`, 'PUT', input);
  if (!isRecord(result?.record) || result.current !== undefined && !isRecord(result.current)) {
    throw new Error('未收到完整的保存结果');
  }
  return result;
}
export async function saveCities(updates, profile = 'together') {
  const result = await authorizedRequest(`${profilePath(profile)}/cities/batch`, 'POST', { updates });
  if (!updates.every(({id}) => isRecord(result?.records?.[id]) && (result.current === undefined || isRecord(result.current?.[id])))) {
    throw new Error('未收到全部城市的保存结果');
  }
  return result;
}
