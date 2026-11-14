/* 感统游戏的入口：读 ?game=，用公共运行时跑起来 */

import { Runtime } from "./runtime.js";
import { getGame, suggestNext } from "./games/index.js";

const params = new URLSearchParams(location.search);
const initial = getGame(params.get("game"));
if (!initial) {
  location.replace("./index.html#games");
} else {
  const rt = new Runtime(initial, { getGame, suggest: suggestNext });
  window.__rt = rt;
  requestAnimationFrame(rt.loop);
}
