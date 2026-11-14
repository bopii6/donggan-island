/* 墙来了 —— 一面挖了人形洞的墙朝你飞过来，赶在它撞上之前摆出同样的动作，就能“穿墙而过”。
   练的是：本体觉（不看手也知道手在哪）、动作模仿、动作计划、双侧协调。 */

import { clamp, lerp, pick, Particles, roundRect, easeOutBack, outlineText } from "../kit.js";
import { drawAvatar, presetPose, standingJoints } from "../avatar.js";
import { scorePose, figure, traceFigure, playerAnchor, drawPoseWall, matchColor } from "../poses.js";

const DURATION = 60;
const PAL = { shirt: "#ff6b8b", pants: "#2a2350", skin: "#ffe0c4", hair: "#1a1430", shoe: "#101d19" };

/* 动作库：屏幕坐标里的角度（0° 朝右、90° 朝下、-90° 朝上）。
   L = 屏幕左边那只手（镜像后就是孩子自己的左手）。[上臂, 前臂] */
const POSES = [
  { id: "up", name: "举高高", L: [-105, -96], R: [-75, -84], level: 0 },
  { id: "plane", name: "小飞机", L: [180, 180], R: [0, 0], level: 0 },
  { id: "cheer", name: "大字欢呼", L: [-140, -140], R: [-40, -40], level: 0 },
  { id: "rup", name: "举右手", L: [100, 94], R: [-80, -86], level: 1 },
  { id: "lup", name: "举左手", L: [-100, -94], R: [80, 86], level: 1 },
  { id: "strong", name: "大力士", L: [178, -92], R: [2, -88], level: 1 },
  { id: "squat", name: "蹲下来", L: [115, 75], R: [65, 105], squat: true, level: 1 },
  { id: "super", name: "超人飞", L: [140, 140], R: [-40, -40], level: 2 },
  { id: "seesaw", name: "跷跷板", L: [-145, -145], R: [35, 35], level: 2 },
  { id: "hips", name: "叉腰", L: [125, 40], R: [55, 140], level: 2 },
];

const WALL_COLORS = ["#ff8a5c", "#5bc0eb", "#9b5de5", "#f15bb5", "#2bb3a3", "#f9b233"];

let S = null;

function blank() {
  return {
    t: 0,
    wall: null,
    wallN: 0,
    travel: 5.2,
    gap: 0.9,
    lastPose: null,
    score: 0,
    combo: 0,
    bestCombo: 0,
    passed: 0,
    perfect: 0,
    crashed: 0,
    matchSum: 0,
    asymPass: 0,
    asymSeen: 0,
    squatPass: 0,
    squatSeen: 0,
    match: 0,
    shoulderBase: null,
    parts: new Particles(240),
    pops: [],
    anchor: null,
    off: null,
  };
}

function poseScore(f, pose) {
  return scorePose(f, pose, { y: S.shoulderBase });
}

/* ---------- 墙 ---------- */
function nextWall(rt) {
  S.wallN++;
  const maxLevel = S.wallN <= 3 ? 0 : S.passed >= 6 ? 2 : 1;
  let pool = POSES.filter((p) => p.level <= maxLevel && p.id !== S.lastPose);
  if (S.shoulderBase == null) pool = pool.filter((p) => !p.squat);
  const pose = pick(pool);
  S.lastPose = pose.id;
  S.wall = {
    pose,
    color: WALL_COLORS[(S.wallN - 1) % WALL_COLORS.length],
    phase: "come",
    p: 0,
    t: 0,
    T: S.travel,
    samples: [],
    result: null,
  };
  rt.audio.sfx("whoosh");
  rt.say(`${pose.name}！`, { ms: 1600 });
}

