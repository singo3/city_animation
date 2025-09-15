// Particle City — 粒子で「道路」と「建物」を描く
// + 波紋（残像なし） + 平面波（粒の波） + マウス/タッチ ダイナミクス
// + ★エッジランナー：輪郭上を粒が周回し、静的点描なしで外形を“粒だけ”で描く
// + ★モバイル対応：タップで波紋、指1本でPCマウス同等の挙動

// ---------- Params ----------
const q = new URLSearchParams(location.search);
const HUE   = +q.get('hue')   || 40.57;     // 色相（HSL 0–360）
const BDEN  = +q.get('bden')  || 1.0;       // 建物内部ターゲットの保持率スケール
const RDEN  = +q.get('rden')  || 10.0;      // 道路粒子密度
const FLOW  = +q.get('flow')  || 0.25;      // 道路粒子の基本速度（デフォルトを半減）
const FLOW_NOISE = +(q.get('fnoise') || 0.1);
const TURB       = +(q.get('turb')   || 1.0);
const GUST       = +(q.get('gust')   || 2.0);
const RETARGET   = +(q.get('jump')   || 0.1);
const SHOW_CONTOURS = true;                 // （デバッグ用の静的点描）※外形は粒のみで描画

// ---- Ripple overlay params ----
const RIPPLE        = (q.get('ripple') ?? '1') !== '0';
const R_MODE        = (q.get('rmode')  || 'both'); // 'dot'|'grad'|'both'
const R_MAX         = +(q.get('rmax')  || 8);
const R_EMIT        = +(q.get('remit') || 0.01);
const R_SPEED       = +(q.get('rspeed')|| 1.0);
const R_THICK       = +(q.get('rthick')|| 14);
const R_SEGS        = +(q.get('rsegs') || 90);
const R_JIT         = +(q.get('rjit')  || 0.8);
const R_ALPHA       = +(q.get('ralpha')|| 0.5);
const HUB_RATE      = +(q.get('hubrate')|| 0.6);

// ---- Plane wave (粒の波) params ----
const DEG = Math.PI / 180; function deg2rad(d){ return d * DEG; }
const WAVE     = (q.get('wave') ?? '1') !== '0';
const W_LAMBDA = +(q.get('wlambda') || 180);
const W_SPEED  = +(q.get('wspeed')  || 1.2);
const W_DEPTH  = +(q.get('wdepth')  || 1.0);
const W_DIRRAD = deg2rad(+q.get('wdir') || 0);
const W_PUSH   = +(q.get('wpush')   || 0.12);

// ---- Mouse/Touch dynamics params ----
const MINT     = (q.get('mint') ?? '1') !== '0';
const MMODE    = (q.get('mmode') || 'hybrid'); // 'scoop'|'attract'|'repel'|'swirl'|'hybrid'
const MR       = +(q.get('mr')    || 360);
const MSTR     = +(q.get('ms')    || -0.5);
const MSWL     = +(q.get('msw')   || 0.8);
const MBOOST   = +(q.get('mboost')|| 0.6);
const MPULSE   = +(q.get('mpulse')|| 1.2);

// ---- Edge runners（★輪郭を粒でなぞる）----
const ERUN      = (q.get('erun')   ?? '1') !== '0';
const E_RING    = +(q.get('ering')   || 2.0);
const ER_STEP   = +(q.get('erstep')  || 12.0);
const ER_SPEED  = +(q.get('erspeed') || 0.675);
const ER_JIT    = +(q.get('erjit')   || 0.9);
const ER_SIZE   = +(q.get('ersize')  || 1.7);
const ER_ALPHA  = +(q.get('eralpha') || 0.85);
const ER_TWINK  = +(q.get('ertwink') || 0.35);

// ---------- State ----------
let buildings = [];    // { poly:[{x,y}], holes?: [[{x,y}]], extras?: [poly] }
let roads = [];        // { pts:[{x,y}], width:number }
let hubs = [];

let roadTargets = [];
let bldgFillTargets = [];

let roadParticles = [];
let bldgParticles = [];    // 建物内部の“スワール粒子”（控えめ）

// ★輪郭を走るランナー（外形を描く主役）
let edgeLoopsByBuilding = []; // rectId -> [{segs:[{ax,ay,bx,by,len,tx,ty,nx,ny}], total}]
let edgeRunners = [];        // [{rectId, loopId, segIdx, sLocal, dir, speed, seed}]

