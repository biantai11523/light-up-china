import './style.css';
import { icon } from './icons.js';
import { createMap } from './map.js';
import { getState, saveCity } from './api.js';
import { readLocal, writeLocal, escapeHtml as e, summarize, normalizeRecord } from './store.js';
import { createMapSnapshot, renderMapPng, downloadFile } from './export.js';

const app = document.querySelector('#app');
const cache = readLocal('dianliang-cache-v1', { records: {}, activity: [] });
let records = cache.records || {}, activity = cache.activity || [], data, map;
let selectedId = null, connected = false, syncing = false, saving = false, demo = false, modalCleanup = null, lastFocus = null, toastTimer, lastSync = 0, writeEpoch = 0;
let lockedScroll = null;
const cityById = new Map();
const baseUrl = () => `${location.origin}${location.pathname}`;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const dateText = value => value ? new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/', '.') : '刚刚';
const nickname = () => readLocal('dianliang-nickname', '访客');
const scrollBehavior = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
const scrollToMap = () => document.querySelector('.map-card').scrollIntoView({ behavior: scrollBehavior(), block: 'start' });

app.innerHTML = `<div class="shell">
  <header class="topbar"><a class="brand" href="./" aria-label="点亮首页"><span class="brand-mark">${icon('spark')}</span><div><div class="brand-word">点亮地图</div></div></a><nav class="top-actions" aria-label="主导航"><button class="top-link active" data-action="home">地图</button><button class="top-link" data-action="activity">已点亮</button><button class="btn" data-action="share">${icon('share')}分享</button></nav></header>
  <section class="overview"><h1>城市点亮地图</h1><p>点选城市进行标记，修改自动同步。</p></section>
  <div id="demo-banner"></div><div class="offline-banner" id="offline-banner" role="status"><span>正在连接共享地图…</span><button data-action="refresh">重新连接</button></div>
  <section class="stats" aria-label="点亮统计"><div class="stat accent"><div class="stat-label">${icon('pin')}已点亮</div><div class="stat-value"><span id="stat-count">00</span><span class="stat-unit">座</span></div></div><div class="stat"><div class="stat-label">${icon('map')}省级区域</div><div class="stat-value"><span id="stat-provinces">00</span><span class="stat-unit">/ 34</span></div></div><div class="stat"><div class="stat-label">${icon('heart')}备注</div><div class="stat-value"><span id="stat-memories">00</span><span class="stat-unit">条</span></div></div><div class="stat progress-stat"><div class="stat-label">点亮比例</div><div class="stat-progress"><strong id="stat-percent">0.0%</strong><small id="stat-total">正在加载</small></div><div class="progress-track"><span id="progress-fill"></span></div></div></section>
  <main class="workspace"><section class="map-card" aria-label="中国城市点亮地图"><div class="map-top"><div class="map-heading"><div class="map-title">${icon('globe')}中国地图</div><div class="sync-status offline" id="sync-status"><span class="sync-dot"></span><span>连接中</span></div></div><button class="btn export-trigger" data-action="export-map">${icon('download')}导出图片</button></div><div class="map-stage"><svg class="map-svg" role="img" aria-label="中国省市地图，可以缩放拖动；也可使用搜索按钮选择城市"></svg><div class="map-stamp">省界 / 市界</div><div class="compass">N</div><div class="map-controls"><button class="icon-btn" data-map="plus" aria-label="放大地图">${icon('plus')}</button><button class="icon-btn" data-map="minus" aria-label="缩小地图">${icon('minus')}</button><button class="icon-btn" data-map="reset" aria-label="回到全国地图">${icon('fit')}</button></div><div class="map-hint">${icon('pin')}点选城市 · 双指缩放</div><div class="sea-inset"><svg aria-label="南海诸岛"></svg><span>南海诸岛</span></div></div><div class="map-legend"><div class="legend-items"><span class="legend-item"><i class="swatch green"></i>已点亮</span><span class="legend-item"><i class="swatch"></i>未点亮</span><span class="legend-item"><i class="swatch orange"></i>已选中</span></div><div class="legend-boundary"><span><i></i>省界</span><span><i class="thin"></i>市界</span></div></div></section>
  <aside class="sidebar"><button class="search-trigger" data-action="search"><span>${icon('search')}搜索城市或省份</span><kbd>/</kbd></button><div class="city-panel" id="city-panel"></div><div class="shared-note"><div class="note-title">${icon('people')}共享编辑</div><p>所有访客共用一份数据。<br>修改自动保存，每 15 秒同步。</p><div class="mini-row"><span class="badge">无需登录</span><button data-action="share">分享地图 ↗</button></div></div><button class="view-demo" data-action="demo">查看示例地图</button></aside></main>
  <section class="activity-section"><div class="section-heading"><h2>${icon('clock')}最近修改</h2><button class="text-button" data-action="activity">已点亮城市 ${icon('arrow')}</button></div><div id="recent-activity"></div></section>
  <footer class="footer"><strong>城市点亮地图</strong><span><button data-action="about">地图数据与使用说明 ↗</button></span></footer>
  </div><div class="selection-dock" id="selection-dock" hidden></div><nav class="mobile-nav" aria-label="手机导航"><button class="active" data-action="home">${icon('map')}地图</button><button data-action="activity">${icon('pin')}已点亮</button><button data-action="share">${icon('people')}分享</button></nav>`;

