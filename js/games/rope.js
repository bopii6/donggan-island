/* 跳大绳 —— 两个小伙伴在两边摇绳，绳子甩到脚下时跳起来。跳过一下记一个，越跳越快。
   练的是：前庭觉、节奏感、视觉预判、下肢爆发力。 */

import { clamp, lerp, Particles, roundRect, JumpDetector, outlineText, easeOutBack } from "../kit.js";
import { drawAvatar, PALETTES, standingJoints, presetPose, fitScale } from "../avatar.js";

const DURATION = 60;
const PAL = { shirt: "#f9b233", pants: "#2b4f8a", skin: "#ffd2ae", hair: "#2a1c17", shoe: "#101d19" };
const FRIEND_L = PALETTES.mint;
const FRIEND_R = PALETTES.neon;
const ROPE = "#ff4d6d";

let S = null;

function blank() {
  return {
    t: 0,
    phase: 0.5, // 0 = 绳子在脚下，0.5 = 在头顶
    period: 1.5,
    state: "ready", // ready | turn | trip | wait
    stateT: 0,
    pending: [],
    count: 0,
    combo: 0,
    bestCombo: 0,
    trips: 0,
    fastest: 1.5,
    jd: new JumpDetector({ up: 0.13, down: 0.05 }),
    geo: null,
    parts: new Particles(200),
    pops: [],
    noBodyT: 0,
  };
}

/* 场地几何：绳子最低点贴着孩子的脚，最高点越过头顶 */
function targetGeo(rt, f) {
  const { W, H } = rt;
  let cx = W / 2, floor = H * 0.9, head = H * 0.3, s = Math.min(W, H) * 0.16;
  if (f && f.ok && f.shoulder && f.bodyScale) {
    const k = fitScale(f.bodyScale, H, 0.66);
    s = f.bodyScale * k;
    const shoY = S.jd.base ?? f.shoulder.y; // 用站着时的肩高，跳起来的时候场地不跟着动
    cx = f.shoulder.x;
    const feet = f.feet[0] && f.feet[1] && !S.jd.air ? Math.max(f.feet[0].y, f.feet[1].y) + 8 : null;
    // 小人按 fitScale 以肩膀为中心缩放过，脚的位置也要跟着缩
    floor = feet != null ? shoY + (feet - shoY) * k : shoY + s * 2.75;
    head = shoY - s * 1.35;
  }
  floor = Math.min(floor, H - 16);
  const handY = (floor + head - s * 0.5) / 2;
  return { cx, floor, head, s, handY, R: floor - handY, xl: Math.max(70, W * 0.11), xr: Math.min(W - 70, W * 0.89) };
}

function updateGeo(rt, f, dt) {
  const t = targetGeo(rt, f);
  if (!S.geo) { S.geo = t; return; }
  if (S.jd.air) return;
  const k = Math.min(1, dt * 2.5);
  for (const key of Object.keys(t)) S.geo[key] += (t[key] - S.geo[key]) * k;
}

function handlePos(side, phase) {
  const g = S.geo;
  const r = g.s * 0.16;
  const a = phase * Math.PI * 2;
  return {
    x: (side < 0 ? g.xl + g.s * 0.55 : g.xr - g.s * 0.55) + Math.sin(a) * r * 0.4 * side,
    y: g.handY + Math.cos(a) * r,
  };
}

function drawRope(ctx, front) {
  const g = S.geo;
  let f = ((S.phase % 1) + 1) % 1;
  const isFront = f >= 0.5;
  if (S.state === "trip") {
    if (!front) return;
  } else if (isFront !== front) return;

  const hl = handlePos(-1, S.phase);
  const hr = handlePos(1, S.phase);
  let midY;
  if (S.state === "trip") {
    // 绊住了：绳子软软地搭在地上
    midY = g.floor + 4 + Math.sin(S.stateT * 10) * 6 * Math.max(0, 1 - S.stateT * 2);
  } else {
    midY = g.handY + g.R * Math.cos(f * Math.PI * 2);
  }
  const hy = (hl.y + hr.y) / 2;
  const cy = 2 * midY - hy;
  const cx = (hl.x + hr.x) / 2;
  ctx.save();
  ctx.lineCap = "round";
  ctx.globalAlpha = front ? 1 : 0.75;
  const w = front ? Math.max(6, g.s * 0.07) : Math.max(4, g.s * 0.05);
  for (const [col, lw] of [["#10201b", w + 5], [ROPE, w]]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(hl.x, hl.y);
    ctx.quadraticCurveTo(cx, cy, hr.x, hr.y);
    ctx.stroke();
  }
  // 绳子上的高光
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = Math.max(1.5, w * 0.25);
  ctx.setLineDash([w * 1.2, w * 2.2]);
  ctx.beginPath();
  ctx.moveTo(hl.x, hl.y);
  ctx.quadraticCurveTo(cx, cy, hr.x, hr.y);
  ctx.stroke();
  ctx.restore();
}