let ripples = [];

let trailG, rippleG;
let linkDist, binSize, cols, rows;

// --- Unified pointer (mouse or single-touch) ---
let pointerX = 0, pointerY = 0;           // 現在位置（マウス/指）
let prevPointerX = 0, prevPointerY = 0;   // 前フレーム位置
let mouseVX = 0, mouseVY = 0, mouseSpeed = 0; // 既存ロジックを流用

// ---------- Setup ----------
function setup(){
  const cnv = createCanvas(window.innerWidth, window.innerHeight);
  // スクロール/ズーム抑止（モバイル）
  if (cnv && cnv.canvas) {
    cnv.canvas.style.touchAction = 'none';        // Android/Chrome, iOS/Safari
    cnv.canvas.oncontextmenu = e => e.preventDefault(); // 長押しメニュー抑止
  }

  const pd = (window.devicePixelRatio > 1 ? 1.5 : 1);
  pixelDensity(pd);
  colorMode(HSL,360,100,100,1);
  noStroke();

  trailG  = createGraphics(width, height); trailG.pixelDensity(pd);
  trailG.colorMode(HSL,360,100,100,1); trailG.noStroke();
  rippleG = createGraphics(width, height); rippleG.pixelDensity(pd);
  rippleG.colorMode(HSL,360,100,100,1); rippleG.noStroke(); rippleG.clear();

  const L = Math.sqrt(width*height);
  linkDist = constrain(L*0.07, 90, 160);
  binSize  = linkDist; cols = ceil(width/binSize); rows = ceil(height/binSize);

  // 初期ポインタ
  pointerX = prevPointerX = width*0.5;
  pointerY = prevPointerY = height*0.5;

  designCity();
  bakeTargets();
  seedParticles();

  document.addEventListener('visibilitychange', ()=>{ if (document.hidden) noLoop(); else loop(); });
}
function windowResized(){ setup(); }

// ---------- Fields ----------
function flowVec(x, y, t, s=0.0015){ const a = noise(x*s, y*s, t)*TAU*2.0; return createVector(cos(a), sin(a)); }
function planeWave(x, y, tf){
  if(!WAVE) return 0;
  const dirx=cos(W_DIRRAD), diry=sin(W_DIRRAD);
  const s=x*dirx+y*diry; const k=TAU/max(1,W_LAMBDA); const w=TAU*(W_SPEED/max(1,W_LAMBDA));
  return cos(k*s - w*tf); // -1..1
}
function gauss(x, sigma){ const s = sigma||1; return Math.exp(-(x*x)/(2*s*s)); }

// ---------- Mouse/Touch unified force ----------
function mouseForce(px, py, scale=1.0){
  if (!MINT) return null;
  const dx = px - pointerX, dy = py - pointerY;
  const r2 = MR * MR, d2 = dx*dx + dy*dy; if (d2 > r2) return null;
  const d = Math.sqrt(d2)+1e-6;
  const g = Math.exp(-(d*d) / (2 * (MR*0.6) * (MR*0.6)));
  let fx = 0, fy = 0;
  if (MMODE==='scoop' || MMODE==='hybrid'){ const sp = (mouseSpeed/20); fx += mouseVX*0.12*MSTR*g*sp; fy += mouseVY*0.12*MSTR*g*sp; }
  if (MMODE==='attract'||MMODE==='hybrid'){ fx += (-dx/d)*0.8*MSTR*g; fy += (-dy/d)*0.8*MSTR*g; }
  if (MMODE==='repel'){ fx += ( dx/d)*0.8*MSTR*g; fy += ( dy/d)*0.8*MSTR*g; }
  if (MMODE==='swirl' || MMODE==='hybrid'){ const tx = -dy/d, ty = dx/d; const s = MSWL*MSTR*g*(0.2+mouseSpeed/20); fx += tx*s; fy += ty*s; }
  return {x:fx*scale, y:fy*scale};
}

