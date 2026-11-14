/* 水果忍者 —— 双手当刀，划开飞起来的水果。
   练的是：手眼协调、视觉追踪、跨中线动作。 */

import { clamp, lerp, rand, pick, dist, Particles, roundRect, easeOutCubic, easeOutBack } from "../kit.js";
import { drawAvatar, PALETTES, presetPose, fitScale } from "../avatar.js";

const DURATION = 60;
const G = 1500;

const KINDS = {
  watermelon: { r: 62, juice: "#ff4d6d", rind: "#2f9e5f", flesh: "#ff5c72", seed: "#2a1c17" },
  orange: { r: 46, juice: "#ff9f2e", rind: "#f08a1e", flesh: "#ffb547", seed: null },
  strawberry: { r: 42, juice: "#ff3b5c", rind: "#e8264a", flesh: "#ff6b81", seed: "#fff2c2" },
  kiwi: { r: 44, juice: "#a8d94a", rind: "#8a5a2b", flesh: "#b9e05a", seed: "#22301c" },
  bomb: { r: 46, juice: "#333", rind: "#1b1b28", flesh: "#333", seed: null },
};

let S = null;

function blank() {
  return {
    fruits: [],
    halves: [],
    splats: [],
    parts: new Particles(300),
    score: 0,
    combo: 0,
    bestCombo: 0,
    comboT: 0,
    comboText: null,
    lives: 3,
    cuts: 0,
    missed: 0,
    bombs: 0,
    cross: 0,
    spawnT: 0,
    spawnGap: 0.82,
    t: 0,
    hands: [
      { x: 0, y: 0, px: 0, py: 0, has: false, trail: [], cool: 0 },
      { x: 0, y: 0, px: 0, py: 0, has: false, trail: [], cool: 0 },
    ],
    lastFrameT: -1,
    flashBomb: 0,
    banner: null,
  };
}

function segCircle(a, b, c, r) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((c.x - a.x) * dx + (c.y - a.y) * dy) / len2;
  t = clamp(t, 0, 1);
  const px = a.x + dx * t, py = a.y + dy * t;
  return Math.hypot(px - c.x, py - c.y) <= r;
}

function spawn(rt, n = 1, forceType = null) {
  const { W, H } = rt;
  const f = rt.frame;
  const sho = f && f.shoulder;
  const hip = f && f.hip;
  // 让水果最高点落在孩子的胸口到腰之间，保证够得着
  const apexY = sho && hip && sho.y > 60 && hip.y > sho.y
    ? (sho.y + hip.y * 1.1) / 2
    : H * 0.5;
  for (let i = 0; i < n; i++) {
    const type = forceType || (Math.random() < 0.09 && S.t > 8 ? "bomb" : pick(["watermelon", "orange", "strawberry", "kiwi", "orange", "watermelon"]));
    const k = KINDS[type];
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = W * 0.5 + side * rand(W * 0.26, W * 0.05) + rand(40, -40);
    const rise = Math.max(180, H + k.r - apexY);
    const vy = -Math.sqrt(2 * G * rise);
    S.fruits.push({
      type,
      x,
      y: H + k.r + 8,
      vx: -side * rand(180, 40) - (x - W / 2) * 0.2,
      vy,
      r: k.r * clamp(W / 1200, 0.9, 1.25),
      rot: rand(6.28, 0),
      spin: rand(1.6, -1.6),
      sliced: false,
    });
  }
}

