/* 本机成绩记录（只存在浏览器里，不上传） */

const KEY = "qgd_records_v1";
const BEST_KEY = "qgd_best_v1";

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? JSON.parse(raw) : fallback;
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* 存不下就算了 */ }
}

export function getRecords() {
  const arr = read(KEY, []);
  return Array.isArray(arr) ? arr : [];
}

export function getBests() {
  const b = read(BEST_KEY, {});
  // 老版本没有单独存最好成绩：从历史记录里补出来
  if (!Object.keys(b).length) {
    for (const r of getRecords()) {
      const cur = b[r.game];
      if (!cur || (r.score ?? 0) > cur.score) b[r.game] = { score: r.score ?? 0, stars: r.stars ?? 0, ts: r.ts };
      else if ((r.stars ?? 0) > cur.stars) cur.stars = r.stars;
    }
  }
  return b;
}

export function bestOf(gameId) {
  return getBests()[gameId] || null;
}

/** 记一局；返回 { isBest, prevBest } 方便结算页喊“新纪录” */
export function addRecord(rec) {
  const list = getRecords();
  list.unshift(rec);
  write(KEY, list.slice(0, 120));

  const bests = getBests();
  const prev = bests[rec.game] || null;
  const isBest = !prev || (rec.score ?? 0) > prev.score;
  bests[rec.game] = {
    score: Math.max(prev?.score ?? 0, rec.score ?? 0),
    stars: Math.max(prev?.stars ?? 0, rec.stars ?? 0),
    ts: isBest ? rec.ts : prev.ts,
  };
  write(BEST_KEY, bests);
  return { isBest: isBest && !!prev, first: !prev, prevBest: prev };
}

const dayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

export function stats() {
  const list = getRecords();
  const now = new Date();
  // 本周从周一算
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weekStart = monday.getTime();
  const week = list.filter((r) => r.ts >= weekStart);
  const seconds = week.reduce((a, r) => a + (r.duration || 60), 0);
  const stars = week.reduce((a, r) => a + (r.stars || 0), 0);
  const byGame = {};
  for (const r of week) byGame[r.game] = (byGame[r.game] || 0) + 1;

  const played = new Set(list.map((r) => dayKey(r.ts)));
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart + i * 864e5);
    days.push({
      label: "一二三四五六日"[i],
      done: played.has(dayKey(d.getTime())),
      today: dayKey(d.getTime()) === dayKey(now.getTime()),
      future: d.getTime() > now.getTime(),
    });
  }

  // 连续打卡天数（今天没玩也不断，从昨天往前数）
  let streak = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!played.has(dayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  while (played.has(dayKey(cursor.getTime()))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return {
    total: list.length,
    week: week.length,
    minutes: Math.round(seconds / 60),
    stars,
    byGame,
    days,
    streak,
    list,
  };
}

export function playCount(gameId) {
  return getRecords().filter((r) => r.game === gameId).length;
}

export function lastPlayed(gameId) {
  return getRecords().find((r) => r.game === gameId) || null;
}
