// Particle City — 粒子の集合で「道路」と「建物（家/ビルの形）」を描く
// + 波紋オーバーレイ（残像なし） + ① 音を可視化する粒の波（平面波フィールド） + マウスダイナミクス
//
// URL 例:
// ?hue=215&bden=1.1&rden=1.0&flow=1.2&fnoise=1.4&turb=1.1&gust=1.3&jump=0.004&contours=0
//   &ripple=1&rmode=both&rmax=8&remit=0.025&rspeed=2.0&rthick=14&rsegs=90&rjit=0.8&ralpha=0.35&hubrate=0.6
//   &wave=1&wlambda=220&wspeed=1.2&wdepth=0.9&wdir=0&wpush=0.12
//   &mmode=hybrid&mr=220&ms=1.6&msw=0.7&mboost=0.8&mint=1&mpulse=1.2

// ---------- Params ----------
const q = new URLSearchParams(location.search);
const HUE   = +q.get('hue')   || 40.57;  // 色相（HSLの0–360°）
const BDEN  = +q.get('bden')  || 0.1;    // 建物の粒子密度
const RDEN  = +q.get('rden')  || 0.5;    // 道路の粒子密度
const FLOW  = +q.get('flow')  || 0.25;   // 道路粒子の基本速度（デフォルトを半減）
const FLOW_NOISE = +(q.get('fnoise') || 0.1); // フローフィールド強さ
const TURB       = +(q.get('turb')   || 1.0); // 乱流係数
const GUST       = +(q.get('gust')   || 2.0); // マウス“ガスト”
const RETARGET   = +(q.get('jump')   || 0.1); // 再割当確率/フレーム
const SHOW_CONTOURS = false;                  // 輪郭点描表示

// ---- Ripple overlay params ----
const RIPPLE        = (q.get('ripple') ?? '1') !== '0'; // 波紋ON/OFF
const R_MODE        = (q.get('rmode')  || 'both');      // 'dot' | 'grad' | 'both'
const R_MAX         = +(q.get('rmax')  || 8);           // 同時波紋最大数
const R_EMIT        = +(q.get('remit') || 0.01);        // 発生確率/フレーム
const R_SPEED       = +(q.get('rspeed')|| 1.0);         // 半径拡大(px/f)
const R_THICK       = +(q.get('rthick')|| 14);          // グラデ帯の太さ
const R_SEGS        = +(q.get('rsegs') || 90);          // ドット粒数/周
const R_JIT         = +(q.get('rjit')  || 0.8);         // ドットジッター
const R_ALPHA       = +(q.get('ralpha')|| 0.5);         // 波紋の基準透明度
const HUB_RATE      = +(q.get('hubrate')|| 0.6);        // ハブ生成率

const DEG = Math.PI / 180;
function deg2rad(d){ return d * DEG; }

// ---- Plane wave (① 粒の波) params ----
const WAVE     = (q.get('wave') ?? '1') !== '0';      // 平面波ON/OFF
const W_LAMBDA = +(q.get('wlambda') || 180);          // 波長(px)
const W_SPEED  = +(q.get('wspeed')  || 1.2);          // 進行速度(px/フレーム)
const W_DEPTH  = +(q.get('wdepth')  || 1.0);          // 変調深さ
const W_DIRRAD = deg2rad(+q.get('wdir') || 0);        // 進行方向（ラジアン）
const W_PUSH   = +(q.get('wpush')   || 0.12);         // 粒子に与える微小推進力

// ---- Mouse dynamics params ----
const MINT     = (q.get('mint') ?? '1') !== '0';   // マウス力ON/OFF
const MMODE    = (q.get('mmode') || 'hybrid');     // 'scoop'|'attract'|'repel'|'swirl'|'hybrid'
const MR       = +(q.get('mr')    || 360);         // 作用半径(px)
const MSTR     = +(q.get('ms')    || -0.5);         // 強さ(全体ゲイン)
const MSWL     = +(q.get('msw')   || 0.8);         // 渦(接線)の重み
const MBOOST   = +(q.get('mboost')|| 0.6);         // マウス速度に応じた最大速ブースト
const MPULSE   = +(q.get('mpulse')|| 1.2);         // クリック時のパルス強度

// ---------- State ----------
let buildings = [];    // { poly:[{x,y}...], holes?: [[{x,y}...]], extras?: [poly...] }
let roads = [];        // { pts:[{x,y}...], width:number }
let roadTargets = [];  // {x,y, tx,ty}
let bldgTargets = [];  // {x,y, rectId}
let roadParticles = [];
let bldgParticles = [];

