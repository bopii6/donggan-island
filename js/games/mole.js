/* 打地鼠 —— 地洞围着孩子摆一圈，伸手就能够到；看到地鼠冒头就拍，看到刺猬要忍住。
   练的是：视觉搜索、反应速度、跨中线够物、抑制控制。 */

import { clamp, lerp, rand, pick, Particles, roundRect, easeOutBack, outlineText } from "../kit.js";
import { drawAvatar, presetPose, standingJoints, fitScale } from "../avatar.js";

const DURATION = 60;
const PAL = { shirt: "#3bb273", pants: "#2b4f8a", skin: "#ffd2ae", hair: "#2a1c17", shoe: "#101d19" };

/* 地洞位置：以肩膀中点为原点、肩宽为单位。全部在伸直手臂够得到的范围里。 */
const LAYOUT = [
  { x: -1.5, y: -1.2 }, { x: 1.5, y: -1.2 },
  { x: -1.95, y: 0.25 }, { x: 1.95, y: 0.25 },
  { x: -1.3, y: 1.5 }, { x: 1.3, y: 1.5 },
  { x: 0, y: -1.72 },
];

const COLORS = {
  normal: { fur: "#9a6440", belly: "#e9c39b", dark: "#6e4429" },
  gold: { fur: "#f6c343", belly: "#fff1b8", dark: "#c98f12" },
  hedge: { fur: "#7d6a5c", belly: "#e9d7c3", dark: "#4a3c33" },
};

let S = null;

function blank() {
  return {
    t: 0,
    holes: LAYOUT.map((p, i) => ({ i, rel: p, x: 0, y: 0, r: 50, mole: null })),
    anchor: null,
    hands: [0, 1].map(() => ({ x: 0, y: 0, px: 0, py: 0, has: false, speed: 0, swing: 0 })),
    parts: new Particles(260),
    pops: [],
    spawnT: 0.6,
    lastHole: -1,
    diff: 0.12,
    score: 0,
    combo: 0,
    bestCombo: 0,
    hits: 0,
    golds: 0,
    missed: 0,
    hedgeHit: 0,
    hedgeSkip: 0,
    cross: 0,
    react: [],
    spawned: 0,
    stun: 0,
  };
}

/* ---------- 布局 ---------- */
function updateAnchor(rt, f, dt) {
  const { W, H } = rt;
  let tx = W / 2, ty = H * 0.46, ts = Math.min(W, H) * 0.16;
  if (f && f.ok && f.shoulder && f.bodyScale) {
    const k = fitScale(f.bodyScale, H, 0.66);
    tx = f.shoulder.x;
    ty = f.shoulder.y;
    ts = f.bodyScale * k;
  }
  // 画面装得下才行：离镜头太近时把一圈地洞收紧
  const top = 104, bottom = 24;
  ts = Math.min(ts, (W / 2 - 40) / 2.35, (H - top - bottom) / 3.7);
  ts = Math.max(ts, 46);
  if (!S.anchor) S.anchor = { x: tx, y: ty, s: ts };
  const a = S.anchor;
  const k = Math.min(1, dt * 1.6);
  a.x += (tx - a.x) * k;
  a.y += (ty - a.y) * k;
  a.s += (ts - a.s) * k;

  for (const h of S.holes) {
    const r = clamp(a.s * 0.46, 34, 96);
    h.r = r;
    h.x = clamp(a.x + h.rel.x * a.s, r * 1.3, W - r * 1.3);
    h.y = clamp(a.y + h.rel.y * a.s, top + r * 1.2, H - r * 0.6 - bottom);
  }
}

/* ---------- 地鼠 ---------- */
function pickHole() {
  const free = S.holes.filter((h) => !h.mole);
  if (!free.length) return null;
  const last = S.holes[S.lastHole];
  // 六成概率换到另一边：逼着孩子跨过身体中线去够
  if (last && Math.random() < 0.6) {
    const side = Math.sign(last.rel.x) || (Math.random() < 0.5 ? -1 : 1);
    const opp = free.filter((h) => Math.sign(h.rel.x) === -side);
    if (opp.length) return pick(opp);
  }
  const others = free.filter((h) => h.i !== S.lastHole);
  return pick(others.length ? others : free);
}