// ---------- Draw ----------
function draw(){
  const tNow = frameCount * 0.003;

  // 1) 現在のポインタ（マウス or 指1本）を取得
  if (touches && touches.length > 0){
    pointerX = touches[0].x;
    pointerY = touches[0].y;
  } else {
    pointerX = mouseX;
    pointerY = mouseY;
  }

  // 2) ポインタ速度（なめらかに）
  const mdx = pointerX - prevPointerX;
  const mdy = pointerY - prevPointerY;
  mouseVX = lerp(mouseVX, mdx, 0.4);
  mouseVY = lerp(mouseVY, mdy, 0.4);
  mouseSpeed = Math.hypot(mouseVX, mouseVY);

  trailG.clear();

  // ★輪郭ランナー（外形の可視化の主役）
  if (ERUN) drawEdgeRunners(trailG, tNow);

  // 道路 & 建物内部の動的粒子
  drawRoadParticles(trailG, tNow);
  drawBuildingInterior(trailG, tNow);

  // 波紋
  if (RIPPLE) drawRipplesOn(rippleG);

  // compose（白背景）
  background(0, 0, 100, 1);
  image(trailG, 0, 0, width, height);
  if (RIPPLE) image(rippleG, 0, 0, width, height);

  // 3) 前フレームとして保存
  prevPointerX = pointerX;
  prevPointerY = pointerY;
}

// ---------- Edge runners（輪郭を走る粒） ----------
function drawEdgeRunners(g, tNow){
  for (const p of edgeRunners){
    const loop = edgeLoopsByBuilding[p.rectId][p.loopId];
    let seg = loop.segs[p.segIdx];

    let t = (seg.len > 1e-6) ? (p.sLocal / seg.len) : 0.0;
    t = constrain(t, 0, 1);
    let cx = seg.ax + (seg.bx - seg.ax) * t;
    let cy = seg.ay + (seg.by - seg.ay) * t;

    const offN = E_RING + ER_JIT * sin(frameCount*0.03 + p.seed);
    cx += seg.nx * offN; cy += seg.ny * offN;

    const offT = 0.45 * sin(frameCount*0.027 + p.seed*1.7);
    cx += seg.tx * offT; cy += seg.ty * offT;

    const F = planeWave(cx, cy, frameCount);
    const gMouse = gauss(dist(cx,cy,pointerX,pointerY), 140);
    const tw = 1.0 + ER_TWINK * (0.6*F + 0.4*gMouse);
    const size = ER_SIZE * tw;
    const alpha = ER_ALPHA * tw;

    g.fill(HUE, 75, 58, alpha);
    g.circle(cx, cy, size);

    const fv = flowVec(cx, cy, tNow).mult(0.6*FLOW_NOISE);
    const dotT = fv.x*seg.tx + fv.y*seg.ty;
    const base = p.speed * (1 + 0.22*sin(frameCount*0.02 + p.seed));
    const mBoost = (1 + 0.75*MBOOST*(mouseSpeed/18)*gMouse);
    let ds = p.dir * (base*mBoost + dotT*1.0);

    p.sLocal += ds;
    while (p.sLocal >= seg.len){ p.sLocal -= seg.len; p.segIdx = (p.segIdx + 1) % loop.segs.length; seg = loop.segs[p.segIdx]; }
    while (p.sLocal < 0){ p.segIdx = (p.segIdx - 1 + loop.segs.length) % loop.segs.length; seg = loop.segs[p.segIdx]; p.sLocal += seg.len; }
  }
}