function slice(rt, f, x, y) {
  const k = KINDS[f.type];
  f.sliced = true;
  S.splats.push({ x, y, r: f.r * rand(1.1, 0.7), color: k.juice, rot: rand(6.28, 0), t: 0, life: 4.2 });
  if (S.splats.length > 16) S.splats.shift();
  S.parts.burst(x, y, 14, { color: [k.juice, k.flesh, "#fff"], life: rand(0.7, 0.36), size: rand(9, 3), power: 1.1, g: 900, drag: 1.3 });

  if (f.type === "bomb") {
    S.bombs++;
    S.lives--;
    S.combo = 0;
    rt.setLives(S.lives);
    rt.lives = S.lives;
    rt.kick(30);
    rt.flash("#ff4b3e", 0.5);
    rt.audio.sfx("bomb");
    rt.say("炸弹！", { alert: true, ms: 1000 });
    S.flashBomb = 1;
    S.parts.burst(x, y, 26, { color: ["#ffb547", "#ff5a3c", "#333"], life: rand(1.1, 0.5), size: rand(16, 6), power: 2, g: 600 });
    if (S.lives <= 0) setTimeout(() => { if (rt.state === "playing") rt.finish(); }, 800);
    return;
  }

  S.cuts++;
  S.combo++;
  S.bestCombo = Math.max(S.bestCombo, S.combo);
  S.comboT = 2.6;
  const mult = 1 + Math.min(20, S.combo - 1) * 0.1;
  const gain = Math.round(50 * mult);
  S.score += gain;

  // 双手交替 / 跨中线
  if (Math.abs(x - rt.W / 2) < rt.W * 0.16) S.cross++;
  S.comboText = { text: S.combo > 1 ? `${S.combo} 连击  +${gain}` : `+${gain}`, x, y: y - 40, t: 0, big: S.combo > 3 };

  rt.audio.sfx(S.combo > 2 ? "combo" : "slice");
  rt.setScore(S.score);

  // 两半水果
  const ang = rand(6.28, 0);
  for (const s of [-1, 1]) {
    S.halves.push({
      type: f.type,
      x: f.x, y: f.y,
      vx: f.vx + Math.cos(ang) * 260 * s,
      vy: f.vy * 0.55 + Math.sin(ang) * 160 * s - 80,
      rot: ang,
      spin: rand(3, -3) + s * 2,
      r: f.r,
      side: s,
      life: 2.4,
    });
  }
}