function spawnMole(rt) {
  const hole = pickHole();
  if (!hole) return;
  S.lastHole = hole.i;
  let type = "normal";
  const r = Math.random();
  // 刺猬越往后越多：乱挥手会拍到刺猬，得看清楚再拍
  if (S.t > 7 && r < lerp(0.14, 0.24, clamp(S.t / DURATION, 0, 1))) type = "hedge";
  else if (S.t > 10 && r < 0.32) type = "gold";
  const up = lerp(2.1, 0.95, S.diff);
  hole.mole = {
    type,
    phase: "rise",
    prog: 0,
    t: 0,
    upTime: type === "hedge" ? lerp(1.9, 1.3, S.diff) : type === "gold" ? up * 0.8 : up,
    hitT: 0,
    tilt: rand(0.12, -0.12),
  };
  S.spawned++;
  rt.audio.sfx("peek");
}

function hitMole(rt, hole, handIdx) {
  const m = hole.mole;
  const head = { x: hole.x, y: hole.y - hole.r * 1.25 * m.prog };
  m.phase = "hit";
  m.hitT = 0;
  S.hands[handIdx].swing = 1;

  if (m.type === "hedge") {
    S.hedgeHit++;
    S.combo = 0;
    S.stun = 1.1; // 被扎到手：锤子掉了，一秒多拍不了
    S.score = Math.max(0, S.score - 100);
    rt.setScore(S.score);
    rt.kick(12);
    rt.audio.sfx("ouch");
    S.pops.push({ text: "哎哟！扎手", sub: "刺猬不能拍 -100", x: head.x, y: head.y - 30, t: 0, color: "#ff8a7a" });
    S.parts.burst(head.x, head.y, 10, { color: ["#7d6a5c", "#ff8a7a"], life: 0.5, size: 6, power: 0.8 });
    return;
  }

  S.hits++;
  S.combo++;
  S.bestCombo = Math.max(S.bestCombo, S.combo);
  S.react.push(m.t);
  S.diff = clamp(S.diff + 0.045, 0, 1);
  const mult = 1 + Math.min(10, S.combo - 1) * 0.1;
  const base = m.type === "gold" ? 300 : 100;
  const gain = Math.round(base * mult);
  S.score += gain;
  rt.setScore(S.score);

  // 跨中线：屏幕左边的手去拍右边的洞（或反过来）
  const cx = S.anchor ? S.anchor.x : rt.W / 2;
  const off = (hole.x - cx) / (S.anchor?.s || 100);
  if ((handIdx === 0 && off > 0.35) || (handIdx === 1 && off < -0.35)) S.cross++;

  if (m.type === "gold") {
    S.golds++;
    rt.audio.sfx("sparkle");
    S.pops.push({ text: `金地鼠 +${gain}`, x: head.x, y: head.y - 34, t: 0, color: "#ffd166", big: true });
    S.parts.burst(head.x, head.y, 22, { color: ["#ffd166", "#fff", "#f9b233"], shape: "star", life: 0.9, size: 13, power: 1.3 });
  } else {
    rt.audio.sfx("bonk");
    S.pops.push({ text: S.combo > 1 ? `${S.combo} 连击 +${gain}` : `+${gain}`, x: head.x, y: head.y - 34, t: 0, color: "#fffaf0" });
    S.parts.burst(head.x, head.y, 12, { color: ["#ffd166", "#fff", "#e9c39b"], shape: "star", life: 0.6, size: 10, power: 1 });
  }
  if (S.combo > 0 && S.combo % 6 === 0) rt.cheer();
}

