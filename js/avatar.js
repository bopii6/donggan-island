/* 把骨骼点画成剪纸小朋友。
   统一用「先粗描边、再填色」的贴纸画法，所以不管什么背景都能看清轮廓。 */

import { clamp, lerp, roundRect } from "./kit.js";

export const PALETTES = {
  sunset: { shirt: "#ff7a3d", pants: "#2b4f8a", skin: "#ffd2ae", hair: "#2a1c17", shoe: "#101d19" },
  mint:   { shirt: "#38c9a8", pants: "#243b55", skin: "#ffd9bb", hair: "#241b1b", shoe: "#101d19" },
  neon:   { shirt: "#ff4d8d", pants: "#2a2350", skin: "#ffe0c4", hair: "#1a1430", shoe: "#101d19" },
  chalk:  { shirt: "#f6f3e9", pants: "#e2542f", skin: "#ffd2ae", hair: "#10201b", shoe: "#10201b" },
};

const mid = (a, b, t = 0.5) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), v: Math.min(a.v ?? 1, b.v ?? 1) });
const ok = (p, min = 0.45) => p && (p.v ?? 1) >= min;

function capsule(ctx, a, b, width, color, ink, inkW) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (inkW > 0) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = width + inkW * 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/* 离镜头很近时，1:1 的小人会把整个屏幕糊住；按身高把小人收进一个上限 */
export function fitScale(bodyScale, viewH, target = 0.62) {
  if (!bodyScale) return 1;
  const bodyH = bodyScale * 2.25;
  return clamp((viewH * target) / bodyH, 0.38, 1);
}

/* 一个站好的“小人”关节，用来画站位虚影 / 没识别到人时的提示 */
export function standingJoints(cx, feetY, hgt) {
  const shoY = feetY - hgt * 0.8;
  const hipY = feetY - hgt * 0.46;
  const headY = feetY - hgt * 0.93;
  const s = hgt * 0.24;
  return {
    nose: { x: cx, y: headY, v: 1 },
    lSho: { x: cx - s * 0.62, y: shoY, v: 1 },
    rSho: { x: cx + s * 0.62, y: shoY, v: 1 },
    lElb: { x: cx - s * 0.8, y: shoY + hgt * 0.13, v: 1 },
    lWri: { x: cx - s * 0.92, y: shoY + hgt * 0.26, v: 1 },
    rElb: { x: cx + s * 0.8, y: shoY + hgt * 0.13, v: 1 },
    rWri: { x: cx + s * 0.92, y: shoY + hgt * 0.26, v: 1 },
    lHip: { x: cx - s * 0.38, y: hipY, v: 1 },
    rHip: { x: cx + s * 0.38, y: hipY, v: 1 },
    lKne: { x: cx - s * 0.4, y: hipY + hgt * 0.16, v: 1 },
    rKne: { x: cx + s * 0.4, y: hipY + hgt * 0.16, v: 1 },
    lAnk: { x: cx - s * 0.46, y: feetY, v: 1 },
    rAnk: { x: cx + s * 0.46, y: feetY, v: 1 },
  };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} P 关键点（屏幕坐标，带 v 可见度）
 * @param {object} o { palette, alpha, inkW, scale, showFace, squash }
 */
