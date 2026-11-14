/* 本机成绩记录（只存在浏览器里，不上传） */

const KEY = "qgd_records_v1";

export function getRecords() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function addRecord(rec) {
  const list = getRecords();
  list.unshift(rec);
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 80)));
  } catch { /* 存不下就算了 */ }
}

export function stats() {
  const list = getRecords();
  const weekAgo = Date.now() - 7 * 864e5;
  const week = list.filter((r) => r.ts >= weekAgo);
  const minutes = Math.round(week.reduce((a, r) => a + 60, 0) / 60);
  const stars = week.reduce((a, r) => a + (r.stars || 0), 0);
  const byGame = {};
  for (const r of week) byGame[r.game] = (byGame[r.game] || 0) + 1;
  return { total: list.length, week: week.length, minutes, stars, byGame, list };
}

export function playCount(gameId) {
  return getRecords().filter((r) => r.game === gameId).length;
}

export function lastPlayed(gameId) {
  return getRecords().find((r) => r.game === gameId) || null;
}
