/* 首页：渲染游戏卡、封面插画、本周记录 */

import { GAME_LIST } from "./games/index.js";
import { stats, getRecords } from "./store.js";

const FEATURE = "freeze";

function paintCanvas(canvas, game) {
  const box = canvas.parentElement.getBoundingClientRect();
  const w = Math.max(280, Math.round(box.width));
  const h = Math.max(180, Math.round(box.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  try {
    game.cover?.(ctx, w, h);
  } catch (e) {
    console.error("cover failed", game.id, e);
    ctx.fillStyle = "#233";
    ctx.fillRect(0, 0, w, h);
  }
}

function card(game, feature) {
  const a = document.createElement("a");
  a.className = "game-card" + (feature ? " game-card--feature" : "");
  a.href = `./play.html?game=${game.id}`;
  a.setAttribute("aria-label", `开始玩${game.name}`);

  const metas = game.tag.split("·").map((s) => s.trim()).filter(Boolean);
  a.innerHTML = `
    <div class="game-card__cover">
      <canvas aria-hidden="true"></canvas>
      <span class="game-card__badge">${metas[0] || "感统游戏"}</span>
    </div>
    <div class="game-card__body">
      <div class="game-card__title">
        <h3>${game.name}</h3>
        <span>${game.age} 岁 · 60 秒</span>
      </div>
      <p class="game-card__desc">${game.tagline}</p>
      ${feature ? `<ul class="game-card__howto">${game.howto.map((t) => `<li>${t}</li>`).join("")}</ul>` : ""}
      <div class="game-card__meta">${metas.map((m) => `<span>${m}</span>`).join("")}</div>
      <span class="game-card__go">开始玩
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8h10M8 3.5L12.5 8 8 12.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
    </div>`;
  return a;
}

function renderGames() {
  const grid = document.getElementById("game-grid");
  const order = [FEATURE, ...GAME_LIST.filter((g) => g.id !== FEATURE).map((g) => g.id)];
  for (const id of order) {
    const game = GAME_LIST.find((g) => g.id === id);
    if (!game) continue;
    const el = card(game, id === FEATURE);
    grid.appendChild(el);
  }
  requestAnimationFrame(() => {
    for (const el of grid.querySelectorAll(".game-card")) {
      const id = new URL(el.href).searchParams.get("game");
      const game = GAME_LIST.find((g) => g.id === id);
      const c = el.querySelector("canvas");
      if (game && c) paintCanvas(c, game);
    }
  });

  let timer = null;
  const ro = new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const el of grid.querySelectorAll(".game-card")) {
        const id = new URL(el.href).searchParams.get("game");
        const game = GAME_LIST.find((g) => g.id === id);
        const c = el.querySelector("canvas");
        if (game && c) paintCanvas(c, game);
      }
    }, 180);
  });
  ro.observe(grid);
}

function renderHero() {
  const c = document.getElementById("hero-canvas");
  if (!c) return;
  const g = GAME_LIST.find((x) => x.id === "freeze");
  const box = c.getBoundingClientRect();
  const w = Math.round(box.width || 960);
  const h = Math.round(box.height || 560);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.cover(ctx, w, h);
}

function fmtDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return sameDay ? `今天 ${hm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

function renderRecords() {
  const s = stats();
  const empty = document.getElementById("records-empty");
  const statsBox = document.getElementById("records-stats");
  const list = document.getElementById("records-list");

  if (!s.total) {
    empty.hidden = false;
    statsBox.hidden = true;
    list.innerHTML = "";
    return;
  }

  empty.hidden = true;
  statsBox.hidden = false;
  document.getElementById("stat-week").textContent = s.week;
  document.getElementById("stat-stars").textContent = s.stars;
  document.getElementById("stat-time").textContent = s.minutes;
  const favId = Object.entries(s.byGame).sort((a, b) => b[1] - a[1])[0]?.[0];
  const fav = GAME_LIST.find((g) => g.id === favId);
  document.getElementById("stat-fav").textContent = fav ? fav.name : "—";

  const recent = getRecords().slice(0, 6);
  list.innerHTML = recent.map((r) => `
    <li>
      <span class="rec-name">${r.name || "游戏"}</span>
      <span class="rec-time">${fmtDate(r.ts)}</span>
      <span class="rec-stars" aria-label="${r.stars} 颗星">${"★".repeat(r.stars || 0)}${"☆".repeat(3 - (r.stars || 0))}</span>
    </li>`).join("");
}

function reveal() {
  const els = [...document.querySelectorAll(".reveal")];
  if (!("IntersectionObserver" in window)) {
    els.forEach((e) => e.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    }
  }, { threshold: 0.12 });
  els.forEach((e) => io.observe(e));
}

renderHero();
renderGames();
renderRecords();
reveal();