export function drawAvatar(ctx, P, o = {}) {
  const pal = o.palette || PALETTES.sunset;
  const ink = o.ink || "#101d19";
  const inkW = o.inkW ?? 5;
  const alpha = o.alpha ?? 1;
  if (alpha <= 0.02) return;

  const lSho = P.lSho, rSho = P.rSho, lHip = P.lHip, rHip = P.rHip;
  if (!ok(lSho) || !ok(rSho)) return;

  const shoMid = mid(lSho, rSho);
  const shoW = Math.hypot(lSho.x - rSho.x, lSho.y - rSho.y);
  const scale = o.scale ?? clamp(shoW / 130, 0.45, 2.4);

  // 头：用鼻子位置，缺了就按肩中点往上推
  const headR = shoW * 0.36;
  let head = P.nose && ok(P.nose) ? { ...P.nose } : { x: shoMid.x, y: shoMid.y - shoW * 0.82, v: 1 };
  head = { x: head.x, y: head.y - headR * 0.18, v: 1 };

  const hipMid = ok(lHip) && ok(rHip) ? mid(lHip, rHip) : { x: shoMid.x, y: shoMid.y + shoW * 1.15, v: 1 };

  ctx.save();
  ctx.globalAlpha = alpha;

  // 地面影子
  if (ok(P.lAnk, 0.3) && ok(P.rAnk, 0.3)) {
    const fx = (P.lAnk.x + P.rAnk.x) / 2;
    const fy = Math.max(P.lAnk.y, P.rAnk.y) + 6 * scale;
    ctx.save();
    ctx.globalAlpha = alpha * 0.16;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(fx, fy, shoW * 0.75, shoW * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---- 腿 ----
  const legW = 15 * scale;
  for (const [hip, knee, ank] of [[lHip, P.lKne, P.lAnk], [rHip, P.rKne, P.rAnk]]) {
    if (ok(hip) && ok(knee)) capsule(ctx, hip, knee, legW, pal.pants, ink, inkW * 0.55);
    if (ok(knee) && ok(ank)) capsule(ctx, knee, ank, legW * 0.86, pal.pants, ink, inkW * 0.55);
    if (ok(ank)) {
      // 鞋：朝向由膝盖决定
      const dir = ok(knee) ? Math.atan2(ank.y - knee.y, ank.x - knee.x) - Math.PI / 2 : 0;
      ctx.save();
      ctx.translate(ank.x, ank.y + 3 * scale);
      ctx.rotate(dir);
      ctx.beginPath();
      ctx.ellipse(0, 0, 12 * scale, 7 * scale, 0, 0, Math.PI * 2);
      ctx.fillStyle = pal.shoe;
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = inkW * 0.5;
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---- 躯干 ----
  if (ok(lHip) && ok(rHip)) {
    ctx.beginPath();
    ctx.moveTo(lSho.x, lSho.y);
    ctx.lineTo(rSho.x, rSho.y);
    ctx.lineTo(rHip.x, rHip.y);
    ctx.lineTo(lHip.x, lHip.y);
    ctx.closePath();
    ctx.lineJoin = "round";
    ctx.strokeStyle = ink;
    ctx.lineWidth = inkW * 2;
    ctx.stroke();
    ctx.fillStyle = pal.shirt;
    ctx.fill();
  }

  // ---- 手臂 ----
  const armW = 12.5 * scale;
  for (const [sho, elb, wri] of [[lSho, P.lElb, P.lWri], [rSho, P.rElb, P.rWri]]) {
    if (!ok(sho)) continue;
    if (ok(elb)) capsule(ctx, sho, elb, armW, pal.shirt, ink, inkW * 0.5);
    if (ok(elb) && ok(wri)) capsule(ctx, elb, wri, armW * 0.85, pal.skin, ink, inkW * 0.5);
    if (ok(wri)) {
      ctx.beginPath();
      ctx.arc(wri.x, wri.y, 8 * scale, 0, Math.PI * 2);
      ctx.fillStyle = pal.skin;
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = inkW * 0.5;
      ctx.stroke();
    }
  }

  // ---- 头 ----
  ctx.beginPath();
  ctx.arc(head.x, head.y, headR, 0, Math.PI * 2);
  ctx.fillStyle = pal.skin;
  ctx.strokeStyle = ink;
  ctx.lineWidth = inkW * 0.9;
  ctx.fill();
  ctx.stroke();

  // 头发（上半个圆 + 一撮呆毛）
  ctx.save();
  ctx.beginPath();
  ctx.arc(head.x, head.y - headR * 0.06, headR * 1.01, Math.PI * 1.02, Math.PI * 2.02);
  ctx.closePath();
  ctx.fillStyle = pal.hair;
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(head.x + headR * 0.2, head.y - headR * 0.95);
  ctx.quadraticCurveTo(head.x + headR * 0.75, head.y - headR * 1.55, head.x + headR * 0.95, head.y - headR * 0.75);
  ctx.strokeStyle = ink;
  ctx.lineWidth = inkW * 0.75;
  ctx.lineCap = "round";
  ctx.stroke();

  // 脸
  if (o.showFace !== false) {
    const ex = headR * 0.34, ey = headR * 0.12;
    ctx.fillStyle = ink;
    ctx.beginPath(); ctx.arc(head.x - ex, head.y + ey, headR * 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(head.x + ex, head.y + ey, headR * 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.arc(head.x, head.y + headR * 0.3, headR * 0.26, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1.5, headR * 0.09);
    ctx.stroke();
    // 腮红
    ctx.globalAlpha = alpha * 0.5;
    ctx.fillStyle = "#ff8f7a";
    ctx.beginPath(); ctx.ellipse(head.x - headR * 0.55, head.y + headR * 0.35, headR * 0.17, headR * 0.11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(head.x + headR * 0.55, head.y + headR * 0.35, headR * 0.17, headR * 0.11, 0, 0, Math.PI * 2); ctx.fill();
  }

  ctx.restore();
}

/* 自检页用的细骨架 */
export function drawSkeleton(ctx, P, color = "#f9b233") {
  const segs = [
    ["lSho", "rSho"], ["lSho", "lElb"], ["lElb", "lWri"], ["rSho", "rElb"], ["rElb", "rWri"],
    ["lSho", "lHip"], ["rSho", "rHip"], ["lHip", "rHip"],
    ["lHip", "lKne"], ["lKne", "lAnk"], ["rHip", "rKne"], ["rKne", "rAnk"],
  ];
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.9;
  for (const [a, b] of segs) {
    if (!ok(P[a], 0.4) || !ok(P[b], 0.4)) continue;
    ctx.beginPath();
    ctx.moveTo(P[a].x, P[a].y);
    ctx.lineTo(P[b].x, P[b].y);
    ctx.stroke();
  }
  ctx.fillStyle = "#fff";
  for (const k of Object.keys(P)) {
    if (!ok(P[k], 0.4)) continue;
    ctx.beginPath();
    ctx.arc(P[k].x, P[k].y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* 开合跳动画：k = 0 站立，1 手脚张开；lift 为离地高度（像素） */
export function jackPose(cx, feetY, hgt, k, lift = 0) {
  const P = standingJoints(cx, feetY - lift, hgt);
  const s = hgt * 0.24;
  const shoY = P.lSho.y;
  const armA = lerp(Math.PI * 0.42, -Math.PI * 0.36, k); // 手臂从下垂摆到头顶
  const arm = hgt * 0.17;
  for (const side of [-1, 1]) {
    const sho = side < 0 ? P.lSho : P.rSho;
    const ex = sho.x + side * Math.cos(armA) * arm;
    const ey = shoY + Math.sin(armA) * arm;
    const wx = ex + side * Math.cos(armA - side * 0.0) * arm * 0.95;
    const wy = ey + Math.sin(armA) * arm * 0.95;
    const elb = { x: ex, y: ey, v: 1 };
    const wri = { x: wx, y: wy, v: 1 };
    if (side < 0) { P.lElb = elb; P.lWri = wri; } else { P.rElb = elb; P.rWri = wri; }
    const spread = lerp(0.4, 1.25, k) * s;
    const kne = { x: cx + side * spread * 0.78, y: P.lKne.y, v: 1 };
    const ank = { x: cx + side * spread, y: feetY - lift, v: 1 };
    if (side < 0) { P.lKne = kne; P.lAnk = ank; } else { P.rKne = kne; P.rAnk = ank; }
  }
  return P;
}

/* 首页封面上的“定格小人” */
export function presetPose(w, h, kind = "jump") {
  const cx = w * 0.5;
  const cy = h * 0.58;
  const s = Math.min(w, h) * 0.52;
  const P = {
    nose: { x: cx, y: cy - s * 0.62, v: 1 },
    lSho: { x: cx - s * 0.2, y: cy - s * 0.42, v: 1 },
    rSho: { x: cx + s * 0.2, y: cy - s * 0.42, v: 1 },
    lHip: { x: cx - s * 0.13, y: cy - s * 0.02, v: 1 },
    rHip: { x: cx + s * 0.13, y: cy - s * 0.02, v: 1 },
  };
  if (kind === "jump") {
    P.lElb = { x: cx - s * 0.42, y: cy - s * 0.58, v: 1 };
    P.lWri = { x: cx - s * 0.52, y: cy - s * 0.82, v: 1 };
    P.rElb = { x: cx + s * 0.42, y: cy - s * 0.58, v: 1 };
    P.rWri = { x: cx + s * 0.52, y: cy - s * 0.82, v: 1 };
    P.lKne = { x: cx - s * 0.28, y: cy + s * 0.3, v: 1 };
    P.lAnk = { x: cx - s * 0.44, y: cy + s * 0.44, v: 1 };
    P.rKne = { x: cx + s * 0.3, y: cy + s * 0.24, v: 1 };
    P.rAnk = { x: cx + s * 0.42, y: cy + s * 0.5, v: 1 };
  } else if (kind === "slash") {
    P.lElb = { x: cx - s * 0.3, y: cy - s * 0.2, v: 1 };
    P.lWri = { x: cx - s * 0.1, y: cy - s * 0.02, v: 1 };
    P.rElb = { x: cx + s * 0.44, y: cy - s * 0.62, v: 1 };
    P.rWri = { x: cx + s * 0.64, y: cy - s * 0.84, v: 1 };
    P.lKne = { x: cx - s * 0.26, y: cy + s * 0.3, v: 1 };
    P.lAnk = { x: cx - s * 0.4, y: cy + s * 0.42, v: 1 };
    P.rKne = { x: cx + s * 0.26, y: cy + s * 0.3, v: 1 };
    P.rAnk = { x: cx + s * 0.36, y: cy + s * 0.42, v: 1 };
  } else if (kind === "freeze") {
    P.lElb = { x: cx - s * 0.34, y: cy - s * 0.22, v: 1 };
    P.lWri = { x: cx - s * 0.46, y: cy - s * 0.02, v: 1 };
    P.rElb = { x: cx + s * 0.34, y: cy - s * 0.2, v: 1 };
    P.rWri = { x: cx + s * 0.48, y: cy - s * 0.04, v: 1 };
    P.lKne = { x: cx - s * 0.22, y: cy + s * 0.3, v: 1 };
    P.lAnk = { x: cx - s * 0.3, y: cy + s * 0.46, v: 1 };
    P.rKne = { x: cx + s * 0.22, y: cy + s * 0.3, v: 1 };
    P.rAnk = { x: cx + s * 0.3, y: cy + s * 0.46, v: 1 };
  }
  return P;
}

export function drawCover(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  roundRect(ctx, 0, 0, w, h, 0);
  ctx.clip();
}
