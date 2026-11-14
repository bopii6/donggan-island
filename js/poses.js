/* 姿势：匹配打分、人形剪影、挖洞的墙。

   姿势的写法（屏幕坐标里的角度：0° 朝右、90° 朝下、-90° 朝上）：
   { name, L: [上臂, 前臂], R: [上臂, 前臂], squat?: true, shift?: -1 | 1 }
   L 是屏幕左边那只手（画面镜像，所以就是孩子自己的左手）。
   squat = 蹲下；shift = 整个人往左(-1)/右(1)跨一步。 */

import { clamp, roundRect } from "./kit.js";
import { fitScale } from "./avatar.js";

export const DEG = Math.PI / 180;
export const angOf = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) / DEG;
export const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const seen = (p) => p && (p.v ?? 1) > 0.4;

function segScore(a, b, target) {
  if (!seen(a) || !seen(b)) return 0.45; // 看不清就给一半，别因为手出画面就判死
  return clamp(1 - (angDiff(angOf(a, b), target) - 18) / 42, 0, 1);
}

/**
 * 当前身体和目标姿势有多像（0～1）
 * @param base { y: 站立时肩膀高度, x: 站立时肩膀横向位置 }，用来判断蹲和跨步
 */
export function scorePose(f, pose, base = {}) {
  if (!f || !f.ok) return 0;
  const P = f.pts;
  const arms = (
    segScore(P.lSho, P.lElb, pose.L[0]) * 1.2 + segScore(P.lElb, P.lWri, pose.L[1]) * 0.8 +
    segScore(P.rSho, P.rElb, pose.R[0]) * 1.2 + segScore(P.rElb, P.rWri, pose.R[1]) * 0.8
  ) / 4;
  const s = f.bodyScale || 100;
  const drop = base.y != null && f.shoulder ? (f.shoulder.y - base.y) / s : 0;
  const dx = base.x != null && f.shoulder ? (f.shoulder.x - base.x) / s : 0;

  let v;
  if (pose.squat) {
    const low = clamp((drop - 0.18) / 0.27, 0, 1);
    v = low * 0.8 + arms * 0.2; // 蹲得下去是关键，手放哪儿不太讲究
  } else {
    v = drop > 0.45 ? arms * 0.6 : arms; // 站着的动作蹲着做不算
  }
  if (pose.shift) {
    const step = clamp((dx * pose.shift - 0.12) / 0.25, 0, 1);
    v = v * 0.55 + step * 0.45; // 跨没跨步占将近一半
  }
  return v;
}

/* ---------- 剪影几何 ---------- */
export function figure(pose, ax0, ay, s) {
  const ax = ax0 + (pose.shift || 0) * s * 0.55;
  const y0 = ay + (pose.squat ? s * 0.8 : 0);
  const dir = (deg) => ({ x: Math.cos(deg * DEG), y: Math.sin(deg * DEG) });
  const lS = { x: ax - s * 0.5, y: y0 }, rS = { x: ax + s * 0.5, y: y0 };
  const ua = s * 0.82, fa = s * 0.76;
  const arm = (sho, [u, f]) => {
    const du = dir(u), df = dir(f);
    const e = { x: sho.x + du.x * ua, y: sho.y + du.y * ua };
    return [sho, e, { x: e.x + df.x * fa, y: e.y + df.y * fa }];
  };
  const lH = { x: ax - s * 0.34, y: y0 + s * 1.25 }, rH = { x: ax + s * 0.34, y: y0 + s * 1.25 };
  const floor = ay + s * 2.75;
  const wide = pose.shift ? 0.25 : 0; // 跨步时腿分得更开
  const legs = pose.squat
    ? [[lH, { x: ax - s * 0.85, y: lH.y + s * 0.3 }, { x: ax - s * 0.55, y: floor }],
       [rH, { x: ax + s * 0.85, y: rH.y + s * 0.3 }, { x: ax + s * 0.55, y: floor }]]
    : [[lH, { x: ax - s * (0.4 + wide), y: y0 + s * 1.98 }, { x: ax - s * (0.46 + wide * 1.6), y: floor }],
       [rH, { x: ax + s * (0.4 + wide), y: y0 + s * 1.98 }, { x: ax + s * (0.46 + wide * 1.6), y: floor }]];
  return {
    arms: [arm(lS, pose.L), arm(rS, pose.R)],
    legs,
    torso: [lS, rS, rH, lH],
    head: { x: ax, y: y0 - s * 0.9, r: s * 0.46 },
    w: s * 0.52,
  };
}

/** 把姿势变成小人的关节点（自测时用来造“标准动作”） */
export function jointsFromPose(pose, ax, ay, s) {
  const f = figure(pose, ax, ay, s);
  const v = (p) => ({ x: p.x, y: p.y, v: 1 });
  const [lS, lE, lW] = f.arms[0];
  const [rS, rE, rW] = f.arms[1];
  const [lH, lK, lA] = f.legs[0];
  const [rH, rK, rA] = f.legs[1];
  return {
    nose: v({ x: f.head.x, y: f.head.y + s * 0.12 }),
    lSho: v(lS), rSho: v(rS), lElb: v(lE), rElb: v(rE), lWri: v(lW), rWri: v(rW),
    lHip: v(lH), rHip: v(rH), lKne: v(lK), rKne: v(rK), lAnk: v(lA), rAnk: v(rA),
  };
}