// ---------- Road particles ----------
function drawRoadParticles(g, tNow){
  const dirx=cos(W_DIRRAD), diry=sin(W_DIRRAD);
  for (const p of roadParticles){
    const t=p.target, breath=0.85+0.15*sin(frameCount*0.02+p.seed);
    const to=createVector(t.x-p.x,t.y-p.y).mult(0.03*breath);
    const tan=createVector(t.tx,t.ty).mult(0.22*FLOW*breath);
    const fv=flowVec(p.x,p.y,tNow).mult(0.6*FLOW_NOISE*TURB);

    const F=planeWave(p.x,p.y,frameCount);
    if (WAVE && W_PUSH){ p.v.x += dirx*W_PUSH*F; p.v.y += diry*W_PUSH*F; }

    const dmx=p.x-pointerX, dmy=p.y-pointerY, dm2=dmx*dmx+dmy*dmy;
    if (dm2 < 140*140){ const amp = (1 - sqrt(dm2)/140); tan.mult(1 + GUST * amp * (0.5 + 0.5 * min(1, mouseSpeed/10))); }

    const mf = mouseForce(p.x, p.y, 1.0); if (mf){ p.v.x += mf.x; p.v.y += mf.y; }

    p.v.add(to).add(tan).add(fv);
    p.v.mult(0.92);
    p.v.x += (noise(p.seed,        frameCount*0.01)-0.5)*0.25;
    p.v.y += (noise(p.seed + 1000, frameCount*0.01)-0.5)*0.25;

    const vmax = 3.2*breath*(1 + MBOOST*(mouseSpeed/18));
    if (p.v.mag() > vmax) p.v.setMag(vmax);

    p.x += p.v.x; p.y += p.v.y;

    if (random() < RETARGET){
      const nt = random(roadTargets);
      p.target = nt; p.x = nt.x + random(-3,3); p.y = nt.y + random(-3,3);
    }
    if (dist(p.x,p.y,t.x,t.y) > p.maxDrift){
      const nt = random(roadTargets);
      p.target = nt; p.x = nt.x + random(-3,3); p.y = nt.y + random(-3,3);
      p.v.mult(0.5);
    }

    const baseA=0.42+0.14*breath, baseS=1.6+0.6*breath, w01=(F+1)*0.5;
    g.fill(HUE, 80, 50, baseA*(1.0+W_DEPTH*0.6*(w01-0.5)));
    g.circle(p.x, p.y, baseS*(1.0+W_DEPTH*0.35*(w01-0.5)));
  }
}

// ---------- Building interior particles（控えめ） ----------
function drawBuildingInterior(g, tNow){
  const dirx=cos(W_DIRRAD), diry=sin(W_DIRRAD);
  for (const p of bldgParticles){
    const t = p.target;
    const breath = 0.9 + 0.1 * sin(frameCount*0.018 + p.seed);

    const to  = createVector(t.x - p.x, t.y - p.y).mult(0.035 * breath);
    const ang = noise(p.seed, frameCount*0.012) * TAU*2;
    const orb = createVector(cos(ang), sin(ang)).mult(0.18 * breath);
    const fv  = flowVec(p.x, p.y, tNow).mult(0.30 * FLOW_NOISE);

    const F = planeWave(p.x, p.y, frameCount);
    if (WAVE && W_PUSH){ p.v.x += dirx * W_PUSH * 0.4 * F; p.v.y += diry * W_PUSH * 0.4 * F; }

    const dx = p.x - pointerX, dy = p.y - pointerY;
    const d2 = dx*dx + dy*dy;
    if (d2 < 120*120){
      const d = sqrt(d2)+0.001;
      const k = (0.25 * (1 - d/120));
      to.x += -dx/d * k * 0.15; to.y += -dy/d * k * 0.15;
    }

    const mf = mouseForce(p.x, p.y, 0.55); if (mf){ p.v.x += mf.x; p.v.y += mf.y; }

    p.v.add(to).add(orb).add(fv);
    p.v.mult(0.9);
    p.v.x += (noise(p.seed,        frameCount*0.013)-0.5)*0.16;
    p.v.y += (noise(p.seed + 2000, frameCount*0.013)-0.5)*0.16;

    const vmax = 2.4 * breath * (1 + 0.7 * MBOOST * (mouseSpeed / 18));
    if (p.v.mag() > vmax) p.v.setMag(vmax);

    p.x += p.v.x; p.y += p.v.y;

    if (random() < RETARGET*0.5){
      const nt = random(bldgFillTargets);
      if (nt){ p.target = nt; p.x = nt.x + random(-2,2); p.y = nt.y + random(-2,2); }
    }
    if (dist(p.x,p.y,t.x,t.y) > p.maxDrift){
      p.x = t.x + random(-2,2); p.y = t.y + random(-2,2); p.v.mult(0);
    }

    const baseAlpha = 0.45 + 0.06 * breath;
    const baseSize  = 1.2 + 0.35 * breath;
    const w01 = (F + 1) * 0.5;
    const alpha = baseAlpha * (1.0 + W_DEPTH * 0.28 * (w01 - 0.5));
    const size  = baseSize  * (1.0 + W_DEPTH * 0.22 * (w01 - 0.5));

    g.fill(HUE, 68, 45, alpha);
    g.circle(p.x, p.y, size);
  }
}