// Ripple overlay state
let hubs = [];         // 交差点など音源
let ripples = [];      // {x,y,r,life,alpha,seed}

// Offscreen layers
let trailG;            // 粒子（都市）レイヤ：毎フレーム clear（残像ゼロ）
let rippleG;           // 波紋レイヤ：毎フレーム clear

let linkDist, binSize, cols, rows;

// Mouse velocity (smoothed)
let mouseVX = 0, mouseVY = 0, mouseSpeed = 0;

// ---------- Setup ----------
function setup(){
  createCanvas(window.innerWidth, window.innerHeight);
  const pd = (window.devicePixelRatio > 1 ? 1.5 : 1);
  pixelDensity(pd);
  colorMode(HSL,360,100,100,1);
  noStroke();

  // レイヤ作成
  trailG = createGraphics(width, height);
  trailG.pixelDensity(pd);
  trailG.colorMode(HSL,360,100,100,1);
  trailG.noStroke();
  // trailG.background(220,18,7,1); // 初期化（ベース色）
  trailG.background(0, 0, 100, 1); // 初期化（白）

  rippleG = createGraphics(width, height);
  rippleG.pixelDensity(pd);
  rippleG.colorMode(HSL,360,100,100,1);
  rippleG.noStroke();
  rippleG.clear(); // 透明

  const L = Math.sqrt(width*height);
  linkDist = constrain(L*0.07, 90, 160);
  binSize  = linkDist;
  cols = ceil(width/binSize);
  rows = ceil(height/binSize);

  designCity();    // 家/ビルの形 + ハブ
  bakeTargets();   // ターゲット点
  seedParticles(); // 粒子生成

  document.addEventListener('visibilitychange', ()=>{ if (document.hidden) noLoop(); else loop(); });
}
function windowResized(){ setup(); }

// ---------- Flow field ----------
function flowVec(x, y, t, s=0.0015){
  const a = noise(x*s, y*s, t) * TAU * 2.0;
  return createVector(cos(a), sin(a));
}

// ---------- Plane wave field (① 粒の波) ----------
function planeWave(x, y, tFrame){
  if (!WAVE) return 0;
  const dirx = cos(W_DIRRAD), diry = sin(W_DIRRAD);
  const s = x*dirx + y*diry;                  // 進行方向への射影
  const k = TAU / max(1, W_LAMBDA);           // 波数
  const omega = TAU * (W_SPEED / max(1, W_LAMBDA)); // 角周波数（rad/フレーム）
  const phi = k*s - omega*tFrame;
  return cos(phi); // -1 .. 1
}

// ---------- Mouse force (Gaussian falloff within MR) ----------
function mouseForce(px, py, strengthScale = 1.0){
  if (!MINT) return null;
  const dx = px - mouseX, dy = py - mouseY;
  const r2 = MR * MR;
  const d2 = dx*dx + dy*dy;
  if (d2 > r2) return null;

  const d = Math.sqrt(d2) + 1e-6;
  const g = Math.exp(-(d*d) / (2 * (MR*0.6) * (MR*0.6))); // ガウス減衰
  let fx = 0, fy = 0;

  // scoop: マウス移動方向に“すくい上げ”
  if (MMODE === 'scoop' || MMODE === 'hybrid'){
    const speedGain = (mouseSpeed / 20); // 0..(おおよそ)2
    fx += mouseVX * 0.12 * MSTR * g * speedGain;
    fy += mouseVY * 0.12 * MSTR * g * speedGain;
  }
  // attract/repel: 中心へ/外へ
  if (MMODE === 'attract' || MMODE === 'hybrid'){
    fx += (-dx / d) * 0.8 * MSTR * g;
    fy += (-dy / d) * 0.8 * MSTR * g;
  }
  if (MMODE === 'repel'){
    fx += ( dx / d) * 0.8 * MSTR * g;
    fy += ( dy / d) * 0.8 * MSTR * g;
  }
  // swirl: 円周方向（渦）
  if (MMODE === 'swirl' || MMODE === 'hybrid'){
    const tx = -dy / d, ty = dx / d;                 // 接線単位ベクトル
    const s  = MSWL * MSTR * g * (0.2 + mouseSpeed/20);
    fx += tx * s; fy += ty * s;
  }
  return { x: fx * strengthScale, y: fy * strengthScale };
}