/* ---------- 画 ---------- */
function drawMeadow(ctx, W, H) {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#8fd3f4");
  sky.addColorStop(0.55, "#c9ecf6");
  sky.addColorStop(0.56, "#9ad37a");
  sky.addColorStop(1, "#4e9a50");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  // 太阳
  ctx.fillStyle = "#ffe08a";
  ctx.beginPath();
  ctx.arc(W * 0.86, H * 0.16, Math.min(W, H) * 0.07, 0, Math.PI * 2);
  ctx.fill();
  // 云
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  for (const [cx, cy, s] of [[0.18, 0.14, 1], [0.55, 0.09, 0.8], [0.72, 0.24, 0.6]]) {
    const x = W * cx, y = H * cy, r = Math.min(W, H) * 0.045 * s;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.arc(x + r * 1.1, y - r * 0.4, r * 1.2, 0, Math.PI * 2);
    ctx.arc(x + r * 2.3, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // 远山
  ctx.fillStyle = "#7cc06a";
  ctx.beginPath();
  ctx.moveTo(0, H * 0.58);
  ctx.quadraticCurveTo(W * 0.25, H * 0.44, W * 0.5, H * 0.57);
  ctx.quadraticCurveTo(W * 0.75, H * 0.46, W, H * 0.58);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.fill();
}

function drawHoleBack(ctx, h) {
  const { x, y, r } = h;
  ctx.save();
  // 土堆
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.08, r * 1.42, r * 0.56, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#a9713f";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#10201b";
  ctx.stroke();
  // 洞口
  ctx.beginPath();
  ctx.ellipse(x, y, r * 1.1, r * 0.38, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#2b1a10";
  ctx.fill();
  ctx.restore();
}

function drawHoleFront(ctx, h) {
  const { x, y, r } = h;
  ctx.save();
  // 洞口前沿：盖住地鼠的下半身
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.08, r * 1.42, r * 0.56, 0, 0, Math.PI);
  ctx.ellipse(x, y, r * 1.1, r * 0.38, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fillStyle = "#b87c46";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#10201b";
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.08, r * 1.42, r * 0.56, 0, 0, Math.PI);
  ctx.stroke();
  // 草
  ctx.strokeStyle = "#3f8f3f";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (const dx of [-1.25, -1.05, 1.05, 1.28]) {
    ctx.beginPath();
    ctx.moveTo(x + dx * r, y + r * 0.42);
    ctx.lineTo(x + dx * r * 1.08, y + r * 0.12);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMoleBody(ctx, x, top, r, type, { dizzy = false, squash = 1, tilt = 0, t = 0 } = {}) {
  const c = COLORS[type];
  ctx.save();
  ctx.translate(x, top + r * 0.95);
  ctx.rotate(tilt);
  ctx.scale(1, squash);
  ctx.translate(0, -r * 0.95);
  ctx.lineWidth = Math.max(3, r * 0.09);
  ctx.strokeStyle = "#10201b";
  ctx.lineJoin = "round";

  // 刺猬的刺
  if (type === "hedge") {
    ctx.fillStyle = "#4a3c33";
    ctx.beginPath();
    const n = 11;
    for (let i = 0; i <= n; i++) {
      const a = Math.PI + (i / n) * Math.PI;
      const rr = i % 2 ? r * 1.32 : r * 0.95;
      const px = Math.cos(a) * rr, py = r * 0.95 + Math.sin(a) * rr * 1.08;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // 身体
  ctx.beginPath();
  ctx.ellipse(0, r * 0.95, r * 0.86, r * 1.02, 0, 0, Math.PI * 2);
  ctx.fillStyle = c.fur;
  ctx.fill();
  ctx.stroke();
  // 肚皮
  ctx.beginPath();
  ctx.ellipse(0, r * 1.25, r * 0.55, r * 0.6, 0, 0, Math.PI * 2);
  ctx.fillStyle = c.belly;
  ctx.fill();
  // 耳朵
  if (type !== "hedge") {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * r * 0.62, r * 0.12, r * 0.2, 0, Math.PI * 2);
      ctx.fillStyle = c.dark;
      ctx.fill();
      ctx.stroke();
    }
  }
  // 眼睛
  const ey = r * 0.62, ex = r * 0.3;
  if (dizzy) {
    ctx.strokeStyle = "#10201b";
    ctx.lineWidth = Math.max(2.5, r * 0.07);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * ex - r * 0.1, ey - r * 0.1); ctx.lineTo(s * ex + r * 0.1, ey + r * 0.1);
      ctx.moveTo(s * ex + r * 0.1, ey - r * 0.1); ctx.lineTo(s * ex - r * 0.1, ey + r * 0.1);
      ctx.stroke();
    }
  } else {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * ex, ey, r * 0.11, 0, Math.PI * 2);
      ctx.fillStyle = "#10201b";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s * ex + r * 0.035, ey - r * 0.04, r * 0.04, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    }
    if (type === "hedge") {
      // 皱眉：提醒“别拍我”
      ctx.strokeStyle = "#10201b";
      ctx.lineWidth = Math.max(2, r * 0.06);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(s * (ex + r * 0.16), ey - r * 0.24);
        ctx.lineTo(s * (ex - r * 0.1), ey - r * 0.14);
        ctx.stroke();
      }
    }
  }
  // 鼻子 + 牙
  ctx.beginPath();
  ctx.ellipse(0, r * 0.86, r * 0.17, r * 0.12, 0, 0, Math.PI * 2);
  ctx.fillStyle = type === "hedge" ? "#10201b" : "#ff8fa3";
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.05);
  ctx.strokeStyle = "#10201b";
  ctx.stroke();
  if (type !== "hedge") {
    ctx.fillStyle = "#fff";
    roundRect(ctx, -r * 0.09, r * 0.97, r * 0.18, r * 0.16, 2);
    ctx.fill();
    ctx.stroke();
  }
  // 腮红
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = "#ff8f7a";
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * r * 0.52, r * 0.86, r * 0.13, r * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 金地鼠的闪光
  if (type === "gold") {
    ctx.save();
    ctx.globalAlpha = 0.6 + Math.sin(t * 12) * 0.3;
    ctx.fillStyle = "#fff";
    for (const [sx, sy, sr] of [[-0.7, 0.1, 0.12], [0.75, 0.35, 0.09], [0.1, -0.15, 0.08]]) {
      ctx.beginPath();
      ctx.moveTo(sx * r, (sy - sr) * r);
      ctx.lineTo((sx + sr * 0.3) * r, sy * r);
      ctx.lineTo(sx * r, (sy + sr) * r);
      ctx.lineTo((sx - sr * 0.3) * r, sy * r);
      ctx.fill();
    }
    ctx.restore();
  }
  // 晕乎乎的小星星
  if (dizzy) {
    for (let i = 0; i < 3; i++) {
      const a = t * 7 + (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.6, -r * 0.05 + Math.sin(a) * r * 0.16, r * 0.08, 0, Math.PI * 2);
      ctx.fillStyle = "#ffd166";
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawMole(ctx, hole, m) {
  if (!m || m.prog <= 0.01) return;
  const { x, y, r } = hole;
  const top = y - r * 1.95 * m.prog;
  ctx.save();
  // 只露出洞口以上的部分
  ctx.beginPath();
  ctx.rect(x - r * 2, top - r * 1.5, r * 4, y - (top - r * 1.5));
  ctx.clip();
  const squash = m.phase === "hit" ? 1 - Math.sin(Math.min(1, m.hitT / 0.18) * Math.PI) * 0.22 : 1;
  drawMoleBody(ctx, x, top, r, m.type, { dizzy: m.phase === "hit" && m.type !== "hedge", squash, tilt: m.tilt, t: m.t });
  ctx.restore();
}

function drawHammer(ctx, x, y, size, angle) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(3, size * 0.09);
  ctx.strokeStyle = "#10201b";
  // 柄
  roundRect(ctx, -size * 0.1, 0, size * 0.2, size * 1.05, size * 0.08);
  ctx.fillStyle = "#f9b233";
  ctx.fill();
  ctx.stroke();
  // 锤头
  roundRect(ctx, -size * 0.62, -size * 0.36, size * 1.24, size * 0.62, size * 0.22);
  ctx.fillStyle = "#e2542f";
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#fffaf0";
  roundRect(ctx, -size * 0.18, -size * 0.36, size * 0.36, size * 0.62, 2);
  ctx.fill();
  ctx.beginPath();
  roundRect(ctx, -size * 0.62, -size * 0.36, size * 1.24, size * 0.62, size * 0.22);
  ctx.stroke();
  ctx.restore();
}

export default {
  _inspect: () => S, // 调试用：读当前局面
  id: "mole",
  name: "打地鼠",
  tag: "反应速度 · 跨中线",
  unit: "分",
  age: "3–10",
  duration: DURATION,
  lives: 0,
  isNew: true,
  sense: "视觉—动作",
  intensity: 2,
  theme: { color: "#3bb273", deep: "#1f7a45", bg: ["#bfe8a8", "#3d8a52"] },
  palette: PAL,
  pitch: "地鼠冒头就拍，看谁出手快",
  tagline: "地洞围着你摆一圈，地鼠一冒头就伸手拍，看到刺猬要忍住！",
  howto: [
    "地鼠从你身边的洞里冒出来，伸手过去拍它的脑袋。",
    "金色地鼠分数翻三倍；左边右边轮流出，要跨过身体去够。",
    "皱眉头的刺猬不能拍，忍住不拍还有奖励。",
  ],
  stars: [800, 2800, 5500],
  needsHands: true,

  cover(ctx, w, h) {
    drawMeadow(ctx, w, h);
    const holes = [
      { x: w * 0.17, y: h * 0.62, r: h * 0.12 },
      { x: w * 0.83, y: h * 0.44, r: h * 0.11 },
      { x: w * 0.8, y: h * 0.86, r: h * 0.1 },
    ];
    holes.forEach((hh, i) => {
      drawHoleBack(ctx, hh);
      drawMole(ctx, hh, { prog: i === 2 ? 0.7 : 1, phase: "up", type: i === 1 ? "gold" : i === 2 ? "hedge" : "normal", tilt: i ? 0.1 : -0.1, t: 0.4 });
      drawHoleFront(ctx, hh);
    });
    const P = presetPose(w, h, "slash");
    drawAvatar(ctx, P, { palette: PAL, inkW: 5 });
    drawHammer(ctx, P.rWri.x, P.rWri.y - 8, h * 0.13, 0.5);
  },

  start(rt) {
    S = blank();
    rt.score = 0;
    rt.setScore(0);
    updateAnchor(rt, rt.frame, 1);
    rt.say("地鼠冒头就拍它！", { ms: 2000 });
  },

  update(dt, f, rt) {
    if (!S) return;
    S.t += dt;
    updateAnchor(rt, f, dt);
    S.diff = clamp(S.diff + dt * 0.004, 0, 1);
    S.stun = Math.max(0, S.stun - dt);

    // 出地鼠
    const active = S.holes.filter((h) => h.mole && h.mole.phase !== "hit").length;
    const maxActive = S.t < 10 ? 1 : S.t < 30 ? (S.diff > 0.35 ? 2 : 1) : (S.diff > 0.6 ? 3 : 2);
    S.spawnT -= dt;
    if (S.spawnT <= 0 && active < maxActive) {
      spawnMole(rt);
      S.spawnT = lerp(1.0, 0.36, S.diff) * rand(1.25, 0.8);
    }
    if (active === 0 && S.spawnT > 0.5) S.spawnT = 0.5; // 别让屏幕空太久

    // 手
    for (let i = 0; i < 2; i++) {
      const h = S.hands[i];
      const raw = f && f.ok ? f.hands[i] : null;
      h.swing = Math.max(0, h.swing - dt * 4);
      if (!raw) { h.has = false; continue; }
      h.px = h.has ? h.x : raw.x;
      h.py = h.has ? h.y : raw.y;
      h.x = raw.x;
      h.y = raw.y;
      h.has = true;
      h.speed = Math.hypot(h.x - h.px, h.y - h.py) / Math.max(dt, 0.008);
    }

    // 地鼠动画 + 拍中检测
    for (const hole of S.holes) {
      const m = hole.mole;
      if (!m) continue;
      m.t += dt;
      if (m.phase === "rise") {
        m.prog = Math.min(1, m.prog + dt / 0.16);
        if (m.prog >= 1) { m.phase = "up"; m.t = 0; }
      } else if (m.phase === "up") {
        if (m.t >= m.upTime) m.phase = "down";
      } else if (m.phase === "down") {
        m.prog -= dt / 0.18;
        if (m.prog <= 0) {
          if (m.type === "hedge") {
            S.hedgeSkip++;
            S.score += 30;
            rt.setScore(S.score);
            S.pops.push({ text: "忍住了 +30", x: hole.x, y: hole.y - hole.r * 1.6, t: 0, color: "#8ef0a8" });
          } else {
            S.missed++;
            S.combo = 0;
            S.diff = clamp(S.diff - 0.07, 0, 1);
          }
          hole.mole = null;
          continue;
        }
      } else if (m.phase === "hit") {
        m.hitT += dt;
        if (m.hitT > 0.5) m.prog -= dt / 0.14;
        if (m.prog <= 0) { hole.mole = null; continue; }
      }

      if (S.stun <= 0 && (m.phase === "up" || (m.phase === "rise" && m.prog > 0.45))) {
        const head = { x: hole.x, y: hole.y - hole.r * 1.25 * m.prog };
        const R = hole.r * 1.08;
        for (let i = 0; i < 2; i++) {
          const h = S.hands[i];
          if (!h.has) continue;
          const d = Math.hypot(h.x - head.x, h.y - head.y);
          if (d > R) continue;
          const dPrev = Math.hypot(h.px - head.x, h.py - head.y);
          // 要“拍下去”才算：手从外面进来，或者手在动。手一直放在洞口守株待兔不算
          if (dPrev > R || h.speed > 240) {
            hitMole(rt, hole, i);
            break;
          }
        }
      }
    }

    S.parts.update(dt);
    for (let i = S.pops.length - 1; i >= 0; i--) {
      const p = S.pops[i];
      p.t += dt;
      p.y -= dt * 50;
      if (p.t > 1) S.pops.splice(i, 1);
    }
  },

  draw(ctx, rt) {
    if (!S) return;
    const { W, H } = rt;
    const f = rt.frame;
    const hasCam = rt.camera(1, "saturate(0.85) brightness(1.04)");
    if (!hasCam) drawMeadow(ctx, W, H);
    else {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "rgba(143,211,244,0.18)");
      g.addColorStop(0.6, "rgba(120,200,110,0.06)");
      g.addColorStop(1, "rgba(62,140,70,0.45)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // 地洞和地鼠
    for (const hole of S.holes) {
      drawHoleBack(ctx, hole);
      drawMole(ctx, hole, hole.mole);
      drawHoleFront(ctx, hole);
      // 快缩回去了：在洞口画一圈倒计时
      const m = hole.mole;
      if (m && m.phase === "up" && m.type !== "hedge") {
        const left = clamp(1 - m.t / m.upTime, 0, 1);
        ctx.save();
        ctx.strokeStyle = left < 0.35 ? "#ff6b5a" : "rgba(255,250,240,0.85)";
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.ellipse(hole.x, hole.y + hole.r * 0.08, hole.r * 1.55, hole.r * 0.66, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 小人
    if (f && f.ok) {
      const k = fitScale(f.bodyScale, H, 0.66);
      ctx.save();
      if (k < 0.99 && f.shoulder) {
        ctx.translate(f.shoulder.x, f.shoulder.y);
        ctx.scale(k, k);
        ctx.translate(-f.shoulder.x, -f.shoulder.y);
      }
      drawAvatar(ctx, f.pts, { palette: PAL, alpha: 0.92, inkW: Math.max(3, f.bodyScale * 0.045) });
      ctx.restore();
    } else {
      drawAvatar(ctx, standingJoints(W / 2, H * 0.88, Math.min(H * 0.55, W * 0.55)), { palette: PAL, alpha: 0.28, showFace: false, inkW: 4 });
    }

    // 锤子跟着手
    const size = clamp((S.anchor?.s || 100) * 0.42, 30, 70);
    for (let i = 0; i < 2; i++) {
      const h = S.hands[i];
      if (!h.has) continue;
      const side = i === 0 ? -1 : 1;
      if (S.stun > 0) {
        // 被扎晕：锤子歪着、半透明，头上转小星星
        ctx.save();
        ctx.globalAlpha = 0.45;
        drawHammer(ctx, h.x, h.y - size * 0.1, size, side * (1.6 + Math.sin(S.t * 20) * 0.2));
        ctx.restore();
        for (let k = 0; k < 3; k++) {
          const a = S.t * 8 + (k * Math.PI * 2) / 3;
          ctx.beginPath();
          ctx.arc(h.x + Math.cos(a) * size * 0.5, h.y - size * 0.9 + Math.sin(a) * size * 0.15, size * 0.1, 0, Math.PI * 2);
          ctx.fillStyle = "#ffd166";
          ctx.fill();
        }
        continue;
      }
      const ang = side * (0.5 - h.swing * 1.1);
      drawHammer(ctx, h.x, h.y - size * 0.1, size, ang);
    }

    S.parts.draw(ctx);

    for (const p of S.pops) {
      const a = clamp(1 - (p.t - 0.6) / 0.4, 0, 1);
      const sc = 1 + Math.max(0, 0.25 - p.t) * 1.6;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(sc, sc);
      outlineText(ctx, p.text, 0, 0, { size: p.big ? 34 : 26, fill: p.color, alpha: a });
      if (p.sub) outlineText(ctx, p.sub, 0, 26, { size: 15, alpha: a });
      ctx.restore();
    }

    if (S.combo >= 3) {
      outlineText(ctx, `${S.combo} 连击`, W / 2, H - 46, { size: 26, fill: "#ffd166" });
    }

    if (!S.hands.some((h) => h.has)) {
      outlineText(ctx, "把手抬起来，让摄像头看见", W / 2, H * 0.2, { size: 20 });
    }
  },

  finish() {
    const s = S || blank();
    const normalSeen = s.hits + s.missed;
    const hitRate = normalSeen ? s.hits / normalSeen : 0;
    const hedgeSeen = s.hedgeHit + s.hedgeSkip;
    const holdRate = hedgeSeen ? s.hedgeSkip / hedgeSeen : 1;
    const avgReact = s.react.length ? s.react.reduce((a, b) => a + b, 0) / s.react.length : 0;
    const good = s.score >= 2800;
    return {
      score: s.score,
      headline: s.score >= 5500 ? "锤子快如闪电！" : good ? "眼疾手快！" : "地鼠被你吓坏了",
      desc: good
        ? "看到就拍、刺猬也忍得住，眼睛和手配合得又快又稳。"
        : "已经找到感觉了。下次两只手都举在胸前，哪边冒头就用哪边的手。",
      rows: [
        { label: "拍到地鼠", value: `${s.hits} 只` },
        { label: "金地鼠", value: `${s.golds} 只` },
        { label: "最高连击", value: `${s.bestCombo} 次` },
        { label: "平均出手", value: avgReact ? `${avgReact.toFixed(2)} 秒` : "—" },
        { label: "忍住刺猬", value: hedgeSeen ? `${s.hedgeSkip} / ${hedgeSeen}` : "—" },
      ],
      sensory: [
        { label: "视觉—动作", value: clamp(hitRate, 0.05, 1) },
        { label: "抑制控制", value: clamp(holdRate, 0.05, 1) },
        { label: "跨中线", value: clamp(s.cross / Math.max(5, s.hits * 0.3), 0.05, 1) },
      ],
      tip: holdRate < 0.6
        ? "小提示：刺猬拍得有点多。可以先玩一局「只看不拍」，让孩子大声喊出「地鼠」「刺猬」，再上手。"
        : "小提示：让孩子把双手放在肚子前当「起点」，每次拍完都回到起点，出手会更快、更有节奏。",
    };
  },
};

/* 首页插画复用 */
export { drawMeadow, drawHoleBack, drawHoleFront, drawMole, drawHammer };
