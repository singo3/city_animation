// Particle City — 斜め上（固定カメラ）× 白背景 × Hue=40.57
// 軽量：道路/人を抑制、波紋分割を削減、走路サンプリング抑制
// 見せ場：エッジランナー増量＋ハロ
// 追加：z=0 の地面をうっすら粒で可視化（gminで密度下限を制御）

// --- 基本定数 ---
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
function rad(d){ return d * DEG; }

// --- カラーパレット（HEX→HSL変換） ---
function hexToHSL(hex){
  const sanitized = hex.replace('#', '');
  const bigint = parseInt(sanitized, 16);
  const r = ((bigint >> 16) & 255) / 255;
  const g = ((bigint >> 8) & 255) / 255;
  const b = (bigint & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return {
    h: +(h * 360).toFixed(2),
    s: +(s * 100).toFixed(2),
    l: +(l * 100).toFixed(2)
  };
}

const COLOR_PRIMARY_HEX = '#FFD400';
const COLOR_ACCENT_HEX = '#F9DE83';
const COLOR_PRIMARY = hexToHSL(COLOR_PRIMARY_HEX);
const COLOR_ACCENT = hexToHSL(COLOR_ACCENT_HEX);
const ROAD_COLORS = [COLOR_PRIMARY, COLOR_ACCENT];
const LIT_BASE_DEFAULT = +(COLOR_PRIMARY.l + 8).toFixed(2);
const GROUND_SAT_DEFAULT = +((COLOR_ACCENT.s * 0.4)).toFixed(2);
const PEOPLE_COLOR = {
  h: COLOR_ACCENT.h,
  s: Math.min(100, +(COLOR_ACCENT.s * 0.85).toFixed(2)),
  l: Math.max(0, +(COLOR_ACCENT.l - 10).toFixed(2))
};
const RIPPLE_DOT_COLOR = {
  h: COLOR_PRIMARY.h,
  s: Math.min(100, +(COLOR_PRIMARY.s * 0.9).toFixed(2)),
  l: Math.min(100, +(COLOR_PRIMARY.l + 20).toFixed(2))
};
const RIPPLE_RING_COLOR = {
  h: COLOR_PRIMARY.h,
  s: Math.min(100, +(COLOR_PRIMARY.s * 0.8).toFixed(2)),
  l: Math.min(100, +(COLOR_PRIMARY.l + 15).toFixed(2))
};

// --- パラメータ ---
const q = new URLSearchParams(location.search);
const HUE        = +(q.get('hue') || COLOR_PRIMARY.h);
const SAT        = +(q.get('sat') || COLOR_PRIMARY.s);
const LIT_BASE   = +(q.get('lit') || LIT_BASE_DEFAULT);
const PD         = +(q.get('pd')  || 1);

// 粒子配分
const DEN_EDGE   = +(q.get('denEdge')   || 1.6);
const DEN_ROAD   = +(q.get('denRoad')   || 0.26);
const DEN_PEOPLE = +(q.get('denPeople') || 0.28);

// ★地面（ここがポイント）
const DEN_GROUND = +(q.get('denGround') || 0.7);  // 既定で見える程度
const G_STEP     = +(q.get('gstep')     || 14);  // ベース間隔（小ほど濃い）
const G_MIN      = +(q.get('gmin')      || 1);   // 最小間隔の下限（超重要）
const G_ALPHA    = +(q.get('galpha')    || 1); // 透明度ベース

// ★地面の色（既定はHUEを流用）
const G_HUE = +(q.get('ghue') ?? COLOR_ACCENT.h);  // 例: 青にしたい→ ?ghue=220
const G_SAT = +(q.get('gsat') ?? GROUND_SAT_DEFAULT);   // 地面の彩度（控えめが綺麗）例: ?gsat=35
const GROUND_COLOR_VARIANTS = [
  {
    h: COLOR_PRIMARY.h,
    s: Math.min(100, +(COLOR_PRIMARY.s * 0.92).toFixed(2)),
    l: Math.min(100, +(COLOR_PRIMARY.l + 4).toFixed(2))
  },
  {
    h: COLOR_ACCENT.h,
    s: Math.min(100, +(COLOR_ACCENT.s * 0.98).toFixed(2)),
    l: Math.min(100, +(COLOR_ACCENT.l + 6).toFixed(2))
  }
];
const USE_CUSTOM_GROUND_COLOR = q.has('ghue') || q.has('gsat');

// ★地面粒子サイズの調整用（必要に応じてURLパラメータで上書きも可）
const G_SIZE   = +(q.get('gsize')   || 2.5); // 基本半径（小さめ既定）
const G_JIT    = +(q.get('gjit')    || 0.25); // 揺らぎ幅（0〜）
const G_SHRINK = +(q.get('gshrink') || 1.0); // 遠景の最小倍率（0.0〜1.0）：遠くでどこまで小さくするか
const G_GAMMA  = +(q.get('ggamma')  || 0.2);  // 距離減衰のカーブ（>1で遠景をさらに小さく）

// 平面波
const WAVE     = (q.get('wave') ?? '1') !== '0';
const W_LAMBDA = +(q.get('wlambda') || 420);
const W_SPEED  = +(q.get('wspeed')  || 0.35);
const W_DIR    = rad(20);
const W_PUSH   = +(q.get('wpush')   || 0.12);
const W_DEPTH  = +(q.get('wdepth')  || 0.8);

// 波紋（軽量設定）
const RIPPLE   = (q.get('ripple') ?? '1') !== '0';
const R_MODE   = (q.get('rmode')  || 'both');
const R_MAX    = +(q.get('rmax')   || 40);
const R_EMIT   = +(q.get('remit')  || 0.4);
const R_SPEED  = +(q.get('rspeed') || 20.0);
const R_THICK  = +(q.get('rthick') || 28);
const R_SEGS   = +(q.get('rsegs')  || 128);
const R_JIT    = +(q.get('rjit')   || 2.0);
const R_ALPHA  = +(q.get('ralpha') || 1.0);
const HUB_RATE = +(q.get('hubrate')|| 0.55);

// 自動発生する波紋だけ遅く/濃さ別に（クリックは従来どおり）
const R_SPEED_AUTO  = +(q.get('rspeed_auto')  || 3.0);       // ←ゆっくり広がる
const R_ALPHA_AUTO  = +(q.get('ralpha_auto')  || 1.2);   // 見えづらい時は 0.8〜1.2 で調整

// ポインタ力学（踏襲）
const MINT   = (q.get('mint') ?? '1') !== '0';
const MMODE  = (q.get('mmode') || 'hybrid');
const MR     = +(q.get('mr')    || 360);
const MSTR   = +(q.get('ms')    || -0.5);
const MSWL   = +(q.get('msw')   || 0.8);
const MBOOST = +(q.get('mboost')|| 0.6);
const MPULSE = +(q.get('mpulse')|| 1.2);

// 都市スケール
const WORLD_W = 1600, WORLD_H = 2200;
const GRID_X  = 220,  GRID_Y  = 200;
const ROAD_W_MAIN = 60, ROAD_W_GRID = 36;

// 粒子数（画面スケールで）
let N_ROAD, N_PEOPLE, N_RUNNERS;

// 固定カメラ（見下ろし）
const cam = {
  pos:{x:0,y:0,z:0}, yaw:rad(0), pitch:rad(30), fov:rad(90), dist:600,
  target:{x:600,y:0,z:280}
};
const basis = { right:[1,0,0], up:[0,0,1], fwd:[0,1,0] };
let focal = 1;

// データ
let roads=[], hubs=[], buildings=[], loops=[];
let roadParticles=[], people=[], edgeRunners=[], ripples=[];
let groundParticles=[]; // ★地面

// ポインタ
let pointerSX=0, pointerSY=0;
let pointerWX=0, pointerWY=0, prevWX=0, prevWY=0, mouseVX=0, mouseVY=0, mouseSpeed=0;

// エッジ表示
const ER_SIZE_H = +(q.get('ersizeh') || 2.8);
const ER_SIZE_V = +(q.get('ersizev') || 2.3);
const ER_ALPHA  = +(q.get('eralpha') || 0.95);
const ER_RING   = +(q.get('ering')   || 6.0);
const ER_JIT    = +(q.get('erjit')   || 1.0);
const ER_SPEEDS = { vert:0.85, flat:1.05 };

// ---------- Setup ----------
function setup(){
  const cnv = createCanvas(window.innerWidth, window.innerHeight);
  if (cnv && cnv.canvas){ cnv.canvas.style.touchAction='none'; cnv.canvas.oncontextmenu=e=>e.preventDefault(); }
  pixelDensity(PD);
  colorMode(HSL, 360,100,100,1);
  noStroke();
  focal = (height*0.5)/Math.tan(cam.fov*0.5);

  const scaleA = Math.sqrt((width*height)/(1280*720));
  N_ROAD    = floor(900 * scaleA * DEN_ROAD);
  N_PEOPLE  = floor(360 * scaleA * DEN_PEOPLE);
  N_RUNNERS = floor(1200 * scaleA * DEN_EDGE);

  designCity();
  bakeLoops();
  seedParticles();
  seedGroundParticles(); // ★

  document.addEventListener('visibilitychange', ()=>{ if (document.hidden) noLoop(); else loop(); });
}
function windowResized(){
  resizeCanvas(window.innerWidth, window.innerHeight);
  pixelDensity(PD);
  focal = (height*0.5)/Math.tan(cam.fov*0.5);
}

// ---------- City ----------
function designCity(){
  roads=[]; hubs=[]; buildings=[]; loops=[];
  roads.push({ pts: [{x:-WORLD_W*0.6,y:-WORLD_H*0.1},{x:WORLD_W*0.6,y:WORLD_H*0.9}], width: ROAD_W_MAIN });
  roads.push({ pts: [{x: WORLD_W*0.15,y:-WORLD_H*0.9},{x:WORLD_W*0.10,y:WORLD_H*0.9}], width: ROAD_W_MAIN });
  for (let x=-WORLD_W/2; x<=WORLD_W/2; x+=GRID_X){
    roads.push({ pts:[{x, y:-WORLD_H/2-400},{x, y:WORLD_H/2+400}], width: ROAD_W_GRID });
  }
  for (let y=-WORLD_H/2; y<=WORLD_H/2; y+=GRID_Y){
    roads.push({ pts:[{x:-WORLD_W/2-400, y},{x:WORLD_W/2+400, y}], width: ROAD_W_GRID });
  }
  for (let x=-WORLD_W/2; x<=WORLD_W/2; x+=GRID_X){
    for (let y=-WORLD_H/2; y<=WORLD_H/2; y+=GRID_Y){
      if (random() < HUB_RATE) hubs.push({x: x+random(-20,20), y: y+random(-20,20)});
    }
  }
  for (let gx=-WORLD_W/2; gx<WORLD_W/2; gx+=GRID_X){
    for (let gy=-WORLD_H/2; gy<WORLD_H/2; gy+=GRID_Y){
      if (random() < 0.92){
        const cx = gx + GRID_X*0.5 + random(-GRID_X*0.15, GRID_X*0.15);
        const cy = gy + GRID_Y*0.5 + random(-GRID_Y*0.15, GRID_Y*0.15);
        const w  = GRID_X*random(0.45,0.95);
        const h  = GRID_Y*random(0.45,0.95);
        const ch = min(w,h)*0.1;
        const poly = chamferRect(cx-w/2, cy-h/2, w, h, ch);
        const height = random(120, 520) * (random()<0.18 ? random(1.0,2.0) : 1.0);
        buildings.push({ poly, h: height });
      }
    }
  }
}

// 輪郭エッジ（外周/屋上/垂直）
function bakeLoops(){
  loops=[];
  for (const b of buildings){
    const p=b.poly; if (!p || p.length<3) continue;
    for (let i=0;i<p.length;i++){
      const a=p[i], c=p[(i+1)%p.length];
      addEdge(loops, a.x,a.y,0,   c.x,c.y,0,   p);
      addEdge(loops, a.x,a.y,b.h, c.x,c.y,b.h, p);
      addEdge(loops, a.x,a.y,0,   a.x,a.y,b.h, p, true);
    }
  }
}
function addEdge(arr, ax,ay,az, bx,by,bz, poly, vertical=false){
  const vx=bx-ax, vy=by-ay, vz=bz-az;
  const len=Math.hypot(vx,vy,vz); if (len<1e-6) return;
  let nx=vy, ny=-vx;
  const mx=(ax+bx)/2, my=(ay+by)/2;
  const inside = pointInPolygon(mx + nx*0.01, my + ny*0.01, poly);
  if (inside){ nx=-nx; ny=-ny; }
  const nl=Math.hypot(nx,ny); if (nl>1e-9){ nx/=nl; ny/=nl; }
  arr.push({ ax,ay,az, bx,by,bz, len, nx,ny, vertical });
}

// ---------- Seed ----------
function seedParticles(){
  roadParticles=[]; people=[]; edgeRunners=[]; ripples=[];
  const roadTargets = bakeRoadTargets(8);

  for (let i=0; i<N_ROAD; i++){
    const t = roadTargets[floor(random(roadTargets.length))];
    roadParticles.push({
      x: t.x + random(-6,6), y: t.y + random(-6,6), z: 0,
      tx: t.tx, ty: t.ty, speed: random(0.8,1.6), seed: random(1000), maxDrift: random(18,28),
      color: ROAD_COLORS[i % ROAD_COLORS.length]
    });
  }
  for (let i=0; i<N_PEOPLE; i++){
    const t = roadTargets[floor(random(roadTargets.length))];
    people.push({
      x: t.x + random(-8,8), y: t.y + random(-8,8), z: 0,
      tx: t.tx, ty: t.ty, speed: random(0.25,0.55), jitter: random(1000), maxDrift: random(14,22)
    });
  }

  // エッジランナー
  let sum=0; for (const e of loops) sum += e.len;
  const targetCount = N_RUNNERS;
  for (const e of loops){
    const quota = max(1, floor(targetCount * (e.len/sum)));
    for (let k=0;k<quota;k++){
      const s=random(e.len);
      edgeRunners.push({
        edge:e, s, dir: random([1,-1]),
        speed: (e.vertical? ER_SPEEDS.vert : ER_SPEEDS.flat) * random(0.85,1.25),
        seed: random(10000)
      });
    }
  }
}
function bakeRoadTargets(step=8){
  const targets=[];
  for (const r of roads){
    for (let i=0;i<r.pts.length-1;i++){
      const a=r.pts[i], b=r.pts[i+1];
      const vx=b.x-a.x, vy=b.y-a.y; const L=Math.hypot(vx,vy); if (L<step) continue;
      const tx=vx/L, ty=vy/L, nx=-ty, ny=tx;
      const lanes = max(1, floor((r.width*0.5)/6));
      const N=floor(L/step);
      for (let s=0;s<=N;s++){
        const t=s/N, x=a.x+vx*t, y=a.y+vy*t;
        for (let k=-lanes;k<=lanes;k++){
          const off=(k/lanes)*r.width*0.45;
          targets.push({ x:x+nx*off, y:y+ny*off, tx,ty });
        }
      }
    }
  }
  return targets;
}

// ★地面粒子（z=0／建物の床は抜き）
function seedGroundParticles(){
  groundParticles = [];
  const step = Math.max(G_MIN, Math.floor(G_STEP / Math.sqrt(Math.max(0.1, DEN_GROUND))));
  for (let x=-WORLD_W/2; x<=WORLD_W/2; x+=step){
    for (let y=-WORLD_H/2; y<=WORLD_H/2; y+=step){
      const gx = x + random(-step*0.45, step*0.45);
      const gy = y + random(-step*0.45, step*0.45);
      let inside = false;
      for (const b of buildings){ if (pointInPolygon(gx, gy, b.poly)){ inside = true; break; } }
      if (inside) continue;
      groundParticles.push({
        x: gx,
        y: gy,
        seed: random(10000),
        palette: floor(random(GROUND_COLOR_VARIANTS.length))
      });
    }
  }
}

// ---------- Draw ----------
function draw(){
  updateCameraBasis();

  // ポインタ（スクリーン→地表）
  if (touches && touches.length>0){ pointerSX=touches[0].x; pointerSY=touches[0].y; }
  else { pointerSX=mouseX; pointerSY=mouseY; }
  const g = screenToGround(pointerSX, pointerSY);
  if (g){
    const dx=g.x-prevWX, dy=g.y-prevWY;
    mouseVX=lerp(mouseVX,dx,0.4); mouseVY=lerp(mouseVY,dy,0.4);
    mouseSpeed=Math.hypot(mouseVX,mouseVY);
    pointerWX=g.x; pointerWY=g.y; prevWX=g.x; prevWY=g.y;
  }

  background(0,0,100,1); // 白

  // 地面：最初に淡く敷く
  drawGround();

  // エッジランナー
  for (const p of edgeRunners){
    const e=p.edge;
    let t=(p.s/e.len)%1; if (t<0) t+=1;
    let x=lerp(e.ax,e.bx,t), y=lerp(e.ay,e.by,t), z=lerp(e.az,e.bz,t);

    const ring = (e.vertical? 3.0 : ER_RING);
    const jit  = (e.vertical? 0.8 : ER_JIT);
    x += e.nx * (ring + jit * sin(frameCount*0.027 + p.seed));
    y += e.ny * (ring + jit * cos(frameCount*0.025 + p.seed));
    if(!e.vertical) z += 0.6*sin(frameCount*0.015+p.seed);

    const pr=project(x,y,z); if(!pr.visible) continue;

    const F = planeWave(x,y,frameCount);
    const tw = 1.0 + 0.35*F;
    const baseSize = (e.vertical? ER_SIZE_V : ER_SIZE_H);
    const size = baseSize * tw * pr.scale;
    const alpha= ER_ALPHA * tw * pr.fade;

    fill(HUE, SAT*0.9, Math.min(95, depthLightness(z,y)+12), alpha*0.16);
    circle(pr.x, pr.y, size*1.9);

    fill(HUE, SAT, depthLightness(z,y), alpha);
    circle(pr.x, pr.y, size);

    const flowNoise = 0.6 + 0.4*sin(frameCount*0.02+p.seed);
    p.s += p.dir * p.speed * flowNoise;
    if (p.s<0) p.s+=e.len; if (p.s>e.len) p.s-=e.len;
  }

  // 道路
  for (const p of roadParticles){
    if (WAVE && W_PUSH){ const d=[Math.cos(W_DIR), Math.sin(W_DIR)]; p.x+=d[0]*W_PUSH; p.y+=d[1]*W_PUSH; }
    const mf = mouseForce(p.x, p.y, 1.0); if (mf){ p.x+=mf.x; p.y+=mf.y; }
    const gust = 1.0 + 0.9*mouseBoostAt(p.x,p.y);
    p.x += p.tx * 1.6 * p.speed * gust;
    p.y += p.ty * 1.6 * p.speed * gust;
    p.x += (noise(p.seed, frameCount*0.01)-0.5)*0.4;
    p.y += (noise(p.seed+99, frameCount*0.01)-0.5)*0.4;

    if (abs(p.x)>WORLD_W || abs(p.y)>WORLD_H){ const r=random(roads), a=r.pts[0], b=r.pts[1]||r.pts[0]; p.x=a.x; p.y=a.y; }
    const pr=project(p.x,p.y,0); if(!pr.visible) continue;
    const c = p.color || COLOR_ACCENT;
    fill(c.h, c.s, c.l, 0.60*pr.fade);
    circle(pr.x, pr.y, 1.5*pr.scale);
  }

  // 人
  for (const p of people){
    const hop = 1.0 + 0.1*sin(frameCount*0.12 + p.jitter);
    const mf = mouseForce(p.x, p.y, 0.55); if (mf){ p.x+=mf.x; p.y+=mf.y; }
    p.x += p.tx * 0.65 * p.speed * hop;
    p.y += p.ty * 0.65 * p.speed * hop;
    if (random()<0.01){
      const r=random(roads), i=floor(random(r.pts.length-1));
      const a=r.pts[i], b=r.pts[i+1]; const vx=b.x-a.x, vy=b.y-a.y, L=Math.hypot(vx,vy);
      p.tx=vx/L; p.ty=vy/L;
    }
    const pr=project(p.x,p.y,0); if(!pr.visible) continue;
    fill(PEOPLE_COLOR.h, PEOPLE_COLOR.s, PEOPLE_COLOR.l, 0.68*pr.fade);
    circle(pr.x, pr.y, 1.1*pr.scale);
  }

  // 波紋
  if (RIPPLE && random()<R_EMIT && hubs.length){ const h=random(hubs); rippleAutoAt(h.x,h.y); }
  if (RIPPLE) drawRipples();
}

// --- 地面 ---
function drawGround(){
  for (const gp of groundParticles){
    const pr = project(gp.x, gp.y, 0);
    if (!pr.visible) continue;

    // 白地に負けないような明度とアルファ（既存ロジック）
    const depth = pr.fade;                         // 近い:1 ←→ 遠い:~0.35
    const palette = GROUND_COLOR_VARIANTS[(gp.palette ?? 0) % GROUND_COLOR_VARIANTS.length] || GROUND_COLOR_VARIANTS[0];
    const hue = USE_CUSTOM_GROUND_COLOR ? G_HUE : palette.h;
    const satBase = USE_CUSTOM_GROUND_COLOR ? G_SAT : palette.s;
    const litBase = USE_CUSTOM_GROUND_COLOR ? 70 : palette.l;
    const S = Math.min(100, satBase + (1.0 - depth) * 6);  // 遠景ほんのり淡く
    const L = Math.min(100, litBase + (1.0 - depth) * 8);  // 遠景は少し明るく
    const a     = G_ALPHA * (0.9*depth + 0.1);    // 遠景ほど薄く
    const wob   = 1 + 0.12 * sin(frameCount*0.02 + gp.seed);

    // === サイズ計算（小さく＋距離減衰）========================
    // 基本サイズ（小さめ既定）＋わずかな揺らぎ
    let r = (G_SIZE + G_JIT * wob) * pr.scale;

    // 距離による縮小（深度=pr.fade を 0.35〜1.0 → 0〜1 に正規化して使う方法もあるが、
    // ここでは fade そのものを使う）
    // 1) ガンマカーブで遠景をさらに抑える（ggamma>1で遠景小さく）
    const gammaScale = Math.pow(depth, Math.max(0.01, G_GAMMA)); // 安定のため下限
    // 2) 線形補間で「遠いほどG_SHRINKに近づく」
    const shrinkScale = lerp(G_SHRINK, 1.0, depth);              // depth=0.35→~G_SHRINK, depth=1→1.0

    r *= gammaScale * shrinkScale;

    // あまりに小さくなりすぎるのを防ぐ最小サイズ（任意）
    r = Math.max(0.25, r);

    // ===========================================================
    fill(hue, S, L, a);
    circle(pr.x, pr.y, r);
  }
}

// --- インタラクション ---
function mousePressed(){ pointerPulseAt(pointerWX, pointerWY); return false; }
function touchStarted(){
  if (touches && touches.length>0){
    const g = screenToGround(touches[0].x, touches[0].y);
    if (g) pointerPulseAt(g.x, g.y);
  }
  return false;
}
function touchMoved(){ if (touches && touches.length>0){ pointerSX=touches[0].x; pointerSY=touches[0].y; } return false; }
function mouseWheel(e){ return false; }

// --- 力学 ---
function mouseForce(px, py, scale=1.0){
  if (!MINT) return null;
  const dx=px-pointerWX, dy=py-pointerWY;
  const r2=MR*MR, d2=dx*dx+dy*dy; if (d2>r2) return null;
  const d=Math.sqrt(d2)+1e-6, g=Math.exp(-(d*d)/(2*(MR*0.6)*(MR*0.6)));
  let fx=0, fy=0;
  if (MMODE==='scoop'||MMODE==='hybrid'){ const sp=(mouseSpeed/20); fx+=mouseVX*0.12*MSTR*g*sp; fy+=mouseVY*0.12*MSTR*g*sp; }
  if (MMODE==='attract'||MMODE==='hybrid'){ fx+=(-dx/d)*0.8*MSTR*g; fy+=(-dy/d)*0.8*MSTR*g; }
  if (MMODE==='repel'){ fx+=(dx/d)*0.8*MSTR*g; fy+=(dy/d)*0.8*MSTR*g; }
  if (MMODE==='swirl'||MMODE==='hybrid'){ const tx=-dy/d, ty=dx/d; const s=MSWL*MSTR*g*(0.2+mouseSpeed/20); fx+=tx*s; fy+=ty*s; }
  return {x:fx*scale, y:fy*scale};
}
function pointerPulseAt(x, y){
  if (RIPPLE) rippleAt(x, y);
  const R=MR*0.9, R2=R*R, kick=1.0*MPULSE;
  for (let i=0;i<roadParticles.length;i+=2){
    const p=roadParticles[i]; const dx=p.x-x, dy=p.y-y; const d2=dx*dx+dy*dy;
    if (d2<R2){ const d=Math.sqrt(d2)||1; p.x+=(dx/d)*kick; p.y+=(dy/d)*kick; }
  }
  for (let i=0;i<people.length;i+=3){
    const p=people[i]; const dx=p.x-x, dy=p.y-y; const d2=dx*dx+dy*dy;
    if (d2<R2){ const d=Math.sqrt(d2)||1; p.x+=(dx/d)*kick*0.7; p.y+=(dy/d)*kick*0.7; }
  }
}

// --- Ripple ---
function rippleAt(x,y){
  ripples.push({ x,y, r:10, life:0, alpha:R_ALPHA, seed:random(1000), speed:R_SPEED });
  if (ripples.length > R_MAX) ripples.shift();
}
function rippleAutoAt(x, y){
  ripples.push({ x, y, r: 10, life: 0, alpha: R_ALPHA_AUTO, seed: random(1000), speed: R_SPEED_AUTO });
  if (ripples.length > R_MAX) ripples.shift();
}
function drawRipples(){
  for (let i=ripples.length-1; i>=0; i--){
    const w=ripples[i];
    w.life += 1;
    const jitterGrow = 1 + 0.06 * sin(frameCount*0.07 + w.seed);
    w.r += w.speed * jitterGrow;
    const alpha = w.alpha * Math.exp(-w.life*0.016);
    if (R_MODE==='dot' || R_MODE==='both'){
      for (let j=0;j<R_SEGS;j++){
        const a=(j/R_SEGS)*TAU;
        const jit = R_JIT * (noise(w.seed + j*0.013, frameCount*0.01) - 0.5);
        const rr = Math.max(1, w.r + jit);
        const x = w.x + Math.cos(a)*rr;
        const y = w.y + Math.sin(a)*rr;
        const pr = project(x,y,0); if(!pr.visible) continue;
        const sz = 1.2 + 0.6 * Math.sin(a*2 + w.life*0.05);
        fill(RIPPLE_DOT_COLOR.h, RIPPLE_DOT_COLOR.s, RIPPLE_DOT_COLOR.l, alpha*0.8*pr.fade);
        circle(pr.x, pr.y, sz*pr.scale);
      }
    }
    if (R_MODE==='grad' || R_MODE==='both'){
      const steps = 8;
      for (let k=0;k<steps;k++){
        const t = k/(steps-1);
        const rr = w.r - R_THICK/2 + t*R_THICK; if (rr<=0) continue;
        const fade = 1 - Math.abs((t*2)-1);
        const a2 = alpha * (0.65 * Math.pow(fade, 0.9));
        for (let j=0;j<R_SEGS;j++){
          const a=(j/R_SEGS)*TAU;
          const x = w.x + Math.cos(a)*rr;
          const y = w.y + Math.sin(a)*rr;
          const pr = project(x,y,0); if(!pr.visible) continue;
          fill(RIPPLE_RING_COLOR.h, RIPPLE_RING_COLOR.s, RIPPLE_RING_COLOR.l, a2*0.6*pr.fade);
          circle(pr.x, pr.y, (0.9+0.35*fade)*pr.scale);
        }
      }
    }
    if (alpha<0.03 || w.r>Math.max(WORLD_W,WORLD_H)) ripples.splice(i,1);
  }
}

// --- Camera / Math ---
function updateCameraBasis(){
  const cx = cam.target.x + cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw);
  const cy = cam.target.y + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw);
  const cz = cam.target.z + cam.dist * Math.sin(cam.pitch);
  cam.pos.x=cx; cam.pos.y=cy; cam.pos.z=cz;
  const fwd = normalize([cam.target.x-cam.pos.x, cam.target.y-cam.pos.y, cam.target.z-cam.pos.z]);
  const worldUp=[0,0,1];
  const right = normalize(cross(fwd, worldUp));
  const up    = normalize(cross(right, fwd));
  basis.fwd=fwd; basis.right=right; basis.up=up;
}
function project(x,y,z){
  const vx=x-cam.pos.x, vy=y-cam.pos.y, vz=z-cam.pos.z;
  const cx=dot([vx,vy,vz], basis.right);
  const cy=dot([vx,vy,vz], basis.up);
  const cz=dot([vx,vy,vz], basis.fwd);
  if (cz<=4) return {visible:false};
  const sx=(cx*focal)/cz, sy=(cy*focal)/cz;
  const fade = constrain(map(cz, 200, cam.dist*2.2, 1, 0.35), 0, 1);
  const scale=constrain(map(cz, 200, cam.dist*1.6, 1.3, 0.7), 0.5, 2.0);
  return { visible:true, x:width*0.5+sx, y:height*0.5-sy, fade, scale };
}
function screenToGround(x,y){
  const px=(x-width*0.5), py=-(y-height*0.5);
  const dir=normalize([
    basis.fwd[0] + (px/focal)*basis.right[0] + (py/focal)*basis.up[0],
    basis.fwd[1] + (px/focal)*basis.right[1] + (py/focal)*basis.up[1],
    basis.fwd[2] + (px/focal)*basis.right[2] + (py/focal)*basis.up[2],
  ]);
  const t = -cam.pos.z / dir[2];
  if (t<=0) return null;
  return { x: cam.pos.x + dir[0]*t, y: cam.pos.y + dir[1]*t };
}
function planeWave(x,y,t){
  if (!WAVE) return 0;
  const dir=[Math.cos(W_DIR), Math.sin(W_DIR)];
  const s=x*dir[0]+y*dir[1];
  const k=TAU/Math.max(1,W_LAMBDA);
  const w=TAU*(W_SPEED/Math.max(1,W_LAMBDA));
  return Math.cos(k*s - w*t);
}
function mouseBoostAt(x,y){ const g=220; const d=Math.hypot(pointerWX-x, pointerWY-y); return Math.exp(- (d*d) / (2*g*g)); }
function depthLightness(z,y){
  const tZ = constrain(map(z, 0, 600, 0, 1), 0, 1);
  const tY = constrain(map(y, -WORLD_H*0.6, WORLD_H*0.7, 0, 1), 0, 1);
  return constrain(LIT_BASE + (tZ*6) + (tY*4), 40, 75);
}
function chamferRect(x,y,w,h,ch){
  return [
    {x:x+ch,y},{x:x+w-ch,y},
    {x:x+w,y:y+ch},{x:x+w,y:y+h-ch},
    {x:x+w-ch,y:y+h},{x:x+ch,y:y+h},
    {x:x,y:y+h-ch},{x:x,y:y+ch}
  ];
}
function pointInPolygon(x,y,poly){
  let inside=false;
  for (let i=0,j=poly.length-1;i<poly.length;j=i++){
    const xi=poly[i].x, yi=poly[i].y, xj=poly[j].x, yj=poly[j].y;
    const inter=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/((yj-yi)||1e-9)+xi);
    if (inter) inside=!inside;
  }
  return inside;
}
function dot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function cross(a,b){ return [ a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0] ]; }
function normalize(v){ const l=Math.hypot(v[0],v[1],v[2]); return l>1e-9?[v[0]/l,v[1]/l,v[2]/l]:[0,0,0]; }