function toast(message, undo) {
  clearTimeout(toastTimer);
  const el = document.querySelector('#toast');
  el.innerHTML = `${e(message)}${undo ? '<button>撤销</button>' : ''}`;
  el.classList.add('visible');
  if (undo) el.querySelector('button').onclick = () => { el.classList.remove('visible'); undo(); };
  toastTimer = setTimeout(() => el.classList.remove('visible'), undo ? 9000 : 4000);
}
function updateStatus(message) {
  const status = document.querySelector('#sync-status');
  status.classList.toggle('offline', !connected && !demo);
  status.querySelector('span:last-child').textContent = demo ? '示例模式' : message || (connected ? '已同步' : '暂时离线');
  const banner = document.querySelector('#offline-banner');
  banner.classList.toggle('visible', !connected && !demo);
  banner.querySelector('span').textContent = lastSync ? '暂时离线，展示上次同步的数据。恢复连接后可继续点亮。' : '共享地图尚未连接。连接成功后即可分享。';
}
function render() {
  if (!data) return;
  const stats = summarize(records, data.cities);
  document.querySelector('#stat-count').textContent = String(stats.count).padStart(2,'0');
  document.querySelector('#stat-provinces').textContent = String(stats.provinces).padStart(2,'0');
  document.querySelector('#stat-memories').textContent = String(stats.lit.filter(c => records[c.id].note).length).padStart(2,'0');
  document.querySelector('#stat-percent').textContent = `${stats.percent}%`;
  document.querySelector('#stat-total').textContent = `${stats.count} / ${data.cities.length} 个地区`;
  document.querySelector('#progress-fill').style.width = `${stats.percent}%`;
  map?.update(records, selectedId);
  renderPanel();
  const recent = activity.slice(0,3);
  document.querySelector('#recent-activity').innerHTML = recent.length ? `<div class="recent-grid">${recent.map(a => `<button class="activity-item" data-select="${a.cityId}"><span class="date">${e(dateText(a.updatedAt))}</span>${icon(a.active ? 'diagonal' : 'undo')}<div class="activity-city">${e(cityById.get(a.cityId)?.name || a.cityId)}</div><small>${e(a.author || '访客')} · ${a.active ? '保存了标记' : '取消了点亮'}</small></button>`).join('')}</div>` : `<div class="empty-activity"><div class="empty-text">${icon('pin')}<div><strong>暂无修改记录</strong><p>点选地图或搜索城市，添加标记。</p></div></div><button class="text-button" data-action="search">选择城市 ${icon('arrow')}</button></div>`;
  updateStatus();
}
function renderPanel() {
  const panel = document.querySelector('#city-panel');
  const city = cityById.get(selectedId);
  const dock = document.querySelector('#selection-dock');
  dock.hidden = !city;
  document.body.classList.toggle('has-selection', !!city);
  if (city) dock.innerHTML = `<div class="dock-info"><strong title="${e(city.name)}">${e(city.name)}</strong><span>${e(city.province)} · ${records[city.id]?.active ? '已点亮' : '未点亮'}</span></div><button class="btn btn-primary" data-action="edit">${records[city.id]?.active ? '编辑' : '点亮'}</button><button class="icon-btn" data-action="deselect" aria-label="取消选择">${icon('close')}</button>`;
  if (!city) { panel.innerHTML = `<div class="invitation">${icon('spark','big-spark')}<h2>选择城市</h2><p>在地图上点选城市，<br>或通过名称、省份搜索。</p><button class="btn" data-action="search">搜索城市 ${icon('arrow')}</button></div>`; return; }
  const record = records[city.id];
  panel.innerHTML = `<div class="selected-card"><div class="place-meta"><span>${e(city.province)}</span><span class="place-status ${record?.active ? 'lit' : ''}">${record?.active ? '已点亮' : '未点亮'}</span></div><h2>${e(city.name)}</h2><p class="place-caption">${record?.active ? `${e(record.author)} 的标记${record.date ? ` · ${e(record.date)}` : ''}` : '尚未添加标记。'}</p>${record?.active && record.note ? `<div class="place-note">${e(record.note)}</div>` : ''}<button class="btn btn-primary" data-action="edit">${icon(record?.active ? 'check' : 'spark')}${record?.active ? '编辑标记' : '点亮'}</button>${record?.active ? '<button class="card-link" data-action="remove">取消这座城市的点亮</button>' : ''}<button class="card-link" data-action="unselect">返回全国</button></div>`;
}
async function sync(manual = false) {
  if (syncing || saving || demo) return;
  syncing = true;
  const epoch = writeEpoch;
  if (manual) updateStatus('同步中…');
  try {
    const result = await getState();
    if (demo || saving || epoch !== writeEpoch) return;
    records = Object.fromEntries(Object.entries(result.records || {}).map(([id,r]) => [id,normalizeRecord(r)]));
    activity = result.activity || [];
    lastSync = Date.now(); connected = true;
    writeLocal('dianliang-cache-v1', { records, activity });
    render(); if (manual) toast('已同步最新数据');
  } catch { connected = false; updateStatus(); if (manual) toast('暂时连接不上，请稍后重试'); }
  finally { syncing = false; }
}
function selectCity(id, focus = false) {
  if (!cityById.has(id)) return;
  selectedId = id; renderPanel(); map.update(records,id);
  if (focus) map.focus(cityById.get(id));
  if (focus && !matchMedia('(max-width: 760px)').matches) document.querySelector('#city-panel [data-action="edit"]')?.focus({ preventScroll: true });
}
function closeModal(restoreFocus = true) {
  const hadModal = !!document.querySelector('.sheet');
  modalCleanup?.(); modalCleanup = null;
  document.querySelector('#modal-root').innerHTML = '';
  if (lockedScroll !== null) {
    Object.assign(document.body.style, { overflow: '', position: '', top: '', width: '' });
    window.scrollTo({ top: lockedScroll, behavior: 'instant' });
    lockedScroll = null;
  }
  document.body.classList.remove('modal-open');
  if (hadModal && restoreFocus) {
    const target = lastFocus?.isConnected ? lastFocus : document.querySelector('.search-trigger');
    target?.focus({ preventScroll: true });
  }
  lastFocus = null;
}
function addModalCleanup(cleanup) {
  const previous = modalCleanup;
  modalCleanup = () => { previous?.(); cleanup(); };
}
function modal(title, content) {
  const returnFocus = lastFocus || document.activeElement;
  closeModal(false); lastFocus = returnFocus;
  document.querySelector('#modal-root').innerHTML = `<div class="sheet-backdrop"><section class="sheet" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="sheet-head"><h2 id="dialog-title">${e(title)}</h2><button class="icon-btn" data-close aria-label="关闭">${icon('close')}</button></div><div class="sheet-content">${content}</div></section></div>`;
  lockedScroll = window.scrollY;
  Object.assign(document.body.style, { overflow: 'hidden', position: 'fixed', top: `-${lockedScroll}px`, width: '100%' });
  document.body.classList.add('modal-open');
  const root = document.querySelector('#modal-root');
  root.querySelector('[data-close]').onclick = () => { if (!saving) closeModal(); };
  root.querySelector('.sheet-backdrop').onclick = event => { if (event.target.classList.contains('sheet-backdrop') && !saving) closeModal(); };
  const onKey = event => {
    if (event.key === 'Escape' && !saving) closeModal();
    if (event.key === 'Tab') {
      const elements = [...root.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea,select,a[href]')].filter(el => el.offsetParent !== null);
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  document.addEventListener('keydown', onKey); modalCleanup = () => document.removeEventListener('keydown',onKey);
  root.querySelector('input,button')?.focus({ preventScroll: true });
  return root;
}
function searchModal(initial = 'all') {
  if (!data) return toast('地图正在加载，请稍等');
  const root = modal(initial === 'lit' ? '已点亮城市' : '搜索城市', `<div class="search-input-wrap">${icon('search')}<input id="city-search" type="search" placeholder="城市名 / 省份 / 行政区代码" aria-label="搜索城市" autocomplete="off"></div><div class="search-filters"><button class="chip ${initial === 'all' ? 'active' : ''}" data-filter="all">全部地区</button><button class="chip ${initial === 'lit' ? 'active' : ''}" data-filter="lit">已点亮</button><button class="chip" data-filter="unlit">未点亮</button></div><select class="province-select" aria-label="按省份筛选"><option value="">所有省份</option>${data.provinces.map(p => `<option value="${p.id}">${e(p.name)}</option>`).join('')}</select><div class="search-meta"></div><div class="search-results"></div>`);
  let filter = initial;
  root.querySelector('.sheet').classList.add('search-sheet');
  function list() {
    const q = root.querySelector('input').value.trim().toLowerCase();
    const province = root.querySelector('select').value;
    const filtered = data.cities.filter(c => (!province || c.provinceId === province) && (!q || `${c.name}${c.province}${c.id}`.toLowerCase().includes(q)) && (filter === 'all' || (filter === 'lit' ? records[c.id]?.active : !records[c.id]?.active)));
    root.querySelector('.search-meta').textContent = `${filtered.length} 个地区 · 点选查看与点亮`;
    root.querySelector('.search-results').innerHTML = filtered.length ? filtered.map(c => `<button class="city-row" data-pick="${c.id}"><span><strong>${e(c.name)}</strong><small>${e(c.province)}</small></span><span class="row-right">${records[c.id]?.active ? '<span class="lit-tag">已点亮</span>' : ''}${icon('chevron')}</span></button>`).join('') : '<div class="no-results">还没有符合条件的城市。<br><br>试试其他名字，或清除筛选。</div>';
  }
  root.querySelector('input').oninput = list; root.querySelector('select').onchange = list;
  root.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { filter = b.dataset.filter; root.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('active',x===b)); list(); });
  root.querySelector('.search-results').onclick = event => { const target=event.target.closest('[data-pick]'); if(target){const id=target.dataset.pick;closeModal(false);selectCity(id,true);scrollToMap();}};
  list();
  root.querySelector('input').focus({ preventScroll: true });
}
async function mutate(id, values, expectedVersion, operationId) {
  writeEpoch++;
  if (demo) {
    const record = { ...values, version:expectedVersion+1, updatedAt:new Date().toISOString() };
    records[id] = record;
    activity.unshift({ cityId:id,...record }); render(); return record;
  }
  const result = await saveCity(id,{...values, expectedVersion, operationId});
  records[id] = normalizeRecord(result.current || result.record);
  activity = [ {cityId:id, operationId, ...result.record}, ...activity.filter(a=>a.operationId!==operationId) ].slice(0,50);
  connected = true; lastSync = Date.now();
  writeLocal('dianliang-cache-v1',{records,activity}); render();
  return normalizeRecord(result.record);
}
function editCity(remove = false) {
  const city = cityById.get(selectedId); if (!city) return;
  const previous = normalizeRecord(records[city.id]);
  const root = modal(remove ? `取消点亮 · ${city.name}` : `${previous.active ? '记录' : '点亮'} · ${city.name}`, remove ? `<p>这会从共享地图上取消 <strong>${e(city.name)}</strong> 的点亮，所有人都会看到这次修改。</p><div class="form-error" role="alert"></div><div class="form-actions"><button class="btn" data-cancel>返回</button><button class="btn btn-danger" data-save>确认取消点亮</button></div>` : `<form id="visit-form"><label class="field"><span>操作人</span><input name="author" value="${e(nickname())}" maxlength="24" placeholder="例如：小王" required autocomplete="nickname"><small>用于显示修改记录。</small></label><label class="field"><span>到访日期 <small style="display:inline;font-weight:400">（选填）</small></span><input type="date" name="date" value="${e(previous.active ? previous.date : today())}" max="${today()}" min="1900-01-01"></label><label class="field"><span>备注 <small style="display:inline;font-weight:400">（选填）</small></span><textarea name="note" maxlength="240" placeholder="景点、行程或其他说明">${e(previous.note)}</textarea><small>最多 240 字 · 所有访客可见</small></label><div class="form-error" role="alert"></div><div class="form-actions"><button type="submit" class="btn btn-primary" data-save>${icon('spark')}${previous.active ? '保存标记' : '确认点亮'}</button></div>${previous.active ? '<button type="button" class="card-link" data-remove-current>取消点亮</button>' : ''}</form>`);
  root.querySelector('[data-cancel]')?.addEventListener('click', () => closeModal());
  root.querySelector('[data-remove-current]')?.addEventListener('click', () => { if (!saving) editCity(true); });
  let expected = previous.version, pendingOperation = null;
  const submit = async event => {
    event.preventDefault(); if (saving) return;
    const form = root.querySelector('form');
    if(form && !form.reportValidity())return;
    const fields = form ? new FormData(form) : null;
    const values = { active:!remove, author:String(fields?.get('author') || nickname()).trim(), date:remove ? previous.date : String(fields.get('date')), note:remove ? previous.note : String(fields.get('note')).trim() };
    if(!values.author){root.querySelector('.form-error').textContent='请输入操作人。';return;}
    const serialized = JSON.stringify(values);
    if(!pendingOperation || pendingOperation.serialized!==serialized)pendingOperation={id:crypto.randomUUID(),serialized};
    const btn = root.querySelector('[data-save]'), original = btn.innerHTML;
    btn.disabled=true;btn.textContent=demo?'保存示例中…':'正在同步到共享地图…';saving=true;
    root.querySelector('.form-error').textContent='';
    try {
      const current = await mutate(city.id,values,expected,pendingOperation.id);
      if(!remove)writeLocal('dianliang-nickname',values.author);
      saving=false;closeModal();
      toast(demo ? '示例已更新，不会影响共享地图' : remove ? `已取消点亮 ${city.name}` : `${city.name}已保存`,async()=>{
        if(saving)return;saving=true;
        try{await mutate(city.id,{...previous,author:values.author},current.version,crypto.randomUUID());toast('已撤销刚才的修改');}
        catch(error){toast(error.status===409?'该城市已有新修改，无法撤销旧版本':'撤销失败，请稍后重试');}
        finally{saving=false;sync();}
      });
    } catch(error) {
      if(error.status===409){expected=error.current?.version || expected;records[city.id]=normalizeRecord(error.current);pendingOperation=null;render();root.querySelector('.form-error').textContent='该城市已被其他人修改。再次保存将使用当前表单内容。';}
      else root.querySelector('.form-error').textContent=error.status===429?'操作有些频繁，请一分钟后再试。内容已保留。':`${error.message || '连接失败'}。本次尚未确认同步，你可以重试。`;
    } finally {saving=false;btn.disabled=false;btn.innerHTML=original;}
  };
  if(root.querySelector('form'))root.querySelector('form').onsubmit=submit;else root.querySelector('[data-save]').onclick=submit;
}
async function exportModal() {
  if (!map || !data) { toast('地图加载完成后即可导出'); return; }
  const stats = summarize(records, data.cities);
  const snapshot = createMapSnapshot(document.querySelector('.map-card'), { ...stats, total: data.cities.length }, { demo, offline: !connected && !demo });
  const root = modal('导出地图图片', '<div class="export-content"><div class="export-loading" role="status">正在生成 PNG…</div></div>');
  const sheet = root.querySelector('.sheet');
  sheet.classList.add('export-sheet');
  const controller = new AbortController();
  let previewUrl = null;
  addModalCleanup(() => {
    controller.abort();
    if (previewUrl) { const url = previewUrl; setTimeout(() => URL.revokeObjectURL(url), 60000); }
  });
  async function generate() {
    try {
      const blob = await renderMapPng(snapshot, { signal: controller.signal });
      if (!sheet.isConnected) return;
      previewUrl = URL.createObjectURL(blob);
      const file = typeof File === 'function' ? new File([blob], snapshot.filename, { type: 'image/png' }) : null;
      let canShare = false;
      try { canShare = !!file && typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [file] }); } catch { /* Download remains available. */ }
      root.querySelector('.export-content').innerHTML = `<div class="export-preview"><img src="${previewUrl}" alt="当前地图 PNG 预览" width="${snapshot.pixelWidth}" height="${snapshot.pixelHeight}"></div><div class="export-meta"><span>PNG · ${snapshot.pixelWidth} × ${snapshot.pixelHeight}</span><span>当前视图</span></div><div class="form-actions"><button class="btn btn-primary" data-save-png>${icon('download')}下载 PNG</button>${canShare ? `<button class="btn" data-share-png>${icon('share')}分享 / 存储</button>` : ''}</div><p class="export-help">已保留缩放范围、点亮颜色和省市边界。手机上也可长按图片保存。</p>`;
      root.querySelector('[data-save-png]').onclick = () => { downloadFile(previewUrl, snapshot.filename); toast('已发起下载；也可长按预览图保存'); };
      root.querySelector('[data-share-png]')?.addEventListener('click', async () => {
        const button = root.querySelector('[data-share-png]');
        button.disabled = true;
        try { await navigator.share({ files: [file], title: '城市点亮地图' }); }
        catch (error) { if (error.name !== 'AbortError') toast('未能打开系统分享，请使用下载 PNG'); }
        finally { button.disabled = false; }
      });
    } catch (error) {
      if (error.name === 'AbortError' || !sheet.isConnected) return;
      root.querySelector('.export-content').innerHTML = `<p class="form-error" role="alert">${e(error.message || '图片生成失败，请重试')}</p><button class="btn btn-primary" data-retry-export>重试</button>`;
      root.querySelector('[data-retry-export]').onclick = () => { root.querySelector('.export-content').innerHTML = '<div class="export-loading" role="status">正在生成 PNG…</div>'; generate(); };
    }
  }
  await generate();
}
function shareModal() {
  const count = data ? summarize(records,data.cities).count : 0;
  const root = modal('分享地图',`<div class="share-summary"><strong>已点亮 ${count} 个地区</strong><span>所有访客可编辑</span></div><p>将链接发给其他人，即可共同查看和编辑。</p><div class="share-url">${e(baseUrl())}</div><button class="btn btn-primary" style="width:100%" data-copy>${icon('share')}分享这张地图</button><p class="data-note">无需登录，任何拿到链接的人都能编辑。页面每 15 秒同步一次。</p>`);
  root.querySelector('[data-copy]').onclick=async()=>{
    const payload={title:'城市点亮地图',text:'中国城市点亮地图，支持共享编辑。',url:baseUrl()};
    try{if(navigator.share){await navigator.share(payload);}else{await navigator.clipboard.writeText(payload.url);toast('地图链接已复制');}}catch(error){if(error.name!=='AbortError')toast('请复制上方的地图链接');}
  };
}
function aboutModal() {
  const root=modal('使用说明',`<div class="note-title">${icon('spark')}操作说明</div><p>点选或搜索城市，添加标记、日期和备注。所有访客共用一张地图，保存后可撤销。</p><p>省界使用较粗的线，市界使用较细的线。手机支持双指缩放与拖动，也可以用地图左下角的按钮。</p><div class="about-grid"><button class="btn" data-export>${icon('download')}导出数据备份</button><button class="btn" data-reload>${icon('refresh')}立即同步</button></div><div class="demo-control"><p>示例数据仅用于体验，不会上传。</p><button data-show-demo>${demo?'退出示例':'查看示例'}</button></div><p class="data-note">行政区边界来自 <a href="https://datav.aliyun.com/portal/school/atlas/area_selector" target="_blank" rel="noopener noreferrer">阿里云 DataV.GeoAtlas</a>。当前共 34 个省级区域、${data?.cities.length || 370} 个点亮单元，包括地级市、自治州、地区、盟、直辖市及省直管县级单位。港澳及台湾当前按整体点亮，台湾暂未细分市县。数据为下载时的可用版本，不保证覆盖最新行政调整；本工具用于足迹记录。</p><p class="data-note">页面与源代码托管在 GitHub，标记保存在云端。断网时展示本机缓存，恢复连接后再编辑。<a href="https://github.com/biantai11523/light-up-china" target="_blank" rel="noopener noreferrer">查看项目源代码 ↗</a></p>`);
  root.querySelector('[data-export]').onclick=()=>{
    const blob=new Blob([JSON.stringify({app:'点亮',exportedAt:new Date().toISOString(),demo,records:Object.fromEntries(Object.entries(records).map(([id,r])=>[id,{...r,name:cityById.get(id)?.name,province:cityById.get(id)?.province}])),activity},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`点亮地图-${demo?'示例-':''}${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('数据备份已导出');
  };
  root.querySelector('[data-reload]').onclick=()=>{closeModal();sync(true);};
  root.querySelector('[data-show-demo]').onclick=()=>{closeModal();toggleDemo();};
}
async function toggleDemo() {
  if(!data || saving)return;
  demo=!demo;selectedId=null;
  writeEpoch++;
  document.querySelector('#demo-banner').innerHTML=demo?'<div class="demo-banner"><span>示例地图 · 仅供体验，不影响共享数据</span><button data-action="demo">退出示例</button></div>':'';
  if(demo){records={};activity=[];['110000','310000','330100','330200','320100','320500','510100','500000','440100','440300','530100','530700','350200','420100','610100','540100','650100','460200'].forEach((id,i)=>{records[id]={active:true,version:1,date:'2026-10-01',note:i===2?'西湖，2026 年 10 月':'',author:'示例用户',updatedAt:'2026-10-01T08:00:00.000Z'};});activity=['330100','510100','530700'].map(id=>({cityId:id,...records[id]}));render();map.reset();toast('正在体验示例，点亮操作不会上传');}
  else{const cached=readLocal('dianliang-cache-v1',{records:{},activity:[]});records=cached.records;activity=cached.activity;render();map.reset();await sync(true);}
}
document.addEventListener('click',event=>{
  const city=event.target.closest('[data-select]');if(city){selectCity(city.dataset.select,true);scrollToMap();return;}
  const button=event.target.closest('[data-action]');if(!button)return;
  const actions={'export-map':exportModal,deselect:()=>{selectedId=null;render();},search:()=>searchModal(),activity:()=>searchModal('lit'),share:shareModal,about:aboutModal,refresh:()=>sync(true),edit:()=>editCity(),remove:()=>editCity(true),demo:toggleDemo,unselect:()=>{selectedId=null;render();map.reset();},home:()=>{closeModal();window.scrollTo({top:0,behavior:scrollBehavior()});}};
  actions[button.dataset.action]?.();
});
document.addEventListener('keydown',event=>{if(event.key==='/'&&!document.querySelector('.sheet')&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)){event.preventDefault();searchModal();}});
window.addEventListener('online',()=>sync());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
window.addEventListener('offline',()=>{connected=false;updateStatus();});
async function boot(){
  try{
    const response=await fetch(`${import.meta.env.BASE_URL}data/china.json`);if(!response.ok)throw new Error('map');data=await response.json();data.cities.forEach(c=>cityById.set(c.id,c));map=createMap(document.querySelector('.map-card'),data,id=>selectCity(id));render();await sync();
    setInterval(()=>{if(!document.hidden)sync();},15000);
  }catch{document.querySelector('.map-stage').innerHTML='<div class="page-error">地图数据暂时加载失败。<br>请检查网络后重新打开页面。<br><button class="btn" onclick="location.reload()">重新加载地图</button></div>';}
}
boot();