/* 没有摄像头时的夜市背景（鼠标模式） */
function drawBackdrop(ctx, W, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#241a49");
  g.addColorStop(0.5, "#2a1c3f");
  g.addColorStop(0.8, "#170f26");
  g.addColorStop(1, "#0a0913");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 星星
  ctx.save();
  ctx.fillStyle = "rgba(255,240,220,0.8)";
  for (let i = 0; i < 26; i++) {
    const x = (W * ((i * 61.7) % 1));
    const y = H * 0.5 * ((i * 37.3) % 1);
    ctx.globalAlpha = 0.15 + ((i * 17) % 60) / 120;
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.restore();

  // 月亮
  const mx = W * 0.83, my = H * 0.17, mr = Math.min(W, H) * 0.062;
  const mg = ctx.createRadialGradient(mx, my, mr * 0.4, mx, my, mr * 3.4);
  mg.addColorStop(0, "rgba(255,240,205,0.55)");
  mg.addColorStop(0.35, "rgba(255,230,190,0.16)");
  mg.addColorStop(1, "rgba(255,230,190,0)");
  ctx.fillStyle = mg;
  ctx.beginPath();
  ctx.arc(mx, my, mr * 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(mx, my, mr, 0, Math.PI * 2);
  ctx.fillStyle = "#fff6df";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(mx - mr * 0.32, my - mr * 0.28, mr * 0.15, 0, Math.PI * 2);
  ctx.arc(mx + mr * 0.3, my + mr * 0.25, mr * 0.09, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(226,206,170,0.45)";
  ctx.fill();

  // 屋顶剪影
  ctx.fillStyle = "#100c1e";
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let i = 0; i <= 16; i++) {
    const x0 = (W * i) / 16;
    const hgt = H * (0.05 + ((i * 29) % 7) / 100);
    ctx.lineTo(x0, H * 0.79 - hgt);
    ctx.lineTo(x0 + W / 16, H * 0.79 - hgt);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();

  // 窗户
  ctx.fillStyle = "rgba(255,186,104,0.55)";
  for (let i = 0; i < 44; i++) {
    const x = W * ((i * 71.3) % 1);
    const y = H * (0.7 + ((i * 19) % 9) / 100);
    if (Math.sin(i * 3.1) > 0.05) ctx.fillRect(x, y, 3, 4);
  }

  // 灯笼
  for (const [lx, ly, lr] of [[W * 0.07, H * 0.12, 16], [W * 0.15, H * 0.07, 12], [W * 0.94, H * 0.09, 14]]) {
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(lx, 0);
    ctx.lineTo(lx, ly - lr);
    ctx.stroke();
    const lg = ctx.createRadialGradient(lx, ly, 2, lx, ly, lr * 3);
    lg.addColorStop(0, "rgba(255,140,80,0.5)");
    lg.addColorStop(1, "rgba(255,140,80,0)");
    ctx.fillStyle = lg;
    ctx.beginPath(); ctx.arc(lx, ly, lr * 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.ellipse(lx, ly, lr * 0.8, lr, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#e2542f";
    ctx.fill();
    ctx.restore();
  }

  // 地面
  const fg = ctx.createLinearGradient(0, H * 0.79, 0, H);
  fg.addColorStop(0, "rgba(120,80,180,0.22)");
  fg.addColorStop(1, "rgba(10,9,19,0)");
  ctx.fillStyle = fg;
  ctx.fillRect(0, H * 0.79, W, H * 0.21);
}

function drawFruitBody(ctx, type, r) {  const k = KINDS[type];
  ctx.save();
  ctx.strokeStyle = "#0b0b12";
  ctx.lineWidth = Math.max(3, r * 0.1);
  ctx.lineJoin = "round";

  if (type === "watermelon") {
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = k.rind; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.84, 0, Math.PI * 2);
    ctx.fillStyle = k.flesh; ctx.fill();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.07, r * 0.11, a, 0, Math.PI * 2);
      ctx.fillStyle = k.seed; ctx.fill();
    }
  } else if (type === "orange") {
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = k.rind; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(-r * 0.12, -r * 0.14, r * 0.72, 0, Math.PI * 2);
    ctx.fillStyle = k.flesh; ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = Math.max(1.5, r * 0.05);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7);
      ctx.stroke();
    }
  } else if (type === "strawberry") {
    ctx.beginPath();
    ctx.moveTo(0, r);
    ctx.bezierCurveTo(-r * 1.1, r * 0.2, -r * 0.9, -r * 0.9, 0, -r * 0.85);
    ctx.bezierCurveTo(r * 0.9, -r * 0.9, r * 1.1, r * 0.2, 0, r);
    ctx.closePath();
    ctx.fillStyle = k.rind; ctx.fill(); ctx.stroke();
    ctx.fillStyle = k.seed;
    for (let i = 0; i < 9; i++) {
      const a = rand(6.28, 0), rr = rand(r * 0.75, 0);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr * 0.8, r * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, -r * 0.78);
    ctx.lineTo(0, -r * 1.15);
    ctx.lineTo(r * 0.5, -r * 0.78);
    ctx.closePath();
    ctx.fillStyle = "#3fa14f"; ctx.fill(); ctx.stroke();
  } else if (type === "kiwi") {
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = k.rind; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2);
    ctx.fillStyle = k.flesh; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
    ctx.fillStyle = "#f4f7dd"; ctx.fill();
    ctx.fillStyle = k.seed;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.2;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4, r * 0.035, r * 0.06, a, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // 炸弹
    const pulse = 0.85 + Math.sin(performance.now() / 120) * 0.15;
    const g = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 1.5);
    g.addColorStop(0, "rgba(255,80,60,0.42)");
    g.addColorStop(1, "rgba(255,80,60,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.5 * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = "#3a3348"; ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-r * 0.3, -r * 0.32, r * 0.32, r * 0.22, -0.6, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.fill();
    // 红圈
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,90,70,0.75)";
    ctx.lineWidth = Math.max(3, r * 0.09);
    ctx.stroke();
    // 引线
    ctx.beginPath();
    ctx.moveTo(r * 0.35, -r * 0.7);
    ctx.quadraticCurveTo(r * 0.9, -r * 1.15, r * 0.6, -r * 1.45);
    ctx.strokeStyle = "#e8b04b";
    ctx.lineWidth = Math.max(3, r * 0.1);
    ctx.stroke();
    // 火花
    ctx.beginPath();
    ctx.arc(r * 0.6, -r * 1.5, r * 0.15 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = "#ffd166";
    ctx.fill();
  }
  ctx.restore();
}

