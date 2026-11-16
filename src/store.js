export function readLocal(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
export function writeLocal(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function summarize(records, cities) {
  const lit = cities.filter(c => records[c.id]?.active);
  return { lit, count: lit.length, provinces: new Set(lit.map(c => c.provinceId)).size, percent: cities.length ? (lit.length / cities.length * 100).toFixed(1) : '0.0' };
}
export function normalizeRecord(record) {
  return { active: Boolean(record?.active), version: Number(record?.version) || 0, date: record?.date || '', note: record?.note || '', author: record?.author || '访客', updatedAt: record?.updatedAt || '' };
}