function judgeWall(rt) {
  const w = S.wall;
  const best = w.samples.reduce((m, s) => Math.max(m, s.v), 0);
  const asym = ["rup", "lup", "super", "seesaw"].includes(w.pose.id);
  if (asym) S.asymSeen++;
  if (w.pose.squat) S.squatSeen++;
  S.matchSum += best;
  if (best >= 0.62) {
    const perfect = best >= 0.85;
    w.result = perfect ? "perfect" : "pass";
    w.phase = "pass";
    w.t = 0;
    S.passed++;
    if (perfect) S.perfect++;
    if (asym) S.asymPass++;
    if (w.pose.squat) S.squatPass++;
    S.combo++;
    S.bestCombo = Math.max(S.bestCombo, S.combo);
    const gain = Math.round((perfect ? 150 : 100) * (1 + Math.min(10, S.combo - 1) * 0.1));
    S.score += gain;
    rt.setScore(S.score);
    rt.audio.sfx("pass");
    S.travel = Math.max(3.0, S.travel * 0.93);
    const cx = rt.W / 2, cy = rt.H * 0.42;
    S.pops.push({ text: perfect ? "一模一样！" : "穿过去啦！", sub: `+${gain}`, x: cx, y: cy, t: 0, color: perfect ? "#ffd166" : "#8ef0a8" });
    S.parts.burst(cx, cy, 26, { color: ["#ffd166", "#fff", w.color], shape: "star", life: 0.9, size: 12, power: 1.4 });
    if (perfect || S.combo % 3 === 0) rt.cheer();
  } else {
    w.result = "crash";
    w.phase = "crash";
    w.t = 0;
    S.crashed++;
    S.combo = 0;
    S.travel = Math.min(5.6, S.travel * 1.1);
    rt.audio.sfx("crash");
    rt.kick(22);
    rt.say("撞墙啦，下一面加油", { ms: 1500 });
    S.pops.push({ text: "撞墙啦", sub: best > 0.4 ? "差一点点" : "", x: rt.W / 2, y: rt.H * 0.36, t: 0, color: "#ff8a7a" });
    for (let i = 0; i < 18; i++) {
      S.parts.spawn({
        x: lerp(rt.W * 0.2, rt.W * 0.8, Math.random()), y: lerp(rt.H * 0.2, rt.H * 0.7, Math.random()),
        vx: (Math.random() - 0.5) * 400, vy: -Math.random() * 300, g: 1200, life: 1, size: 14, color: w.color, shape: "rect",
      });
    }
  }
}

function drawWall(ctx, rt, sigma, alpha, shakeX = 0, dropY = 0) {
  const w = S.wall;
  drawPoseWall(ctx, rt, {
    pose: w.pose,
    color: w.color,
    anchor: S.anchor,
    sigma,
    alpha,
    shakeX,
    dropY,
    ring: w.phase === "come" ? matchColor(S.match) : "#fffaf0",
    cache: S,
  });
}

function drawPoseCard(ctx, rt) {
  const w = S.wall;
  if (!w) return;
  const x = 16, y = 96, cw = 150, ch = 170;
  ctx.save();
  roundRect(ctx, x, y, cw, ch, 18);
  ctx.fillStyle = "rgba(255,250,240,0.95)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#10201b";
  ctx.stroke();
  const fig = figure(w.pose, x + cw / 2, y + 44, 22);
  ctx.fillStyle = w.color;
  ctx.strokeStyle = w.color;
  traceFigure(ctx, fig, (p) => p, 1, 0);
  ctx.restore();
  outlineText(ctx, w.pose.name, x + cw / 2, y + ch - 22, { size: 22, fill: "#10201b", stroke: "rgba(255,250,240,0)", line: 0 });
  outlineText(ctx, `第 ${S.wallN} 面墙`, x + cw / 2, y - 12, { size: 14 });
}