export default {
  id: "fruit",
  name: "水果忍者",
  tag: "手眼协调 · 跨中线",
  unit: "分",
  age: "4–12",
  duration: DURATION,
  lives: 3,
  tagline: "挥手切飞起来的水果，连击越高分越多，千万别碰炸弹。",
  howto: [
    "用手当刀：手划过水果就切开了，左右手都行。",
    "连续切中会累积「连击」，倍率越高，一颗水果越值钱。",
    "黑炸弹不能碰，碰到少一颗心；水果掉下去不算失败，但连击会断。",
  ],
  stars: [1600, 3200],
  needsHands: true,

  cover(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#1b1233");
    g.addColorStop(1, "#0b0b16");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // 灯笼光斑
    for (let i = 0; i < 7; i++) {
      const x = rand(w, 0), y = rand(h * 0.7, 0), r = rand(60, 16);
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, "rgba(255,140,80,0.32)");
      rg.addColorStop(1, "rgba(255,140,80,0)");
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // 水果
    ctx.save();
    ctx.translate(w * 0.2, h * 0.32); ctx.rotate(0.4); drawFruitBody(ctx, "watermelon", 40); ctx.restore();
    ctx.save();
    ctx.translate(w * 0.34, h * 0.68); ctx.rotate(-0.2); drawFruitBody(ctx, "orange", 30); ctx.restore();
    ctx.save();
    ctx.translate(w * 0.86, h * 0.3); ctx.rotate(0.8); drawFruitBody(ctx, "strawberry", 26); ctx.restore();

    drawAvatar(ctx, presetPose(w, h, "slash"), { palette: PALETTES.neon, inkW: 5 });

    // 刀光
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(w * 0.52, h * 0.42);
    ctx.quadraticCurveTo(w * 0.66, h * 0.3, w * 0.78, h * 0.22);
    ctx.stroke();
    ctx.restore();
  },

  start(rt) {
    S = blank();
    rt.score = 0;
    rt.setScore(0);
    rt.setLives(3);
    rt.lives = 3;
    rt.say("用手碰一下水果就切开！", { ms: 2200 });
    spawn(rt, 2);
  },

  update(dt, f, rt) {
    if (!S) return;
    S.t += dt;
    S.spawnT -= dt;
    if (S.flashBomb > 0) S.flashBomb = Math.max(0, S.flashBomb - dt * 2);
    if (S.banner) { S.banner.t += dt; if (S.banner.t > 1.6) S.banner = null; }

    // 难度爬升
    // 难度爬升：一开始慢一点，后面密一点，但始终比之前更容易摸到
    S.spawnGap = lerp(0.66, 0.38, clamp(S.t / DURATION, 0, 1));
    if (S.spawnT <= 0) {
      S.spawnT = S.spawnGap * rand(1.1, 0.85);
      const n = S.t > 4 && Math.random() < 0.45 ? 2 : 1;
      spawn(rt, n);
    }

    // 屏幕上空太久，补一颗，别让孩子挥空
    if (S.fruits.length === 0 && S.t > 1.2) {
      spawn(rt, 1);
      S.spawnT = Math.min(S.spawnT, 0.3);
    }

    // 手
    if (f && f.ok) {
      for (let i = 0; i < 2; i++) {
        const raw = f.hands[i];
        const h = S.hands[i];
        if (!raw) { h.has = false; h.trail.length = 0; continue; }
        h.px = h.has ? h.x : raw.x;
        h.py = h.has ? h.y : raw.y;
        h.x = raw.x;
        h.y = raw.y;
        h.has = true;
        const v = Math.hypot(h.x - h.px, h.y - h.py) / Math.max(dt, 0.008);
        if (v > 120) {
          h.trail.push({ x: h.x, y: h.y, t: S.t });
          if (h.trail.length > 9) h.trail.shift();
        } else if (h.trail.length) {
          h.trail.shift();
        }
        h.speed = v;
      }
    } else {
      S.hands.forEach((h) => { h.has = false; h.trail.length = 0; });
    }

    // 切中检测：轻轻碰上也切得开，快速划过切得更远
    for (const h of S.hands) {
      if (!h.has) continue;
      const a = { x: h.px, y: h.py };
      const b = { x: h.x, y: h.y };
      const fast = (h.speed ?? 0) >= 320;
      for (const fr of S.fruits) {
        if (fr.sliced) continue;
        if (fr.type === "bomb") {
          // 炸弹只有“快速划过”才会炸，手放在旁边扫到不算
          if (fast && segCircle(a, b, fr, fr.r * 1.05)) slice(rt, fr, fr.x, fr.y);
          continue;
        }
        const touch = Math.hypot(h.x - fr.x, h.y - fr.y) < fr.r * 0.95;
        const swiped = fast && segCircle(a, b, fr, fr.r * 1.05);
        if (touch || swiped) slice(rt, fr, fr.x, fr.y);
      }
    }

    // 物理
    for (let i = S.fruits.length - 1; i >= 0; i--) {
      const fr = S.fruits[i];
      fr.vy += G * dt;
      fr.x += fr.vx * dt;
      fr.y += fr.vy * dt;
      fr.rot += fr.spin * dt;
      if (fr.sliced || fr.y - fr.r > rt.H + 80) {
        if (!fr.sliced && fr.type !== "bomb") {
          S.missed++;
          if (S.combo > 0) S.banner = { text: "连击断了", t: 0, sub: "" };
          S.combo = 0;
        }
        S.fruits.splice(i, 1);
      }
    }

    for (let i = S.halves.length - 1; i >= 0; i--) {
      const hf = S.halves[i];
      hf.vy += G * 0.8 * dt;
      hf.x += hf.vx * dt;
      hf.y += hf.vy * dt;
      hf.rot += hf.spin * dt;
      hf.life -= dt;
      if (hf.life <= 0) S.halves.splice(i, 1);
    }

    for (let i = S.splats.length - 1; i >= 0; i--) {
      S.splats[i].t += dt;
      if (S.splats[i].t > S.splats[i].life) S.splats.splice(i, 1);
    }

    if (S.comboT > 0) {
      S.comboT -= dt;
      if (S.comboT <= 0) S.combo = 0;
    }
    if (S.comboText) {
      S.comboText.t += dt;
      S.comboText.y -= dt * 46;
      if (S.comboText.t > 0.9) S.comboText = null;
    }

    S.parts.update(dt);
  },

  draw(ctx, rt) {
    if (!S) return;
    const { W, H } = rt;

    const hasCam = rt.camera(0.95, "saturate(0.55) brightness(0.92) contrast(1.02)");
    if (!hasCam) {
      drawBackdrop(ctx, W, H);
    } else {
      // 夜色：只压一点点，保证孩子看得见自己
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "rgba(27,18,51,0.42)");
      g.addColorStop(0.6, "rgba(11,11,22,0.2)");
      g.addColorStop(1, "rgba(11,11,22,0.6)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // 四周压暗一点，把注意力收在中间，但不挡人
    if (hasCam) {
      const vig = ctx.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.32, W / 2, H * 0.5, Math.max(W, H) * 0.72);
      vig.addColorStop(0, "rgba(8,6,18,0)");
      vig.addColorStop(1, "rgba(8,6,18,0.55)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);
    }

    // 光斑（只在有摄像头时加，避免和假场景打架）
    if (hasCam) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 6; i++) {
        const x = (W * ((i * 0.37 + 0.11) % 1));
        const y = (H * ((i * 0.53 + 0.08) % 0.8));
        const r = Math.min(W, H) * (0.1 + (i % 3) * 0.05);
        const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
        rg.addColorStop(0, i % 2 ? "rgba(255,120,60,0.14)" : "rgba(120,80,255,0.12)");
        rg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    // 果汁印
    for (const s of S.splats) {
      const fade = clamp(1 - s.t / s.life, 0, 1);
      ctx.save();
      ctx.globalAlpha = fade * 0.3;
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, s.r * 0.55, s.r * 0.46, 0, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 5; i++) {
        const a2 = (i / 5) * Math.PI * 2 + 0.3;
        const rr = s.r * (0.6 + (i % 3) * 0.12);
        ctx.beginPath();
        ctx.ellipse(Math.cos(a2) * rr, Math.sin(a2) * rr * 0.86, s.r * 0.2, s.r * 0.15, a2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 水果
    for (const fr of S.fruits) {
      if (fr.sliced) continue;
      ctx.save();
      ctx.translate(fr.x, fr.y);
      ctx.rotate(fr.rot);
      drawFruitBody(ctx, fr.type, fr.r);
      ctx.restore();
    }

    // 切半
    for (const hf of S.halves) {
      const a = clamp(hf.life / 0.5, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(hf.x, hf.y);
      ctx.rotate(hf.rot);
      ctx.beginPath();
      ctx.arc(0, 0, hf.r, hf.side > 0 ? 0 : Math.PI, hf.side > 0 ? Math.PI : Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      drawFruitBody(ctx, hf.type, hf.r);
      ctx.restore();
    }

    S.parts.draw(ctx);

    // 刀光 / 手的位置
    for (const h of S.hands) {
      if (!h.has) continue;
      if (h.trail.length < 2) {
        ctx.save();
        const pulse = 1 + Math.sin(S.t * 6) * 0.1;
        const glow = ctx.createRadialGradient(h.x, h.y, 2, h.x, h.y, 58 * pulse);
        glow.addColorStop(0, "rgba(142,240,255,0.35)");
        glow.addColorStop(1, "rgba(142,240,255,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(h.x, h.y, 58 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(h.x, h.y, 20, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(h.x, h.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.restore();
        continue;
      }
      const tr = h.trail;
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 1; i < tr.length; i++) {
          const t = i / tr.length;
          ctx.globalAlpha = pass === 0 ? 0.18 : 0.95;
          ctx.strokeStyle = pass === 0 ? "#8ef0ff" : "#ffffff";
          ctx.lineWidth = (pass === 0 ? 26 : 9) * t;
          ctx.beginPath();
          ctx.moveTo(tr[i - 1].x, tr[i - 1].y);
          ctx.lineTo(tr[i].x, tr[i].y);
          ctx.stroke();
        }
      }
      // 手点
      const last = tr[tr.length - 1];
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(last.x, last.y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // 连击字
    if (S.comboText) {
      const c = S.comboText;
      const a = clamp(1 - (c.t - 0.5) / 0.4, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(c.x, c.y);
      const sc = 1 + Math.max(0, 0.4 - c.t) * 0.8;
      ctx.scale(sc, sc);
      ctx.font = `900 ${c.big ? 40 : 30}px "KuaiLe","MiSans","PingFang SC","Microsoft YaHei",sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 8;
      ctx.strokeStyle = "#0b0b16";
      ctx.strokeText(c.text, 0, 0);
      ctx.fillStyle = c.big ? "#ffd166" : "#fff";
      ctx.fillText(c.text, 0, 0);
      ctx.restore();
    }

    // 连击条
    if (S.combo >= 2) {
      const bw = 180, bh = 40;
      const x = W / 2 - bw / 2, y = H - 86;
      ctx.save();
      roundRect(ctx, x, y, bw, bh, 20);
      ctx.fillStyle = "rgba(16,16,26,0.72)";
      ctx.fill();
      ctx.strokeStyle = "#ffd166";
      ctx.lineWidth = 2;
      ctx.stroke();
      const w = (bw - 8) * clamp(S.comboT / 2.6, 0, 1);
      roundRect(ctx, x + 4, y + bh - 7, w, 3, 2);
      ctx.fillStyle = "#ffd166";
      ctx.fill();
      ctx.font = '900 19px "KuaiLe","MiSans","PingFang SC",sans-serif';
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      ctx.fillText(`${S.combo} 连击  ×${(1 + Math.min(20, S.combo - 1) * 0.1).toFixed(1)}`, W / 2, y + 25);
      ctx.restore();
    }

    // 没手提示
    if (!S.hands.some((h) => h.has)) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.font = '800 16px "KuaiLe","MiSans","PingFang SC",sans-serif';
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.fillText("把手抬到胸口，让摄像头看见", W / 2, H - 130);
      ctx.restore();
    }

    if (S.flashBomb > 0) {
      ctx.save();
      ctx.globalAlpha = S.flashBomb * 0.35;
      ctx.fillStyle = "#ff3b30";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  },

  finish() {
    const s = S || blank();
    const total = s.cuts + s.missed;
    const acc = total ? Math.round((s.cuts / total) * 100) : 0;
    const stars = s.score >= 3200 ? 3 : s.score >= 1600 ? 2 : 1;
    return {
      score: s.score,
      stars,
      headline: stars === 3 ? "刀光如电！" : stars === 2 ? "切得漂亮！" : "手感来了",
      desc: stars === 3
        ? "切得快、连得多，眼睛和手配合得很好。"
        : stars === 2
          ? "连击已经起来了，下次试试两只手轮流切。"
          : "先追一颗水果，把手臂伸展开，会切得更准。",
      rows: [
        { label: "切中水果", value: `${s.cuts} 个` },
        { label: "最高连击", value: `${s.bestCombo} 个` },
        { label: "命中率", value: `${acc}%` },
        { label: "碰到炸弹", value: `${s.bombs} 次` },
      ],
      sensory: [
        { label: "手眼协调", value: clamp(acc / 100, 0.05, 1) },
        { label: "跨中线动作", value: clamp(s.cross / Math.max(6, s.cuts * 0.25), 0.05, 1) },
        { label: "视觉追踪", value: clamp(s.bestCombo / 12, 0.05, 1) },
      ],
      tip: s.bestCombo >= 8
        ? "小提示：让孩子试试「左手切左边、右手切右边」，再故意让水果飞到另一侧，练跨中线。"
        : "小提示：一开始别追求速度，先让孩子用一只手把水果「送到」另一只手，体会双手配合。",
    };
  },
};