// ---------- Draw ----------
function draw(){
  const tNow = frameCount * 0.003;

  // マウス移動ベクトル（なめらかに）backgroundblendMode
  const mdx = mouseX - (pmouseX || mouseX);
  const mdy = mouseY - (pmouseY || mouseY);
  mouseVX = lerp(mouseVX, mdx, 0.4);
  mouseVY = lerp(mouseVY, mdy, 0.4);
  mouseSpeed = Math.hypot(mouseVX, mouseVY);

  // 1) 粒子レイヤ（残像ゼロ）
  trailG.clear();
  drawRoadParticles(trailG, tNow);
  drawBuildingParticles(trailG, tNow);
  if (SHOW_CONTOURS) drawBuildingContoursOn(trailG);

  // 2) 波紋レイヤ（残像ゼロ）
  if (RIPPLE) drawRipplesOn(rippleG);

  // 3) 合成
  // background(220, 18, 7, 1);
  background(0, 0, 100, 1);
  image(trailG, 0, 0, width, height);
  if (RIPPLE) image(rippleG, 0, 0, width, height);
}

// ---------- Particles (Road) ----------
function drawRoadParticles(g, tNow){
  const dirx = cos(W_DIRRAD), diry = sin(W_DIRRAD);
  for (const p of roadParticles){
    const t = p.target;
    const breath = 0.85 + 0.15 * sin(frameCount*0.02 + p.seed);

    // 基本の誘引＋接線＋ノイズ
    const to  = createVector(t.x - p.x, t.y - p.y).mult(0.03 * breath);
    const tan = createVector(t.tx, t.ty).mult(0.22 * FLOW * breath);
    const fv  = flowVec(p.x, p.y, tNow).mult(0.6 * FLOW_NOISE * TURB);

    // 平面波（①）：推進力
    let F = planeWave(p.x, p.y, frameCount);  // -1..1
    if (WAVE && W_PUSH){
      p.v.x += dirx * W_PUSH * F;
      p.v.y += diry * W_PUSH * F;
    }

    // 既存“ガスト”をマウス速度に応じ強化
    const dmx = p.x - mouseX, dmy = p.y - mouseY;
    const dm2 = dmx*dmx + dmy*dmy;
    if (dm2 < 140*140){
      const amp = (1 - sqrt(dm2)/140);
      tan.mult(1 + GUST * amp * (0.5 + 0.5 * min(1, mouseSpeed/10)));
    }

    // 追加：マウス力（風/渦/すくい上げ）
    const mfR = mouseForce(p.x, p.y, 1.0);
    if (mfR){ p.v.x += mfR.x; p.v.y += mfR.y; }

    p.v.add(to).add(tan).add(fv);
    p.v.mult(0.92);
    p.v.x += (noise(p.seed,        frameCount*0.01)-0.5)*0.25;
    p.v.y += (noise(p.seed + 1000, frameCount*0.01)-0.5)*0.25;

    const vmax = 3.2 * breath * (1 + MBOOST * (mouseSpeed / 18)); // マウス速度で上限可変
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

    // ① 明滅（サイズ/アルファ変調）
    const baseAlpha = 0.45 + 0.15 * breath;
    const baseSize  = 1.7 + 0.7 * breath;
    const w01 = (F + 1) * 0.5; // 0..1
    const alpha = baseAlpha * (1.0 + W_DEPTH * 0.6 * (w01 - 0.5));
    const size  = baseSize  * (1.0 + W_DEPTH * 0.35 * (w01 - 0.5));

    g.fill(HUE, 80, 50, alpha);
    g.circle(p.x, p.y, size);
  }
}

