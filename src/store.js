export function readLocal(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
export function writeLocal(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function summarize(records, cities) {
  const lit = cities.filter(c => records[c.id]?.active);
  const fraction = cities.length ? lit.length / cities.length * 100 : 0;
  return { lit, count: lit.length, countries:new Set(lit.map(c=>c.countryId||'CHN')).size,
    provinces: new Set(lit.map(c => c.provinceId)).size, percent:fraction.toFixed(fraction>0 && fraction<1 ? 2 : 1) };
}
export function normalizeRecord(record) {
  return { active: Boolean(record?.active), version: Number(record?.version) || 0, date: record?.date || '', note: record?.note || '', author: record?.author || '访客', updatedAt: record?.updatedAt || '' };
}
