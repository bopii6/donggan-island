import freeze from "./freeze.js";
import fruit from "./fruit.js";
import hop from "./hop.js";

export const GAMES = { freeze, fruit, hop };

export function getGame(id) {
  return GAMES[id] || freeze;
}

export const GAME_LIST = [freeze, fruit, hop];