// ---------- Particles (Buildings) ----------
function drawBuildingParticles(g, tNow){
  const dirx = cos(W_DIRRAD), diry = sin(W_DIRRAD);
  for (const p of bldgParticles){
    const t = p.target;
    const breath = 0.9 + 0.1 * sin(frameCount*0.018 + p.seed);

    // 基本の誘引 + ゆるい周回 + ノイズ
    const to  = createVector(t.x - p.x, t.y - p.y).mult(0.035 * breath);
    const ang = noise(p.seed, frameCount*0.012) * TAU*2;
    const orb = createVector(cos(ang), sin(ang)).mult(0.22 * breath);
    const fv  = flowVec(p.x, p.y, tNow).mult(0.35 * FLOW_NOISE);

    // 平面波（①）：建物は推進力を弱め
    let F = planeWave(p.x, p.y, frameCount);  // -1..1
    if (WAVE && W_PUSH){
      p.v.x += dirx * W_PUSH * 0.5 * F;
      p.v.y += diry * W_PUSH * 0.5 * F;
    }

    // 既存の軽い吸引/反発に加えて…
    const dx = p.x - mouseX, dy = p.y - mouseY;
    const d2 = dx*dx + dy*dy;
    if (d2 < 120*120){
      const d = sqrt(d2)+0.001;
      const k = (0.3 * (1 - d/120));
      to.x += -dx/d * k * 0.15;
      to.y += -dy/d * k * 0.15;
    }

    // 追加：マウス力（やや控えめ）
    const mfB = mouseForce(p.x, p.y, 0.6);
    if (mfB){ p.v.x += mfB.x; p.v.y += mfB.y; }

    p.v.add(to).add(orb).add(fv);
    p.v.mult(0.9);
    p.v.x += (noise(p.seed,        frameCount*0.013)-0.5)*0.18;
    p.v.y += (noise(p.seed + 2000, frameCount*0.013)-0.5)*0.18;

    const vmax = 2.6 * breath * (1 + 0.8 * MBOOST * (mouseSpeed / 18));
    if (p.v.mag() > vmax) p.v.setMag(vmax);

    p.x += p.v.x; p.y += p.v.y;

    if (random() < RETARGET*0.6){
      const nt = random(bldgTargets);
      p.target = nt; p.x = nt.x + random(-2,2); p.y = nt.y + random(-2,2);
    }
    if (dist(p.x,p.y,t.x,t.y) > p.maxDrift){
      p.x = t.x + random(-2,2); p.y = t.y + random(-2,2);
      p.v.mult(0);
    }

    // ① 明滅（控えめ）
    const baseAlpha = 0.68 + 0.07 * breath;
    const baseSize  = 1.3 + 0.4 * breath;
    const w01 = (F + 1) * 0.5; // 0..1
    const alpha = baseAlpha * (1.0 + W_DEPTH * 0.35 * (w01 - 0.5));
    const size  = baseSize  * (1.0 + W_DEPTH * 0.25 * (w01 - 0.5));

    g.fill(HUE, 70, 45, alpha);
    g.circle(p.x, p.y, size);
  }
}