function drawFriend(ctx, side, pal) {
  const g = S.geo;
  const fx = side < 0 ? g.xl : g.xr;
  const hgt = g.floor - g.head + g.s * 0.2;
  const P = standingJoints(fx, g.floor, hgt);
  const hand = handlePos(side, S.phase);
  // 里侧的手握着绳子
  const sho = side < 0 ? P.rSho : P.lSho;
  const elb = { x: lerp(sho.x, hand.x, 0.5) + side * -6, y: lerp(sho.y, hand.y, 0.5) + 10, v: 1 };
  if (side < 0) { P.rElb = elb; P.rWri = { ...hand, v: 1 }; } else { P.lElb = elb; P.lWri = { ...hand, v: 1 }; }
  // 外侧的手跟着节奏摆一摆
  const sw = Math.sin(S.t * 6) * 0.15;
  const osho = side < 0 ? P.lSho : P.rSho;
  const oe = { x: osho.x - side * hgt * 0.08, y: osho.y + hgt * 0.12, v: 1 };
  const ow = { x: osho.x - side * hgt * (0.12 + sw * 0.1), y: osho.y + hgt * (0.24 - sw * 0.1), v: 1 };
  if (side < 0) { P.lElb = oe; P.lWri = ow; } else { P.rElb = oe; P.rWri = ow; }
  // 跳一跳
  const bob = Math.abs(Math.sin(S.t * 3)) * 3;
  for (const k of Object.keys(P)) if (k !== "lAnk" && k !== "rAnk") P[k].y -= bob;
  drawAvatar(ctx, P, { palette: pal, alpha: 0.98, inkW: Math.max(3, g.s * 0.04) });
  // 绳柄
  ctx.save();
  ctx.translate(hand.x, hand.y);
  roundRect(ctx, -7, -12, 14, 24, 6);
  ctx.fillStyle = "#f9b233";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#10201b";
  ctx.stroke();
  ctx.restore();
}

function startTurning(rt) {
  S.state = "turn";
  S.stateT = 0;
  S.phase = 0.5;
  S.pending.length = 0;
}

function onBottom(rt) {
  rt.audio.sfx("slap");
  S.pending.push({ tb: S.t });
}

function judge(rt, p) {
  const ok = S.jd.airborneBetween(p.tb - 0.24, p.tb + 0.22);
  const g = S.geo;
  if (ok) {
    S.count++;
    S.combo++;
    S.bestCombo = Math.max(S.bestCombo, S.combo);
    rt.setScore(S.count);
    S.pops.push({ text: String(S.count), x: g.cx + (Math.random() - 0.5) * 30, y: g.floor - g.s * 0.6, t: 0, color: "#ffd166" });
    S.parts.burst(g.cx, g.floor, 8, { color: ["#ffd166", "#fff"], life: 0.5, size: 7, power: 0.7, g: 600 });
    if (S.combo % 4 === 0) {
      S.period = Math.max(0.62, S.period * 0.94);
      S.fastest = Math.min(S.fastest, S.period);
      rt.audio.sfx("levelup");
      S.pops.push({ text: "加速！", x: rt.W / 2, y: rt.H * 0.3, t: 0, color: "#8ef0ff", big: true });
    }
    if (S.count % 10 === 0) {
      rt.say(`${S.count} 个！`, { ms: 1200 });
      rt.audio.sfx("sparkle");
    } else if (S.combo === 8 || S.combo === 16) {
      rt.cheer();
    }
  } else {
    S.trips++;
    S.combo = 0;
    S.state = "trip";
    S.stateT = 0;
    S.pending.length = 0;
    S.period = Math.min(1.6, S.period * 1.1);
    rt.audio.sfx("miss");
    rt.kick(8);
    rt.say("绊到啦，再来！", { ms: 1300 });
    S.pops.push({ text: "绊到啦", x: rt.W / 2, y: rt.H * 0.32, t: 0, color: "#ff8a7a", big: true });
  }
}