// ---------- Ripple Overlay ----------
function emitRipple(){
  if (!hubs.length) return;
  const h = random(hubs);
  ripples.push({ x: h.x, y: h.y, r: 10, life: 0, alpha: R_ALPHA, seed: random(1000) });
  if (ripples.length > R_MAX) ripples.shift();
}
function rippleAt(x,y){
  ripples.push({ x, y, r: 10, life: 0, alpha: R_ALPHA*1.2, seed: random(1000) });
  if (ripples.length > R_MAX) ripples.shift();
}
function drawRipplesOn(g){
  if (random() < R_EMIT) emitRipple();
  g.clear();
  g.push();
  g.blendMode(BLEND);
  for (let i = ripples.length - 1; i >= 0; i--){
    const w = ripples[i];
    w.life += 1;
    const jitterGrow = 1 + 0.06 * sin(frameCount*0.07 + w.seed);
    w.r += R_SPEED * jitterGrow;
    const alpha = w.alpha * Math.exp(-w.life*0.015);

    if (R_MODE === 'dot' || R_MODE === 'both'){
      g.noStroke();
      for (let j=0; j<R_SEGS; j++){
        const a = (j / R_SEGS) * TAU;
        const jit = R_JIT * (noise(w.seed + j*0.013, frameCount*0.01) - 0.5);
        const rr = max(1, w.r + jit);
        const x = w.x + cos(a) * rr;
        const y = w.y + sin(a) * rr;
        const sz = 1.3 + 0.7 * sin(a*2 + w.life*0.05);
        g.fill(HUE, 90, 70, alpha*0.8);
        g.circle(x, y, sz);
      }
    }
    if (R_MODE === 'grad' || R_MODE === 'both'){
      g.noFill();
      const steps = 10;
      for (let k=0; k<steps; k++){
        const t = k/(steps-1);
        const rr = w.r - R_THICK/2 + t*R_THICK;
        if (rr <= 0) continue;
        const fade = 1 - abs((t*2)-1);
        const a2 = alpha * (0.65 * pow(fade, 0.9));
        g.stroke(HUE, 80, 65, a2);
        g.strokeWeight(1);
        g.circle(w.x, w.y, rr*2);
      }
    }

    if (alpha < 0.02 || w.r > max(width, height)*1.2){
      ripples.splice(i, 1);
    }
  }
  g.pop();
}

