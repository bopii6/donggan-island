/* 首页：今日挑战、动画舞台、游戏卡、三种感觉、成长记录 */

import { GAME_LIST, GAMES, dailyGame } from "./games/index.js";
import { stats, getRecords, getBests } from "./store.js";
import { drawAvatar, jackPose, PALETTES } from "./avatar.js";
import { drawHoleBack, drawHoleFront, drawMole } from "./games/mole.js";
import { starPath, clamp } from "./kit.js";

const $ = (s) => document.querySelector(s);
const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const STAR = (on, size = 17) => `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true"><path d="M32 5l8.4 17.6 19.1 2.5-14 13.2 3.6 19L32 48.6 14.9 57.3l3.6-19-14-13.2 19.1-2.5z" fill="${on ? "#f9b233" : "#ded8c6"}" stroke="#10201b" stroke-width="5" stroke-linejoin="round"/></svg>`;
const ARROW = `<svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 8h10M8 3.5L12.5 8 8 12.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const INTENSITY = ["", "轻松", "出点汗", "出大汗"];

const SENSES = [
  {
    id: "前庭觉",
    color: "#7fd3ea",
    title: "身体在哪儿、<br>有没有在动",
    text: "跳起、落地、左右换重心，让内耳和身体不断对答案。前庭觉稳了，孩子更坐得住、站得稳。",
  },
  {
    id: "本体觉",
    color: "#ffb38a",
    title: "用了多大力、<br>动到什么位置",
    text: "说定住就定住、照着样子摆姿势，靠的是不用眼睛看，也知道自己的手和脚在哪儿。",
  },
  {
    id: "视觉—动作",
    color: "#b9acff",
    title: "眼睛看到，<br>身体马上跟上",
    text: "追着水果挥手、看到地鼠就拍，是典型的手眼协调；伸手跨过身体中线去够，还能练左右配合。",
  },
];

/* ---------- 画布工具 ---------- */
function fitCanvas(canvas) {
  const box = canvas.parentElement.getBoundingClientRect();
  const w = Math.max(160, Math.round(box.width));
  const h = Math.max(100, Math.round(box.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function paintCover(canvas, game) {
  const { ctx, w, h } = fitCanvas(canvas);
  try {
    game.cover?.(ctx, w, h);
  } catch (e) {
    console.error("cover failed", game.id, e);
    ctx.fillStyle = game.theme?.color || "#233";
    ctx.fillRect(0, 0, w, h);
  }
}

/* ---------- 今日挑战 ---------- */
function renderToday() {
  const g = dailyGame();
  const a = $("#today");
  a.href = `./play.html?game=${g.id}`;
  a.style.setProperty("--c", g.theme?.deep || g.theme?.color);
  $("#today-name").textContent = g.name;
  const todayKey = new Date().toDateString();
  const doneToday = getRecords().find((r) => r.game === g.id && new Date(r.ts).toDateString() === todayKey);
  $("#today-desc").textContent = doneToday ? `今天已经拿到 ${"★".repeat(doneToday.stars || 1)}，再挑战一次？` : g.pitch;
  a.setAttribute("aria-label", `今日挑战：${g.name}，开始玩`);
  requestAnimationFrame(() => paintCover(a.querySelector("canvas"), g));
}

/* ---------- 动画舞台：小人在岛上开合跳，地鼠探头，星星往上冒 ---------- */
function startHero() {
  const canvas = $("#hero-canvas");
  if (!canvas) return;
  let size = fitCanvas(canvas);
  let visible = true;
  let raf = 0;
  const sparks = [];
  let lastTop = false;

  const draw = (now) => {
    const { ctx, w, h } = size;
    const t = now / 1000;

    // 天空
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#8fd3f4");
    sky.addColorStop(0.62, "#d8f1fa");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // 太阳 + 光芒
    const sx = w * 0.8, sy = h * 0.2, sr = Math.min(w, h) * 0.085;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(t * 0.25);
    ctx.fillStyle = "rgba(249,178,51,0.35)";
    for (let i = 0; i < 10; i++) {
      ctx.rotate((Math.PI * 2) / 10);
      ctx.beginPath();
      ctx.moveTo(sr * 1.25, -sr * 0.16);
      ctx.lineTo(sr * 1.9, 0);
      ctx.lineTo(sr * 1.25, sr * 0.16);
      ctx.fill();
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fillStyle = "#ffd166";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#10201b";
    ctx.stroke();

    // 云
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#10201b";
    ctx.lineWidth = 2.5;
    for (const [cx0, cy, s, sp] of [[0.12, 0.16, 1, 8], [0.5, 0.1, 0.75, 5]]) {
      const x = ((cx0 * w + t * sp) % (w + 120)) - 60, y = h * cy, r = Math.min(w, h) * 0.045 * s;
      ctx.beginPath();
      ctx.arc(x, y, r, Math.PI * 0.5, Math.PI * 1.5);
      ctx.arc(x + r * 1.1, y - r * 0.5, r * 1.15, Math.PI, Math.PI * 2);
      ctx.arc(x + r * 2.2, y, r, Math.PI * 1.5, Math.PI * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // 海
    const seaY = h * 0.66;
    ctx.fillStyle = "#3fa7d6";
    ctx.fillRect(0, seaY, w, h - seaY);
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (let row = 0; row < 3; row++) {
      const y = seaY + 18 + row * 26;
      for (let x = -40 + ((t * 20 + row * 30) % 80); x < w + 40; x += 80) {
        ctx.beginPath();
        ctx.arc(x, y, 9, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      }
    }

    // 岛
    const ix = w * 0.5, iy = h * 0.78;
    ctx.beginPath();
    ctx.ellipse(ix, iy, w * 0.44, h * 0.13, 0, Math.PI, 0);
    ctx.lineTo(ix + w * 0.44, iy + 4);
    ctx.quadraticCurveTo(ix, iy + h * 0.06, ix - w * 0.44, iy + 4);
    ctx.closePath();
    ctx.fillStyle = "#f3d38b";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#10201b";
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(ix, iy - h * 0.012, w * 0.38, h * 0.1, 0, Math.PI, 0);
    ctx.closePath();
    ctx.fillStyle = "#6cc46a";
    ctx.fill();
    ctx.stroke();

    // 地鼠洞（左边）
    const hole = { x: w * 0.2, y: iy - h * 0.035, r: Math.min(w, h) * 0.06 };
    const cyc = (t % 3.2) / 3.2;
    const prog = cyc < 0.12 ? cyc / 0.12 : cyc < 0.62 ? 1 : cyc < 0.74 ? 1 - (cyc - 0.62) / 0.12 : 0;
    drawHoleBack(ctx, hole);
    drawMole(ctx, hole, { prog, phase: "up", type: Math.floor(t / 3.2) % 4 === 3 ? "gold" : "normal", tilt: Math.sin(t * 3) * 0.08, t });
    drawHoleFront(ctx, hole);

    // 开合跳的小人
    const beat = t * 1.6;
    const k = (1 - Math.cos(beat * Math.PI * 2)) / 2;
    const hgt = h * 0.46;
    const lift = Math.max(0, Math.sin(beat * Math.PI * 2 - Math.PI / 2)) * h * 0.035;
    const P = jackPose(w * 0.54, iy - h * 0.02, hgt, k, lift);
    drawAvatar(ctx, P, { palette: PALETTES.sunset, inkW: Math.max(3.5, w * 0.007) });

    // 手举到最高时冒星星
    const top = k > 0.96;
    if (top && !lastTop) {
      for (const wri of [P.lWri, P.rWri]) {
        for (let i = 0; i < 3; i++) {
          sparks.push({ x: wri.x, y: wri.y, vx: (Math.random() - 0.5) * 90, vy: -80 - Math.random() * 90, t: 0, r: 6 + Math.random() * 6 });
        }
      }
    }
    lastTop = top;
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.t += 1 / 60;
      s.x += s.vx / 60;
      s.y += s.vy / 60;
      s.vy += 60 / 60;
      if (s.t > 1.1) { sparks.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = clamp(1 - s.t / 1.1, 0, 1);
      ctx.translate(s.x, s.y);
      ctx.rotate(s.t * 4);
      starPath(ctx, 0, 0, s.r, s.r * 0.45, 5);
      ctx.fillStyle = "#ffd166";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#10201b";
      ctx.stroke();
      ctx.restore();
    }

  };

  const loop = (now) => {
    if (visible) draw(now);
    raf = requestAnimationFrame(loop);
  };

  if (reduceMotion) {
    draw(1200);
  } else {
    raf = requestAnimationFrame(loop);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(canvas);
    }
  }

  let timer = null;
  new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      size = fitCanvas(canvas);
      if (reduceMotion) draw(1200);
    }, 120);
  }).observe(canvas.parentElement);
}

/* ---------- 游戏卡 ---------- */
function energy(n) {
  return `<span class="energy" aria-hidden="true">${[1, 2, 3].map((i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</span>`;
}

function card(game, best) {
  const a = document.createElement("a");
  a.className = "game-card";
  a.href = `./play.html?game=${game.id}`;
  a.dataset.game = game.id;
  a.style.setProperty("--c", game.theme?.color || "#e2542f");
  a.setAttribute("aria-label", `开始玩${game.name}`);
  const skills = game.tag.split("·").map((s) => s.trim()).filter((s) => s && s !== game.sense);
  const bestHtml = best
    ? `<span class="game-card__best" title="最好成绩 ${best.score}">${[0, 1, 2].map((i) => STAR(i < best.stars)).join("")}</span>`
    : "";
  a.innerHTML = `
    <div class="game-card__cover">
      <canvas aria-hidden="true"></canvas>
      ${game.isNew && !best ? `<span class="game-card__new">新游戏</span>` : ""}
      ${bestHtml}
    </div>
    <div class="game-card__body">
      <div class="game-card__title">
        <h3>${game.name}</h3>
        <span>${game.age} 岁 · ${INTENSITY[game.intensity || 2]}${energy(game.intensity || 2)}</span>
      </div>
      <p class="game-card__desc">${game.tagline}</p>
      <div class="game-card__foot">
        <div class="game-card__meta">
          <span class="is-sense">${game.sense}</span>
          ${skills.map((m) => `<span>${m}</span>`).join("")}
        </div>
        <span class="game-card__go">${ARROW}</span>
      </div>
    </div>`;
  return a;
}

function renderGames() {
  const grid = $("#game-grid");
  const bests = getBests();
  for (const g of GAME_LIST) grid.appendChild(card(g, bests[g.id]));
  const paintAll = () => {
    for (const el of grid.querySelectorAll(".game-card")) {
      const g = GAMES[el.dataset.game];
      const c = el.querySelector("canvas");
      if (g && c) paintCover(c, g);
    }
  };
  requestAnimationFrame(paintAll);
  let timer = null;
  new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(paintAll, 160);
  }).observe(grid);
}

/* ---------- 三种感觉 ---------- */
function renderSenses() {
  $("#senses-grid").innerHTML = SENSES.map((s) => {
    const games = GAME_LIST.filter((g) => g.sense === s.id);
    return `
      <article class="sense">
        <span class="sense__tag" style="background:${s.color}">${s.id}</span>
        <h3>${s.title}</h3>
        <p>${s.text}</p>
        <div class="sense__games">
          ${games.map((g) => `<a href="./play.html?game=${g.id}"><i style="background:${g.theme?.color}"></i>${g.name}</a>`).join("")}
        </div>
      </article>`;
  }).join("");
}

/* ---------- 成长记录 ---------- */
function fmtDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return sameDay ? `今天 ${hm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

function renderRecords() {
  const s = stats();
  $("#streak").innerHTML = `<b>${s.streak}</b> 天连续打卡`;
  $("#week-days").innerHTML = s.days.map((d) => `
    <li class="${d.done ? "is-done" : ""} ${d.today ? "is-today" : ""} ${d.future ? "is-future" : ""}">
      <i aria-hidden="true"></i><span>${d.today ? "今天" : "周" + d.label}</span>
    </li>`).join("");
  $("#stat-week").textContent = s.week;
  $("#stat-stars").textContent = s.stars;
  $("#stat-time").textContent = s.minutes;

  const bests = getBests();
  $("#bests-list").innerHTML = GAME_LIST.map((g) => {
    const b = bests[g.id];
    return `
      <li><a href="./play.html?game=${g.id}" style="--c:${g.theme?.color}">
        <span class="dot"></span>
        <b>${g.name}</b>
        ${b ? `<em>${b.score} ${g.unit} <span class="rec-stars">${"★".repeat(b.stars)}${"☆".repeat(3 - b.stars)}</span></em>` : `<em class="none">还没玩过</em>`}
      </a></li>`;
  }).join("");

  const recent = getRecords().slice(0, 5);
  $("#recent-empty").hidden = recent.length > 0;
  $("#recent-list").innerHTML = recent.map((r) => {
    const g = GAMES[r.game];
    return `
      <li style="--c:${g?.theme?.color || "#ccc"}">
        <span class="dot"></span>
        <span><b>${r.name || g?.name || "游戏"}</b><span class="rec-time">${fmtDate(r.ts)} · ${r.score} ${g?.unit || "分"}</span></span>
        <span class="rec-stars" aria-label="${r.stars} 颗星">${"★".repeat(r.stars || 0)}${"☆".repeat(3 - (r.stars || 0))}</span>
      </li>`;
  }).join("");
}

renderToday();
startHero();
renderGames();
renderSenses();
renderRecords();

// 从游戏页返回（浏览器后退缓存）时刷新记录
window.addEventListener("pageshow", (e) => { if (e.persisted) renderRecords(); });