export default {
  _inspect: () => S, // 调试用：读当前局面
  id: "rope",
  name: "跳大绳",
  tag: "前庭觉 · 节奏感",
  unit: "个",
  age: "4–12",
  duration: DURATION,
  lives: 0,
  isNew: true,
  sense: "前庭觉",
  intensity: 3,
  theme: { color: "#f9b233", deep: "#c98f12", bg: ["#ffe6a6", "#e2542f"] },
  palette: PAL,
  pitch: "小伙伴帮你摇绳，看能连跳几个",
  tagline: "两个小伙伴帮你摇大绳，绳子甩到脚下就起跳，看你能连跳多少个！",
  howto: [
    "站在两个小伙伴中间，看着绳子从头顶甩下来。",
    "绳子快到脚下、脚边的圆圈收紧时，双脚一起跳起来。",
    "每连跳 4 个绳子就加速一次；绊到也没关系，绳子会慢一点重新开始。",
  ],
  stars: [10, 25, 40],

  cover(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#ffe6a6");
    g.addColorStop(0.75, "#ffb36b");
    g.addColorStop(1, "#e2542f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // 地面
    ctx.fillStyle = "rgba(16,32,27,0.18)";
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.93, w * 0.42, h * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    const hgt = h * 0.62;
    for (const [x, pal] of [[w * 0.12, FRIEND_L], [w * 0.88, FRIEND_R]]) {
      drawAvatar(ctx, standingJoints(x, h * 0.92, hgt), { palette: pal, inkW: 4 });
    }
    // 绳子在脚下
    ctx.save();
    ctx.lineCap = "round";
    for (const [col, lw] of [["#10201b", 10], [ROPE, 6]]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(w * 0.16, h * 0.62);
      ctx.quadraticCurveTo(w / 2, h * 1.18, w * 0.84, h * 0.62);
      ctx.stroke();
    }
    ctx.restore();
    const P = presetPose(w, h, "jump");
    for (const k of Object.keys(P)) P[k].y -= h * 0.08;
    drawAvatar(ctx, P, { palette: PAL, inkW: 5 });
  },

  start(rt) {
    S = blank();
    rt.score = 0;
    rt.setScore(0);
    updateGeo(rt, rt.frame, 1);
    rt.say("绳子到脚下就跳！", { ms: 1800 });
  },

  update(dt, f, rt) {
    if (!S) return;
    S.t += dt;
    S.stateT += dt;
    S.jd.update(f, S.t, dt);
    updateGeo(rt, f, dt);

    const present = !!(f && f.ok);
    S.noBodyT = present ? 0 : S.noBodyT + dt;

    if (S.state === "ready") {
      if (S.stateT > 1.4 && present) startTurning(rt);
    } else if (S.state === "turn") {
      if (S.noBodyT > 1.2) {
        S.state = "wait";
        S.stateT = 0;
      } else {
        const before = Math.floor(S.phase);
        S.phase += dt / S.period;
        if (Math.floor(S.phase) !== before) onBottom(rt);
      }
    } else if (S.state === "trip") {
      if (S.stateT > 1.4 && present) startTurning(rt);
    } else if (S.state === "wait") {
      if (present && S.stateT > 0.6) startTurning(rt);
    }

    // 判定：绳子到底之后再等一小会儿（摄像头有延迟）
    while (S.pending.length && S.t >= S.pending[0].tb + 0.24) {
      const p = S.pending.shift();
      if (S.state === "turn") judge(rt, p);
    }

    S.parts.update(dt);
    for (let i = S.pops.length - 1; i >= 0; i--) {
      const p = S.pops[i];
      p.t += dt;
      p.y -= dt * (p.big ? 30 : 70);
      if (p.t > 0.9) S.pops.splice(i, 1);
    }
  },

  draw(ctx, rt) {
    if (!S || !S.geo) return;
    const { W, H } = rt;
    const f = rt.frame;
    const g = S.geo;
    const hasCam = rt.camera(1, "saturate(0.85) brightness(1.04)");
    if (!hasCam) {
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#ffe6a6");
      bg.addColorStop(0.7, "#ffc27a");
      bg.addColorStop(1, "#f08a4b");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
    } else {
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "rgba(255,230,166,0.22)");
      bg.addColorStop(1, "rgba(226,84,47,0.32)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
    }

    // 地面影子
    ctx.save();
    ctx.fillStyle = "rgba(16,32,27,0.18)";
    ctx.beginPath();
    ctx.ellipse(W / 2, g.floor + 6, (g.xr - g.xl) * 0.5, g.s * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawRope(ctx, false);
    drawFriend(ctx, -1, FRIEND_L);
    drawFriend(ctx, 1, FRIEND_R);

    // 脚下的节奏圈：绳子越近圈越小
    if (S.state === "turn") {
      const lead = (Math.ceil(S.phase) - S.phase) * S.period;
      if (lead < 0.7) {
        const k = clamp(lead / 0.7, 0, 1);
        const r = g.s * (0.7 + k * 1.3);
        ctx.save();
        ctx.strokeStyle = lead < 0.22 ? "#48e08a" : "#fffaf0";
        ctx.globalAlpha = 0.5 + (1 - k) * 0.5;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.ellipse(g.cx, g.floor, r, r * 0.26, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        if (lead < 0.3) {
          outlineText(ctx, "跳！", g.cx + g.s * 1.4, g.floor - g.s * 0.3, { size: Math.min(46, g.s * 0.6), fill: "#48e08a" });
        }
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
      drawAvatar(ctx, f.pts, { palette: PAL, alpha: 0.98, inkW: Math.max(3, f.bodyScale * 0.045) });
      ctx.restore();
    } else {
      drawAvatar(ctx, standingJoints(W / 2, g.floor, g.floor - g.head), { palette: PAL, alpha: 0.28, showFace: false, inkW: 4 });
    }

    drawRope(ctx, true);
    S.parts.draw(ctx);

    for (const p of S.pops) {
      const a = clamp(1 - (p.t - 0.5) / 0.4, 0, 1);
      const sc = easeOutBack(clamp(p.t / 0.25, 0, 1));
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(sc, sc);
      outlineText(ctx, p.text, 0, 0, { size: p.big ? 52 : 40, fill: p.color, alpha: a });
      ctx.restore();
    }

    if (S.combo >= 3) {
      outlineText(ctx, `连跳 ${S.combo}`, W / 2, Math.max(110, g.head - g.s * 1.2), { size: 30, fill: "#ffd166" });
    }

    if (S.state === "ready") {
      outlineText(ctx, "站到两个小伙伴中间", W / 2, H * 0.22, { size: 30 });
    } else if (S.state === "wait") {
      outlineText(ctx, "没看到你，站回绳子中间", W / 2, H * 0.22, { size: 26 });
    }
  },

  finish() {
    const s = S || blank();
    const tries = s.count + s.trips;
    const rate = tries ? s.count / tries : 0;
    const rpm = Math.round(60 / s.fastest);
    const good = s.count >= 25;
    return {
      score: s.count,
      headline: s.count >= 40 ? "跳绳小飞人！" : good ? "跳得真稳！" : "跳起来啦",
      desc: good
        ? "看准绳子、踩准节奏，连跳一长串，前庭觉和节奏感都很在线。"
        : "刚开始绊几次很正常。盯着脚边的圆圈，它变绿的时候再跳。",
      rows: [
        { label: "跳过", value: `${s.count} 个` },
        { label: "最多连跳", value: `${s.bestCombo} 个` },
        { label: "被绊到", value: `${s.trips} 次` },
        { label: "最快绳速", value: `${rpm} 圈/分` },
      ],
      sensory: [
        { label: "前庭与平衡", value: clamp(s.count / 40, 0.05, 1) },
        { label: "节奏感", value: clamp(rate, 0.05, 1) },
        { label: "下肢爆发力", value: clamp(s.jd.jumps / 45, 0.05, 1) },
      ],
      tip: rate < 0.6
        ? "小提示：先不看屏幕，大人拍手「一、二、跳」，孩子跟着节拍原地跳十下，再回来跳绳会顺很多。"
        : "小提示：落地时提醒孩子用前脚掌、膝盖微微弯，既安静又保护膝盖，还能跳得更久。",
    };
  },
};