// ---------- City Layout（あなたの designCity をそのまま使用） ----------
function designCity(){
  buildings = [];
  roads = [];
  hubs = [];

  const W = width, H = height;
  const gx = max(110, floor(W/10));
  const gy = max(110, floor(H/7));

  // 主要道路
  roads.push({ pts: [{x:-50,y:H*0.65},{x:W+50,y:H*0.62}], width: 26 });
  roads.push({ pts: [{x:W*0.55,y:-50},{x:W*0.52,y:H+50}], width: 24 });
  roads.push({ pts: [{x:-60,y:H*0.25},{x:W*0.75,y:H*0.55},{x:W+60,y:H*0.75}], width: 20 });
  // 二次道路グリッド
  for(let x=gx; x<W; x+=gx) roads.push({pts:[{x:x,y:-50},{x:x,y:H+50}], width: 10});
  for(let y=gy; y<H; y+=gy) roads.push({pts:[{x:-50,y:y},{x:W+50,y:y}], width: 10});

  // ハブ（交差点）
  for (let x=gx; x<W; x+=gx){
    for (let y=gy; y<H; y+=gy){
      if (random() < constrain(HUB_RATE, 0, 1)){
        hubs.push({ x: x + random(-gx*0.15, gx*0.15), y: y + random(-gy*0.15, gy*0.15) });
      }
    }
  }

  // 大きめブロック（従来ベース）
  const blocks = [
    {x: W*0.08, y: H*0.10, w: W*0.18, h: H*0.20},
    {x: W*0.28, y: H*0.12, w: W*0.14, h: H*0.25},
    {x: W*0.46, y: H*0.08, w: W*0.18, h: H*0.18},
    {x: W*0.07, y: H*0.42, w: W*0.22, h: H*0.20},
    {x: W*0.34, y: H*0.44, w: W*0.18, h: H*0.22},
    {x: W*0.60, y: H*0.42, w: W*0.28, h: H*0.22},
    {x: W*0.18, y: H*0.74, w: W*0.22, h: H*0.18},
    {x: W*0.46, y: H*0.72, w: W*0.18, h: H*0.20}
  ];
  for (const b of blocks){
    const r = {x:b.x+6, y:b.y+6, w:b.w-12, h:b.h-12};
    const t = random();
    if (t < 0.33){
      const m = min(r.w, r.h) * 0.25;
      const outer = rectPoly(r.x, r.y, r.w, r.h);
      const inner = rectPoly(r.x+m, r.y+m, r.w-2*m, r.h-2*m);
      buildings.push({ poly: outer, holes: [inner] });
    } else if (t < 0.66){
      const cham = min(r.w, r.h)*0.10;
      const base = chamferRect(r.x, r.y, r.w, r.h, cham);
      const upx = r.x + r.w*0.18, upy = r.y + r.h*0.18;
      const upw = r.w*0.64, uph = r.h*0.64;
      const upper = chamferRect(upx, upy, upw, uph, cham*0.7);
      buildings.push({ poly: base, holes: [], extras: [upper] });
    } else {
      const cx = r.x + r.w/2, cy = r.y + r.h/2;
      const rad = min(r.w, r.h)*0.5;
      buildings.push({ poly: regularNGon(cx, cy, rad, 8, PI/8), holes: [] });
    }
  }

  // ★ 細分化ブロック：画面全域に小区画を量産して小建物を配置
  const lotW = gx * 0.48, lotH = gy * 0.42;
  const gap  = 6;
  for (let y=gap; y<H-gap-lotH; y += lotH + gap){
    for (let x=gap; x<W-gap-lotW; x += lotW + gap){
      if (random() < 0.95){
        const mx = x + random(-4,4), my = y + random(-4,4);
        const shapePick = random();
        const w = lotW * random(0.4, 1.1);
        const h = lotH * random(0.4, 1.1);
        if (shapePick < 0.35){
          const ch = min(w,h)*0.10;
          buildings.push({ poly: chamferRect(mx, my, w, h, ch), holes: [] });
        } else if (shapePick < 0.6){
          const cutW = w * random(0.35, 0.55);
          const cutH = h * random(0.35, 0.55);
          const poly = [
            {x:mx, y:my}, {x:mx+w, y:my}, {x:mx+w, y:my+cutH},
            {x:mx+cutW, y:my+cutH}, {x:mx+cutW, y:my+h}, {x:mx, y:my+h}
          ];
          buildings.push({ poly, holes: [] });
        } else if (shapePick < 0.8){
          const cx = mx + w/2, cy = my + h/2;
          const rad = min(w,h)*0.45;
          buildings.push({ poly: regularNGon(cx, cy, rad, 8, PI/8), holes: [] });
        } else {
          const rot = random([-PI/2, 0, PI/2, PI/4]);
          const house = houseGable(mx, my, w*0.9, h*0.8, rot);
          buildings.push(house);
        }
      }
    }
  }
}