// ---------- Ripple Overlay (no trail) ----------
function emitRipple(){
  if (!hubs.length) return;
  const h = random(hubs);
  ripples.push({ x: h.x, y: h.y, r: 10, life: 0, alpha: R_ALPHA, seed: random(1000) });
  if (ripples.length > R_MAX) ripples.shift();
}
function drawRipplesOn(g){
  if (random() < R_EMIT) emitRipple();

  g.clear();           // 残像ゼロ
  g.push();
  // g.blendMode(ADD);    // にじむ発光
  g.blendMode(BLEND);    // にじむ発光
  for (let i = ripples.length - 1; i >= 0; i--){
    const w = ripples[i];
    w.life += 1;
    const jitterGrow = 1 + 0.06 * sin(frameCount*0.07 + w.seed);
    w.r += R_SPEED * jitterGrow;

    const alpha = w.alpha * exp(-w.life*0.015);

    // ドットリング
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

    // グラデーションリング
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

// ---------- City Layout（家/ビル形状 + ハブ生成） ----------
function designCity(){
  buildings = [];
  roads = [];
  hubs = [];

  const W = width, H = height;
  const gx = max(120, floor(W/9));
  const gy = max(120, floor(H/6));

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

  // ビル系ブロック
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

  // 住宅：切妻屋根の家（交点周辺）
  for (let x=gx; x<W; x+=gx){
    for (let y=gy; y<H; y+=gy){
      if (random() < 0.55){
        const w = random(40, 70), h = random(26, 40);
        const cx = x + random(-gx*0.35, gx*0.35);
        const cy = y + random(-gy*0.35, gy*0.35);
        buildings.push(houseGable(cx - w/2, cy - h/2, w, h, random([0, PI/2, PI])));
      }
    }
  }
}

// ---------- Target Baking ----------
function bakeTargets(){
  roadTargets = [];
  bldgTargets = [];

  // 道路：中心線を等間隔サンプル→幅方向に複製
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

  // 建物：poly + holes + extras
  const edgeStep = 4, edgeBand = 10, fillStep = 7;
  for (let id=0; id<buildings.length; id++){
    const b = buildings[id];
    bakePolyTargets(b.poly, b.holes||[], id);
    const extras = b.extras || [];
    for (const e of extras) bakePolyTargets(e, [], id);
  }
  function bakePolyTargets(poly, holes, id){
    for (let i=0;i<poly.length;i++){
      const p0 = poly[i], p1 = poly[(i+1)%poly.length];
      const L = dist(p0.x,p0.y,p1.x,p1.y);
      const N = max(2, floor(L/edgeStep));
      for (let s=0; s<=N; s++){
        const t = s/N;
        const x = lerp(p0.x,p1.x,t), y = lerp(p0.y,p1.y,t);
        const nx = normalize({x:(p1.y-p0.y), y:-(p1.x-p0.x)}); // 左法線
        for (let b=0; b<edgeBand; b+=2){
          const off = (b/edgeBand) * 8 + random(-0.6,0.6);
          const ix = x + nx.x*off, iy = y + nx.y*off;
          if (pointInBuilding(ix,iy,{poly,holes})) bldgTargets.push({x:ix, y:iy, rectId:id});
        }
      }
    }
    const bb = bbox(poly);
    for (let x=bb.x; x<=bb.x+bb.w; x+=fillStep){
      for (let y=bb.y; y<=bb.y+bb.h; y+=fillStep){
        if (pointInBuilding(x,y,{poly,holes}) && random()<0.25){
          bldgTargets.push({x, y, rectId:id});
        }
      }
    }
  }

  // 密度スケール
  if (RDEN !== 1.0){ const keepR = constrain(RDEN, 0.4, 2.0); roadTargets = roadTargets.filter(()=> random() < keepR); }
  if (BDEN !== 1.0){ const keepB = constrain(BDEN, 0.4, 2.0); bldgTargets = bldgTargets.filter(()=> random() < keepB); }
}

// ---------- Seed Particles ----------
function seedParticles(){
  roadParticles = [];
  bldgParticles = [];

  const nR = min(roadTargets.length, 2200);
  for (let i=0;i<nR;i++){
    const t = roadTargets[floor(random(roadTargets.length))];
    roadParticles.push({
      x: t.x + random(-3,3), y: t.y + random(-3,3), v: createVector(0,0),
      target: t, maxDrift: random(18,28), seed: random(10000)
    });
  }

  const nB = min(bldgTargets.length, 2600);
  for (let i=0;i<nB;i++){
    const t = bldgTargets[floor(random(bldgTargets.length))];
    bldgParticles.push({
      x: t.x + random(-2,2), y: t.y + random(-2,2), v: createVector(0,0),
      target: t, maxDrift: random(14,22), seed: random(10000)
    });
  }
}

// ---------- Contours（読解性UP/オプション） ----------
function drawBuildingContoursOn(g){
  g.stroke(HUE, 40, 60, 0.35);
  g.strokeWeight(1);
  const step = 5;
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
    const extras = b.extras || [];
    for (const e of extras){
      for (let i=0;i<e.length;i++){
        const a = e[i], c = e[(i+1)%e.length];
        const L = dist(a.x,a.y,c.x,c.y);
        const N = max(2, floor(L/step));
        for (let s=0;s<=N;s++){
          const t=s/N; const x=lerp(a.x,c.x,t), y=lerp(a.y,c.y,t);
          g.point(x,y);
        }
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
function normalize(v){
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
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
  if (building.holes){
    for (const h of building.holes){ if (pointInPolygon(x,y,h)) return false; }
  }
  return true;
}

// ---------- Mouse pulse ----------
function mousePressed(){
  if (RIPPLE){
    ripples.push({ x: mouseX, y: mouseY, r: 10, life: 0, alpha: R_ALPHA*1.2, seed: random(1000) });
    if (ripples.length > R_MAX) ripples.shift();
  }
  const R = MR * 0.9, R2 = R*R;
  const kick = 1.0 * MPULSE;   // 強度
  for (let i=0; i<roadParticles.length; i+=2){  // 半分だけ適用して負荷軽減
    const p = roadParticles[i];
    const dx = p.x - mouseX, dy = p.y - mouseY; const d2 = dx*dx + dy*dy;
    if (d2 < R2){ const d = Math.sqrt(d2)||1; p.v.x += (dx/d) * kick; p.v.y += (dy/d) * kick; }
  }
  for (let i=0; i<bldgParticles.length; i+=3){  // 1/3に適用
    const p = bldgParticles[i];
    const dx = p.x - mouseX, dy = p.y - mouseY; const d2 = dx*dx + dy*dy;
    if (d2 < R2){ const d = Math.sqrt(d2)||1; p.v.x += (dx/d) * kick*0.7; p.v.y += (dy/d) * kick*0.7; }
  }
}