export default {
  _inspect: () => S, // 调试用：读当前局面
  id: "wall",
  name: "墙来了",
  tag: "本体觉 · 动作模仿",
  unit: "分",
  age: "4–12",
  duration: DURATION,
  lives: 0,
  isNew: true,
  sense: "本体觉",
  intensity: 2,
  theme: { color: "#ff6b8b", deep: "#c2405f", bg: ["#ffd1dc", "#7a3a8c"] },
  palette: PAL,
  pitch: "摆出墙洞的形状，穿墙而过",
  tagline: "一面挖了人形洞的墙朝你飞过来，赶紧摆出一样的姿势，穿墙而过！",
  howto: [
    "看墙上的洞是什么形状，像照镜子一样摆出同样的动作。",
    "墙飞到面前的那一刻，姿势对上了就能穿过去，洞口变绿就是对上了。",
    "越往后动作越难，还会有「蹲下来」，墙也会越来越快。",
  ],
  stars: [300, 900, 1500],

  cover(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#ffd1dc");
    g.addColorStop(1, "#9b5de5");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // 远处的墙
    ctx.save();
    const ww = w * 0.5, wh = h * 0.7;
    const x = w * 0.42, y = h * 0.12;
    ctx.fillStyle = "rgba(16,32,27,0.4)";
    roundRect(ctx, x + 8, y + 10, ww, wh, 16);
    ctx.fill();
    roundRect(ctx, x, y, ww, wh, 16);
    ctx.fillStyle = "#f15bb5";
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#10201b";
    ctx.stroke();
    const fig = figure(POSES[2], x + ww / 2, y + wh * 0.33, wh * 0.12);
    ctx.fillStyle = "#fffaf0";
    ctx.strokeStyle = "#fffaf0";
    traceFigure(ctx, fig, (p) => p, 1, 8);
    ctx.fillStyle = "#3a1f4d";
    ctx.strokeStyle = "#3a1f4d";
    traceFigure(ctx, fig, (p) => p, 1, 0);
    ctx.restore();
    const P = presetPose(w * 0.62, h, "jump");
    for (const k of Object.keys(P)) P[k].x -= w * 0.12;
    drawAvatar(ctx, P, { palette: PAL, inkW: 5 });
  },

  start(rt) {
    S = blank();
    rt.score = 0;
    rt.setScore(0);
    const f = rt.frame;
    if (f && f.ok && f.shoulder) S.shoulderBase = f.shoulder.y;
    S.anchor = playerAnchor(rt, f);
    S.gapT = 0.6;
    rt.say("照着墙上的洞摆姿势！", { ms: 2000 });
  },

  update(dt, f, rt) {
    if (!S) return;
    S.t += dt;

    // 孩子的位置：平滑跟随，洞口最终对准孩子
    const a = playerAnchor(rt, f);
    if (!S.anchor) S.anchor = a;
    const k = Math.min(1, dt * 3);
    S.anchor.x += (a.x - S.anchor.x) * k;
    S.anchor.y += (a.y - S.anchor.y) * k;
    S.anchor.s += (a.s - S.anchor.s) * k;

    // 站立时的肩膀高度：慢慢学，用来判断“蹲下来”
    const squatWall = S.wall && S.wall.pose.squat && S.wall.phase === "come";
    if (f && f.ok && f.shoulder && !squatWall) {
      if (S.shoulderBase == null) S.shoulderBase = f.shoulder.y;
      else if (f.shoulder.y < S.shoulderBase + f.bodyScale * 0.3) {
        S.shoulderBase += (f.shoulder.y - S.shoulderBase) * Math.min(1, dt * 0.8);
      }
    }

    if (!S.wall) {
      S.gapT -= dt;
      if (S.gapT <= 0 && S.t < DURATION - 1.2) nextWall(rt);
    } else {
      const w = S.wall;
      w.t += dt;
      if (w.phase === "come") {
        w.p = clamp(w.t / w.T, 0, 1);
        S.match = poseScore(f, w.pose);
        w.samples.push({ t: S.t, v: S.match });
        while (w.samples.length && w.samples[0].t < S.t - 0.4) w.samples.shift();
        if (w.p >= 1) judgeWall(rt);
      } else if (w.phase === "pass" && w.t > 0.55) {
        S.wall = null;
        S.gapT = S.gap;
      } else if (w.phase === "crash" && w.t > 1.0) {
        S.wall = null;
        S.gapT = S.gap;
      }
    }

    S.parts.update(dt);
    for (let i = S.pops.length - 1; i >= 0; i--) {
      const p = S.pops[i];
      p.t += dt;
      p.y -= dt * 40;
      if (p.t > 1.2) S.pops.splice(i, 1);
    }
  },

  draw(ctx, rt) {
    if (!S) return;
    const { W, H } = rt;
    const f = rt.frame;
    const hasCam = rt.camera(1, "saturate(0.8) brightness(1.02)");
    if (!hasCam) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#2a1f4d");
      g.addColorStop(1, "#120d24");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    // 走廊：几条透视线，告诉孩子墙是从远处飞来的
    const vp = { x: W / 2, y: H * 0.44 };
    ctx.save();
    ctx.fillStyle = hasCam ? "rgba(42,31,77,0.28)" : "rgba(0,0,0,0)";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,209,220,0.22)";
    ctx.lineWidth = 2;
    for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H], [W * 0.25, H], [W * 0.75, H]]) {
      ctx.beginPath();
      ctx.moveTo(vp.x, vp.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    ctx.restore();

    const w = S.wall;
    // 正在飞来的墙在孩子身后
    if (w && w.phase === "come") {
      const sigma = 0.14 + 0.86 * Math.pow(w.p, 2.1);
      drawWall(ctx, rt, sigma, clamp(w.p * 6, 0, 1));
    }

    // 小人（按 fitScale 缩到和洞一样大小）
    if (f && f.ok && f.shoulder) {
      const kk = S.anchor ? S.anchor.s / f.bodyScale : 1;
      const P = {};
      for (const [key, p] of Object.entries(f.pts)) {
        P[key] = { x: f.shoulder.x + (p.x - f.shoulder.x) * kk, y: f.shoulder.y + (p.y - f.shoulder.y) * kk, v: p.v };
      }
      drawAvatar(ctx, P, { palette: PAL, alpha: 0.97, inkW: Math.max(3, f.bodyScale * kk * 0.045) });
    } else {
      drawAvatar(ctx, standingJoints(W / 2, H * 0.88, Math.min(H * 0.55, W * 0.55)), { palette: PAL, alpha: 0.28, showFace: false, inkW: 4 });
      outlineText(ctx, "站到画面中间，让摄像头看见你", W / 2, H * 0.2, { size: 20 });
    }

    // 穿过去 / 撞上了：墙在孩子前面
    if (w && w.phase === "pass") {
      const e = w.t / 0.55;
      drawWall(ctx, rt, 1 + e * 0.9, clamp(1 - e * 1.4, 0, 1));
    } else if (w && w.phase === "crash") {
      const e = w.t / 1.0;
      const shake = e < 0.3 ? Math.sin(w.t * 70) * 14 * (1 - e / 0.3) : 0;
      const drop = e > 0.45 ? Math.pow((e - 0.45) / 0.55, 2) * H * 1.1 : 0;
      drawWall(ctx, rt, 1, clamp(1.4 - e, 0, 1), shake, drop);
    }

    S.parts.draw(ctx);
    drawPoseCard(ctx, rt);

    // 像不像
    if (w && w.phase === "come") {
      const bw = Math.min(360, W * 0.6), bh = 18;
      const x = W / 2 - bw / 2, y = H - 104;
      const m = S.match;
      const label = m >= 0.85 ? "一模一样！" : m >= 0.62 ? "对上了，保持住！" : m >= 0.4 ? "再像一点" : "照着洞口摆";
      outlineText(ctx, label, W / 2, y - 18, { size: 22, fill: m >= 0.62 ? "#8ef0a8" : "#fffaf0" });
      ctx.save();
      roundRect(ctx, x, y, bw, bh, 9);
      ctx.fillStyle = "rgba(16,32,27,0.6)";
      ctx.fill();
      ctx.strokeStyle = "#fffaf0";
      ctx.lineWidth = 2;
      ctx.stroke();
      roundRect(ctx, x + 3, y + 3, Math.max(0, (bw - 6) * m), bh - 6, 6);
      ctx.fillStyle = m >= 0.85 ? "#48e08a" : m >= 0.62 ? "#b8f26b" : "#ffd166";
      ctx.fill();
      // 过关线
      ctx.beginPath();
      ctx.moveTo(x + 3 + (bw - 6) * 0.62, y - 4);
      ctx.lineTo(x + 3 + (bw - 6) * 0.62, y + bh + 4);
      ctx.strokeStyle = "#fffaf0";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    for (const p of S.pops) {
      const a = clamp(1 - (p.t - 0.8) / 0.4, 0, 1);
      const sc = easeOutBack(clamp(p.t / 0.3, 0, 1));
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(sc, sc);
      outlineText(ctx, p.text, 0, 0, { size: Math.min(64, W * 0.08), fill: p.color, alpha: a });
      if (p.sub) outlineText(ctx, p.sub, 0, Math.min(52, W * 0.065), { size: 26, alpha: a });
      ctx.restore();
    }
  },

  finish() {
    const s = S || blank();
    const total = s.passed + s.crashed;
    const passRate = total ? s.passed / total : 0;
    const avgMatch = total ? s.matchSum / total : 0;
    const good = s.score >= 900;
    return {
      score: s.score,
      headline: s.score >= 1500 ? "穿墙小超人！" : good ? "身体好灵活！" : "越来越像了",
      desc: good
        ? "看一眼就能摆对，说明身体很清楚自己的手在哪儿。"
        : "先看清洞口里的手是朝上、朝旁边还是朝下，再动手，会过得更多。",
      rows: [
        { label: "穿过的墙", value: `${s.passed} / ${total}` },
        { label: "一模一样", value: `${s.perfect} 次` },
        { label: "最多连过", value: `${s.bestCombo} 面` },
        { label: "平均像度", value: `${Math.round(avgMatch * 100)}%` },
      ],
      sensory: [
        { label: "本体觉", value: clamp(avgMatch, 0.05, 1) },
        { label: "动作计划", value: clamp(passRate, 0.05, 1) },
        { label: "双侧协调", value: clamp(s.asymSeen ? s.asymPass / s.asymSeen : passRate * 0.8, 0.05, 1) },
      ],
      tip: s.asymSeen && s.asymPass / s.asymSeen < 0.5
        ? "小提示：「举左手」「举右手」这类一边一个样的动作最难。平时可以玩「家长说左手摸右耳」，练左右分化。"
        : "小提示：试试让孩子闭上眼睛摆一个动作，再睁眼对照镜子看像不像——这正是本体觉在工作。",
    };
  },
};