// ---------- Target Baking（内部ターゲット + ★輪郭ループ） ----------
function bakeTargets(){
  roadTargets = [];
  bldgFillTargets = [];
  edgeLoopsByBuilding = [];

  // 道路ターゲット
  for (const r of roads){
    const segStep = 6;
    for (let i=0;i<r.pts.length-1;i++){
      const a=r.pts[i], b=r.pts[i+1];
      const L = dist(a.x,a.y,b.x,b.y);
      const N = max(2, floor(L/segStep));
      for (let s=0; s<=N; s++){
        const t=s/N; const x=lerp(a.x,b.x,t), y=lerp(a.y,b.y,t);
        const tx=(b.x-a.x)/L, ty=(b.y-a.y)/L;
        const half = r.width*0.5; const lanes = max(1, floor(half/4));
        for(let k=-lanes;k<=lanes;k++){
          const nx = -ty, ny = tx;
          const off = (k/lanes) * half * 0.9;
          roadTargets.push({x:x+nx*off, y:y+ny*off, tx:tx, ty:ty});
        }
      }
    }
  }
  if (RDEN !== 1.0){ const keepR = constrain(RDEN, 0.4, 2.0); roadTargets = roadTargets.filter(()=> random() < keepR); }

  // 建物内部ターゲット（控えめ）
  for (let id=0; id<buildings.length; id++){
    const b = buildings[id];
    const bb = bbox(b.poly);
    for (let x=bb.x; x<=bb.x+bb.w; x+=8){
      for (let y=bb.y; y<=bb.y+bb.h; y+=8){
        if (pointInBuilding(x,y,b) && random()<0.22){
          bldgFillTargets.push({x, y, rectId:id});
        }
      }
    }
  }
  if (BDEN !== 1.0){ const keepB = constrain(BDEN, 0.4, 2.0); bldgFillTargets = bldgFillTargets.filter(()=> random() < keepB); }

  // ★輪郭ループ生成
  edgeLoopsByBuilding = buildings.map(b=>{
    const loops = [];
    const paths = [b.poly].concat(b.extras||[]).concat(b.holes||[]);
    for (const poly of paths){
      if (!poly || poly.length < 2) continue;
      const area = signedArea(poly);       // CCW: +, CW: -
      const side = (area >= 0) ? +1 : -1;  // inside が“左”なら +1
      const segs = [];
      let total = 0;
      for (let i=0;i<poly.length;i++){
        const a = poly[i], c = poly[(i+1)%poly.length];
        const vx = c.x - a.x, vy = c.y - a.y;
        const len = Math.hypot(vx,vy); if (len < 1e-6) continue;
        const tx = vx/len, ty = vy/len;
        const nx = (ty) * side;            // 内側法線
        const ny = (-tx) * side;
        segs.push({ax:a.x, ay:a.y, bx:c.x, by:c.y, len, tx, ty, nx, ny});
        total += len;
      }
      if (segs.length) loops.push({segs, total});
    }
    return loops;
  });
}

// ---------- Seed Particles ----------
function seedParticles(){
  roadParticles = [];
  bldgParticles = [];
  edgeRunners = [];

  // Road
  const nR = min(roadTargets.length, 2200);
  for (let i=0;i<nR;i++){
    const t = roadTargets[floor(random(roadTargets.length))];
    roadParticles.push({
      x: t.x + random(-3,3), y: t.y + random(-3,3), v: createVector(0,0),
      target: t, maxDrift: random(18,28), seed: random(10000)
    });
  }

  // Building interior（控えめ）
  const nB = min(bldgFillTargets.length, 1100);
  for (let i=0;i<nB;i++){
    const t = bldgFillTargets[floor(random(bldgFillTargets.length))];
    bldgParticles.push({
      x: t.x + random(-2,2), y: t.y + random(-2,2), v: createVector(0,0),
      target: t, rectId: t.rectId, maxDrift: random(14,22), seed: random(10000)
    });
  }

  // ★Edge runners：全建物の輪郭長に比例して粒を配分
  if (ERUN){
    let sumLen = 0;
    const loopIndex = []; // [ {rectId, loopId, len} ... ]
    for (let rid=0; rid<edgeLoopsByBuilding.length; rid++){
      const loops = edgeLoopsByBuilding[rid];
      if (!loops) continue;
      for (let li=0; li<loops.length; li++){
        const len = loops[li].total;
        if (len > 0){ loopIndex.push({rectId:rid, loopId:li, len}); sumLen += len; }
      }
    }
    const targetCount = constrain(floor(sumLen / max(2, ER_STEP)), 300, 2400);
    for (const L of loopIndex){
      const loop  = edgeLoopsByBuilding[L.rectId][L.loopId];
      const quota = max(1, floor(targetCount * (L.len / sumLen)));
      for (let k=0; k<quota; k++){
        const sPick = random(L.len);
        let acc = 0, segIdx = 0, sLocal = 0;
        for (let i=0; i<loop.segs.length; i++){
          const len = loop.segs[i].len;
          if (sPick <= acc + len){ segIdx = i; sLocal = sPick - acc; break; }
          acc += len;
        }
        edgeRunners.push({
          rectId: L.rectId, loopId: L.loopId,
          segIdx, sLocal, dir: random([1,-1]),
          speed: ER_SPEED * random(0.85, 1.25),
          seed: random(10000)
        });
      }
    }
  }
}

