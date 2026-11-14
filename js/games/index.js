import freeze from "./freeze.js";
import fruit from "./fruit.js";
import hop from "./hop.js";
import mole from "./mole.js";
import wall from "./wall.js";
import rope from "./rope.js";

/* 首页和结算页的展示顺序：新游戏排前面，低龄友好的在前 */
export const GAME_LIST = [mole, freeze, wall, fruit, rope, hop];

export const GAMES = Object.fromEntries(GAME_LIST.map((g) => [g.id, g]));

export function getGame(id) {
  return GAMES[id] || null;
}

/* 每天一个“今日挑战”：按日期轮换，同一天打开都是同一个 */
export function dailyGame(date = new Date()) {
  const day = Math.floor((date.getTime() - date.getTimezoneOffset() * 60000) / 864e5);
  return GAME_LIST[day % GAME_LIST.length];
}

/* 结算页推荐：先推没玩过的，再推练别的感觉通道的 */
export function suggestNext(currentId, playedIds = new Set(), n = 3) {
  const cur = GAMES[currentId];
  const rest = GAME_LIST.filter((g) => g.id !== currentId);
  const score = (g) => (playedIds.has(g.id) ? 0 : 2) + (cur && g.sense !== cur.sense ? 1 : 0);
  return rest
    .map((g, i) => ({ g, s: score(g) + (GAME_LIST.length - i) * 0.01 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.g);
}