export function traceFigure(ctx, fig, map, scale, extra) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const w = fig.w * scale + extra;
  ctx.lineWidth = w;
  for (const line of [...fig.arms, ...fig.legs]) {
    ctx.beginPath();
    line.forEach((p, i) => {
      const q = map(p);
      i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
    });
    ctx.stroke();
  }
  ctx.beginPath();
  fig.torso.forEach((p, i) => {
    const q = map(p);
    i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
  });
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = w * 0.7;
  ctx.stroke();
  const h = map(fig.head);
  ctx.beginPath();
  ctx.arc(h.x, h.y, fig.head.r * scale + extra * 0.5, 0, Math.PI * 2);
  ctx.fill();
}

/** 孩子在屏幕上的位置和大小（和画小人时的 fitScale 保持一致） */
export function playerAnchor(rt, f) {
  const { W, H } = rt;
  if (f && f.ok && f.shoulder && f.bodyScale) {
    const k = fitScale(f.bodyScale, H, 0.66);
    return { x: f.shoulder.x, y: f.shoulder.y, s: f.bodyScale * k, k };
  }
  return { x: W / 2, y: H * 0.42, s: Math.min(W, H) * 0.15, k: 1 };
}

export const matchColor = (m) => (m >= 0.85 ? "#48e08a" : m >= 0.62 ? "#b8f26b" : m >= 0.4 ? "#ffd166" : "#fffaf0");

/**
 * 画一面挖了人形洞的墙（透视：sigma = 0.14 远处 → 1 贴到眼前）
 * @param o { pose, color, anchor, sigma, alpha, ring, shakeX, dropY, cache }
 *   cache 是调用方保存的对象，用来复用离屏画布
 */
export function drawPoseWall(ctx, rt, o) {
  const { W, H } = rt;
  const { pose, color, anchor: A, sigma, alpha = 1, ring = "#fffaf0", shakeX = 0, dropY = 0, cache } = o;
  if (!W || !H) return;
  const vp = { x: W / 2, y: H * 0.44 };
  const map = (p) => ({ x: vp.x + (p.x - vp.x) * sigma + shakeX, y: vp.y + (p.y - vp.y) * sigma + dropY });

  if (!cache.off) cache.off = document.createElement("canvas");
  const off = cache.off;
  const dpr = rt.dpr;
  if (off.width !== Math.round(W * dpr) || off.height !== Math.round(H * dpr)) {
    off.width = Math.round(W * dpr);
    off.height = Math.round(H * dpr);
  }
  const g = off.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);

  // 墙面：比屏幕大一圈，飞到眼前时把画面占满
  const tl = map({ x: -W * 0.08, y: -H * 0.06 });
  const br = map({ x: W * 1.08, y: H * 1.1 });
  const ww = br.x - tl.x, wh = br.y - tl.y;
  g.fillStyle = "rgba(16,32,27,0.55)";
  roundRect(g, tl.x + 10 * sigma, tl.y + 14 * sigma, ww, wh, 26 * sigma);
  g.fill();
  roundRect(g, tl.x, tl.y, ww, wh, 26 * sigma);
  g.fillStyle = color;
  g.fill();
  // 砖缝
  g.save();
  roundRect(g, tl.x, tl.y, ww, wh, 26 * sigma);
  g.clip();
  g.strokeStyle = "rgba(16,32,27,0.16)";
  g.lineWidth = Math.max(1, 3 * sigma);
  const rows = 9;
  const bh = wh / rows;
  for (let r = 1; r < rows; r++) {
    g.beginPath();
    g.moveTo(tl.x, tl.y + r * bh);
    g.lineTo(br.x, tl.y + r * bh);
    g.stroke();
  }
  const bw = bh * 2.1;
  for (let r = 0; r < rows; r++) {
    const offx = r % 2 ? bw / 2 : 0;
    for (let x = tl.x - offx; x < br.x; x += bw) {
      g.beginPath();
      g.moveTo(x, tl.y + r * bh);
      g.lineTo(x, tl.y + (r + 1) * bh);
      g.stroke();
    }
  }
  g.restore();
  g.lineWidth = Math.max(2, 6 * sigma);
  g.strokeStyle = "#10201b";
  roundRect(g, tl.x, tl.y, ww, wh, 26 * sigma);
  g.stroke();

  // 人形洞：先画一圈描边色，再把洞挖空
  const fig = figure(pose, A.x, A.y, A.s);
  g.fillStyle = "#10201b";
  g.strokeStyle = "#10201b";
  traceFigure(g, fig, map, sigma, 16 * Math.max(0.5, sigma));
  g.fillStyle = ring;
  g.strokeStyle = ring;
  traceFigure(g, fig, map, sigma, 10 * Math.max(0.5, sigma));
  g.globalCompositeOperation = "destination-out";
  traceFigure(g, fig, map, sigma, 0);
  g.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(off, 0, 0, W, H);
  ctx.restore();
}