// ---------- Helpers (contours debug) ----------
function drawBuildingContoursOn(g){
  if (!SHOW_CONTOURS) return;
  g.stroke(HUE, 40, 50, 0.45);
  g.strokeWeight(1);
  const step = 4;
  for (const b of buildings){
    const poly = b.poly;
    for (let i=0;i<poly.length;i++){
      const a = poly[i], c = poly[(i+1)%poly.length];
      const L = dist(a.x,a.y,c.x,c.y);
      const N = max(2, floor(L/step));
      for (let s=0;s<=N;s++){
        const t=s/N; const x=lerp(a.x,c.x,t), y=lerp(a.y,c.y,t);
        g.point(x,y);
      }
    }
  }
  g.noStroke();
}

// ---------- Geometry Helpers ----------
function rectPoly(x,y,w,h){ return [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]; }
function chamferRect(x,y,w,h,ch){
  return [
    {x:x+ch,y},{x:x+w-ch,y},
    {x:x+w,y:y+ch},{x:x+w,y:y+h-ch},
    {x:x+w-ch,y:y+h},{x:x+ch,y:y+h},
    {x:x,y:y+h-ch},{x:x,y:y+ch}
  ];
}
function regularNGon(cx,cy,r,n,rot=0){
  const poly=[]; for(let i=0;i<n;i++){const a=rot+i*TAU/n; poly.push({x:cx+r*cos(a), y:cy+r*sin(a)});} return poly;
}
function houseGable(x,y,w,h,rot=0){
  const roofH = h*0.6;
  const ridge = {x: x+w/2, y: y};
  const left  = {x,      y: y+roofH};
  const right = {x:x+w,  y: y+roofH};
  const baseL = {x,      y: y+h};
  const baseR = {x:x+w,  y: y+h};
  let poly = [ left, ridge, right, baseR, baseL, left ];
  if (rot){
    const cx = x+w/2, cy = y+h/2;
    poly = poly.map(p=>({ x: cx + (p.x-cx)*cos(rot) - (p.y-cy)*sin(rot),
                          y: cy + (p.x-cx)*sin(rot) + (p.y-cy)*cos(rot) }));
  }
  return { poly, holes: [] };
}
function pointInPolygon(x, y, poly){
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++){
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > y) !== (yj > y)) &&
                      (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function bbox(poly){
  let minX =  Infinity, minY =  Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly){
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
function pointInBuilding(x,y,building){
  if (!pointInPolygon(x,y,building.poly)) return false;
  if (building.holes){ for (const h of building.holes){ if (pointInPolygon(x,y,h)) return false; } }
  return true;
}
function signedArea(poly){
  let a = 0;
  for (let i=0, j=poly.length-1; i<poly.length; j=i++){
    const p = poly[i], q = poly[j];
    a += (q.x + p.x) * (q.y - p.y);
  }
  return a * 0.5; // +:CCW, -:CW
}

// ---------- Pointer pulses ----------
function pointerPulseAt(x, y){
  if (RIPPLE) rippleAt(x, y);
  const R = MR * 0.9, R2 = R*R;
  const kick = 1.0 * MPULSE;
  for (let i=0; i<roadParticles.length; i+=2){
    const p = roadParticles[i];
    const dx = p.x - x, dy = p.y - y; const d2 = dx*dx + dy*dy;
    if (d2 < R2){ const d = Math.sqrt(d2)||1; p.v.x += (dx/d) * kick; p.v.y += (dy/d) * kick; }
  }
  for (let i=0; i<bldgParticles.length; i+=3){
    const p = bldgParticles[i];
    const dx = p.x - x, dy = p.y - y; const d2 = dx*dx + dy*dy;
    if (d2 < R2){ const d = Math.sqrt(d2)||1; p.v.x += (dx/d) * kick*0.7; p.v.y += (dy/d) * kick*0.7; }
  }
}

// ---------- Mouse / Touch handlers ----------
// PC（マウス）—クリックで波紋＆パルス
function mousePressed(){
  pointerPulseAt(pointerX, pointerY);
  return false; // 既定動作抑止
}
// スマホ/タブレット（1本指）
function touchStarted(){
  if (touches && touches.length > 0){
    pointerX = touches[0].x; pointerY = touches[0].y;
    pointerPulseAt(pointerX, pointerY); // タップ＝クリック相当
  }
  return false; // スクロール等の既定動作を抑止（iOS/Android）
}
function touchMoved(){
  if (touches && touches.length > 0){
    pointerX = touches[0].x; pointerY = touches[0].y; // 指の位置を反映
  }
  return false; // 既定動作抑止
}
function touchEnded(){ return false; } // 既定動作抑止
