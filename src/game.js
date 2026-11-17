// ============================================================================
// battle mode: cube drones attack in waves; hitscan harpoon gun, HUD, radar, sound effects
// ============================================================================
// Rules
//   - Waves: wave n sends 3 + 2n enemies, at most 14 at once, spawned 40-70 m away where they can reach you. Clearing
//     a wave heals 25 HP and offers an upgrade. Enemies get a little faster every wave (up to +50 %).
//   - Enemy types (unlocked by wave):
//       Drone   (red, w1+)    3 HP, rams you for 12
//       Dart    (yellow, w2+) 1 HP, fast, rams you for 8
//       Brute   (purple, w3+) 12 HP, big and slow, rams you for 28
//       Spitter (green, w4+)  4 HP, keeps 18-28 m away and spits orange bolts (10 damage, they can be shot down)
//   - Gun: 24 rounds, 9 shots/s, 1 damage per hit, 120 m range, rock blocks shots. R reloads (1.4 s), empty reloads itself.
//   - You: 100 HP; after 5 s without damage you heal 4 HP/s. 0 HP ends the run; Enter starts again.
//   - Score: Drone 100, Dart 150, Brute 400, Spitter 250, bolt 25, wave clear 500 x wave, all kill/bolt points times
//     the combo multiplier. Best score is kept.
//   - Combo: every hit within the combo window (2 s, upgradable) adds 1; multiplier = 1 + 0.5 per 5 combo, max x8.
//     Taking damage or letting the window run out resets it.
//   - Roguelike: after each cleared wave the game pauses and offers 3 random upgrades (keys 1-3 or tap); stacks
//     up to each upgrade's limit. A run starts with no upgrades.
//   - Difficulty (低 / 中 / 高 / 鬼, chosen in the menu, kept): scales enemy count, speed, HP and damage, healing and
//     score; 中 is the base values above. See DIFFS.
//   - Ranking: top 10 runs per difficulty, kept in this browser (localStorage cubeAbyssRank).
// Pathing: enemies that can see you head straight for you; the others follow a flow field (breadth-first distances
// to you over a 3 m grid of open water, rebuilt a slice per frame), so they swim around rock instead of into it.
// Pools are preallocated; the frame loop only allocates strings when a HUD value changes and nodes for sound effects.

const FT = [ // hp, speed, half size, contact damage, colour, edge glow, points
  { hp: 3, sp: 6.5, s: 0.9, dmg: 12, r: 1, g: 0.22, b: 0.12, gl: 2.4, pts: 100 },
  { hp: 1, sp: 11, s: 0.5, dmg: 8, r: 1, g: 0.8, b: 0.1, gl: 2.8, pts: 150 },
  { hp: 12, sp: 3.6, s: 1.9, dmg: 28, r: 0.7, g: 0.25, b: 1, gl: 2, pts: 400 },
  { hp: 4, sp: 5, s: 1.0, dmg: 10, r: 0.15, g: 1, b: 0.55, gl: 2.4, pts: 250 },
];
const RANGE = 120, BOLTDMG = 10, BOLTSP = 14;
// difficulty: name, enemy count, speed, HP, damage, alive at once, spitter fire interval, regen delay (s, Infinity =
// none), regen per s, wave clear heal, score multiplier
const DIFFS = [
  { id: 'easy', name: '低', cnt: 0.7, sp: 0.75, hp: 1, dmg: 0.5, alive: 10, cd: 1.5, rd: 3, rr: 6, heal: 40, sc: 0.5 },
  { id: 'normal', name: '中', cnt: 1, sp: 1, hp: 1, dmg: 1, alive: 14, cd: 1, rd: 5, rr: 4, heal: 25, sc: 1 },
  { id: 'hard', name: '高', cnt: 1.3, sp: 1.2, hp: 1.3, dmg: 1.5, alive: 17, cd: 0.8, rd: 7, rr: 3, heal: 15, sc: 1.5 },
  { id: 'oni', name: '鬼', cnt: 2.6, sp: 1.6, hp: 1.6, dmg: 2, alive: 22, cd: 0.6, rd: Infinity, rr: 0, heal: 10, sc: 3.5 },
];
let DI = 1; try { const v = +localStorage.cubeAbyssDiff; if (v >= 0 && v < 4) DI = v; } catch {}
let DF = DIFFS[DI], ALIVE = DF.alive;
// local ranking: { easy: [{ s, w, t }], ... }, best first, 10 each
let RANK = {}; try { RANK = JSON.parse(localStorage.cubeAbyssRank || '{}') || {}; } catch { RANK = {}; }
const rankOf = (d) => (Array.isArray(RANK[d.id]) ? RANK[d.id] : (RANK[d.id] = []));
// adds a run and returns its place (1-based) or 0 when it did not make the top 10
function rankAdd(d, s, w) {
  const L = rankOf(d), e = { s, w, t: Date.now() };
  L.push(e); L.sort((a, b) => b.s - a.s || b.w - a.w || a.t - b.t); L.length = min(L.length, 10);
  keep('cubeAbyssRank', JSON.stringify(RANK)); return L.indexOf(e) + 1;
}
// upgradable stats (reset per run) and the upgrade list: id, name, description, max stacks, apply
let MAXHP = 100, MAG = 24, FIRE = 1 / 9, RELOAD = 1.4, DMG = 1, PIERCE = 0, MULTI = 0, BOOM = 0, LEECH = 0, CWIN = 2;
const UPS = [
  ['rate', '高速連射', '連射速度 +25%', 4, () => { FIRE /= 1.25; }],
  ['dmg', '強装弾', '1発のダメージ +1', 3, () => { DMG++; }],
  ['pierce', '貫通銛', '弾が敵を +1体 貫通', 3, () => { PIERCE++; }],
  ['multi', '拡散射撃', '同時に撃つ弾 +2（広がる）', 2, () => { MULTI++; }],
  ['boom', '連鎖爆破', '撃破時に周囲へ爆発ダメージ（重ねると範囲・威力アップ）', 3, () => { BOOM++; }],
  ['leech', '吸収', '撃破するたびにHP +3', 3, () => { LEECH++; }],
  ['mag', '大型弾倉', '装弾数 +12', 3, () => { MAG += 12; ammo = MAG; }],
  ['reload', '早業', 'リロード時間 -35%', 2, () => { RELOAD *= 0.65; }],
  ['hp', '装甲強化', '最大HP +30、全回復', 3, () => { MAXHP += 30; hp = MAXHP; }],
  ['combo', '集中', 'コンボ猶予 +1秒', 2, () => { CWIN += 1; }],
];
const owned = {}; let choosing = false, choices = [];
let combo = 0, comboT = 0, mult = 1;
const R_ = (a, b) => a + (b - a) * Math.random();
const pool = (n, f) => Array.from({ length: n }, f);
const foes = pool(24, () => ({ on: 0, k: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, hp: 0, fl: 0, ph: 0, wf: 0, side: 1, cd: 0, ax: 0, ay: 1, az: 0, sp: 0, an: 0, q0: 0, q1: 0, q2: 0, q3: 1, los: 0, lt: 0 }));
const bolts = pool(48, () => ({ on: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, an: 0 }));
const debris = pool(220, () => ({ on: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, l0: 1, s: 0, r: 0, g: 0, b: 0, an: 0, sp: 0, ax: 0, ay: 1, az: 0 }));
const tracers = pool(24, () => ({ on: 0, x: 0, y: 0, z: 0, l: 0, q0: 0, q1: 0, q2: 0, q3: 1, life: 0 }));
let hp = MAXHP, score = 0, wave = 0, toSpawn = 0, spawnT = 0, restT = -1, ammo = MAG, reloadT = 0, fireT = 0, firing = 0;
let calm = 0, over = false, gtime = 0, spMul = 1, hurtFx = 0, hitFx = 0;
const V3 = new Float64Array(3);

// distance to the rock (m, > 0 inside, clamped to ±1) at any point; outside the collision grid counts as water
function rockAt(px, py, pz) {
  const x = (px - OX) / VS - CO, y = (py - OY) / VS, z = (pz - OZ) / VS - CO;
  if (!(x >= 0 && z >= 0 && y >= 0 && x < CN * 4 - 1 && z < CN * 4 - 1 && y < NY - 1)) return -1;
  const ix = x | 0, iy = y | 0, iz = z | 0, u = x - ix, v = y - iy, a = cv(ix, iy, iz), b = cv(ix, iy + 1, iz), c = cv(ix, iy, iz + 1), d = cv(ix, iy + 1, iz + 1);
  const p = a + (cv(ix + 1, iy, iz) - a) * u, q = b + (cv(ix + 1, iy + 1, iz) - b) * u, r = c + (cv(ix + 1, iy, iz + 1) - c) * u, s = d + (cv(ix + 1, iy + 1, iz + 1) - d) * u;
  const e = p + (q - p) * v; return (e + (r + (s - r) * v - e) * (z - iz)) / 127;
}
// unit gradient of rockAt (points into the rock) into V3; false where it is flat
function rockGrad(x, y, z) {
  let gx = rockAt(x + 0.4, y, z) - rockAt(x - 0.4, y, z), gy = rockAt(x, y + 0.4, z) - rockAt(x, y - 0.4, z), gz = rockAt(x, y, z + 0.4) - rockAt(x, y, z - 0.4);
  const l = sqrt(gx * gx + gy * gy + gz * gz); if (l < 0.02) return false;
  V3[0] = gx / l; V3[1] = gy / l; V3[2] = gz / l; return true;
}
// first rock hit along a ray (distance), or -1
function rayRock(ox, oy, oz, dx, dy, dz, tmax) {
  for (let t = 0.3; t < tmax;) { const d = rockAt(ox + dx * t, oy + dy * t, oz + dz * t); if (d > 0) return t; t += d < -0.3 ? -d * 0.8 : 0.24; }
  return -1;
}
// ray against a rotated box (centre c, half size s, quaternion q): entry distance or -1
function rayBox(ox, oy, oz, dx, dy, dz, cx, cy, cz, s, qx, qy, qz, qw, tmax) {
  // rotate into the box frame with the conjugate quaternion: v + 2 w' x (w' x v + w v), w' = -q.xyz
  const rot = (vx, vy, vz) => {
    const ax = -qx, ay = -qy, az = -qz, tx = ay * vz - az * vy + qw * vx, ty = az * vx - ax * vz + qw * vy, tz = ax * vy - ay * vx + qw * vz;
    V3[0] = vx + 2 * (ay * tz - az * ty); V3[1] = vy + 2 * (az * tx - ax * tz); V3[2] = vz + 2 * (ax * ty - ay * tx);
  };
  rot(ox - cx, oy - cy, oz - cz); const lx = V3[0], ly = V3[1], lz = V3[2];
  rot(dx, dy, dz); const ex = V3[0], ey = V3[1], ez = V3[2];
  let t0 = 0, t1 = tmax;
  for (let i = 0; i < 3; i++) {
    const o = i === 0 ? lx : i === 1 ? ly : lz, d = i === 0 ? ex : i === 1 ? ey : ez;
    if (abs(d) < 1e-9) { if (abs(o) > s) return -1; continue; }
    let a = (-s - o) / d, b = (s - o) / d; if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return -1;
  }
  return t0;
}
const camDir = () => { const cp = cos(F[PIT]); V3[0] = cp * sin(F[YAW]); V3[1] = sin(F[PIT]); V3[2] = -cp * cos(F[YAW]); };

// ---------------------------------------------------------------- pathing: flow field over open water
// 3 m cells over x, z in [-150, 150] and y in [-52, -1]. OPEN marks cells with ~1.7 m of water around the centre.
// DA holds the finished steps-to-you per cell (0xffff = unreachable); DB is filled breadth first, NAV_BUDGET cells a
// frame, then the two swap and the next fill starts from where you are now.
const GS = 3, GX = 100, GY = 17, GZ = 100, GN = GX * GY * GZ, G0X = -150, G0Y = -52, G0Z = -150, NAV_BUDGET = 40000, FAR = 0xffff;
const OPEN = new Uint8Array(GN), GQ = new Int32Array(GN);
let DA = new Uint16Array(GN).fill(FAR), DB = new Uint16Array(GN), navReady = false, qh = 0, qt = 0, navBusy = false;
const cellOf = (x, y, z) => {
  const i = floor((x - G0X) / GS), j = floor((y - G0Y) / GS), k = floor((z - G0Z) / GS);
  return i < 0 || j < 0 || k < 0 || i >= GX || j >= GY || k >= GZ ? -1 : i + GX * (j + GY * k);
};
const NBR = []; // the 26 neighbour offsets
for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) NBR.push([dx, dy, dz]);
function navOpen() {
  if (navReady) return;
  const S = 1.2, P = [0, 0, 0, S, 0, 0, -S, 0, 0, 0, S, 0, 0, -S, 0, 0, 0, S, 0, 0, -S];
  for (let k = 0; k < GZ; k++) for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
    const x = G0X + (i + 0.5) * GS, y = G0Y + (j + 0.5) * GS, z = G0Z + (k + 0.5) * GS;
    let ok = hypot(x, z) < 147 && y > -51 && y < -2;
    for (let p = 0; ok && p < 21; p += 3) if (rockAt(x + P[p], y + P[p + 1], z + P[p + 2]) > -0.5) ok = false;
    OPEN[i + GX * (j + GY * k)] = ok;
  }
  navReady = true;
}
function navBegin() {
  DB.fill(FAR); qh = qt = 0;
  const c = cellOf(F[CX], F[CY], F[CZ]); if (c < 0) { navBusy = false; return; }
  DB[c] = 0; GQ[qt++] = c; navBusy = true;
}
// breadth first over the 6 face neighbours; returns true when the fill is done (and swapped in)
function navStep(budget) {
  while (qh < qt && budget-- > 0) {
    const c = GQ[qh++], d = DB[c] + 1, i = c % GX, j = (c / GX | 0) % GY, k = c / (GX * GY) | 0;
    if (i > 0 && OPEN[c - 1] && DB[c - 1] === FAR) { DB[c - 1] = d; GQ[qt++] = c - 1; }
    if (i < GX - 1 && OPEN[c + 1] && DB[c + 1] === FAR) { DB[c + 1] = d; GQ[qt++] = c + 1; }
    if (j > 0 && OPEN[c - GX] && DB[c - GX] === FAR) { DB[c - GX] = d; GQ[qt++] = c - GX; }
    if (j < GY - 1 && OPEN[c + GX] && DB[c + GX] === FAR) { DB[c + GX] = d; GQ[qt++] = c + GX; }
    if (k > 0 && OPEN[c - GX * GY] && DB[c - GX * GY] === FAR) { DB[c - GX * GY] = d; GQ[qt++] = c - GX * GY; }
    if (k < GZ - 1 && OPEN[c + GX * GY] && DB[c + GX * GY] === FAR) { DB[c + GX * GY] = d; GQ[qt++] = c + GX * GY; }
  }
  if (qh < qt) return false;
  const t = DA; DA = DB; DB = t; navBusy = false; return true;
}
function navFull() { navOpen(); navBegin(); if (navBusy) navStep(GN); }
// direction (into V3) towards the open neighbour cell closest to you; false when already there or lost
function flowDir(x, y, z) {
  const c = cellOf(x, y, z); if (c < 0) return false;
  const i = c % GX, j = (c / GX | 0) % GY, k = c / (GX * GY) | 0;
  let best = DA[c], bn = -1, bl = 9;
  for (const [dx, dy, dz] of NBR) {
    const a = i + dx, b = j + dy, e = k + dz;
    if (a < 0 || b < 0 || e < 0 || a >= GX || b >= GY || e >= GZ) continue;
    const n = a + GX * (b + GY * e); if (!OPEN[n] || DA[n] === FAR) continue;
    // a diagonal step must not cut a rock corner: every axis step it is made of has to be open too
    if ((dx && !OPEN[c + dx]) || (dy && !OPEN[c + dy * GX]) || (dz && !OPEN[c + dz * GX * GY])) continue;
    const l = dx * dx + dy * dy + dz * dz;
    if (DA[n] < best || (DA[n] === best && bn >= 0 && l < bl)) { best = DA[n]; bn = n; bl = l; }
  }
  if (bn < 0) return false;
  const tx = G0X + (bn % GX + 0.5) * GS - x, ty = G0Y + ((bn / GX | 0) % GY + 0.5) * GS - y, tz = G0Z + ((bn / (GX * GY) | 0) + 0.5) * GS - z;
  const l = hypot(tx, ty, tz) || 1; V3[0] = tx / l; V3[1] = ty / l; V3[2] = tz / l; return true;
}

// ---------------------------------------------------------------- sound effects (Web Audio, through the master gain)
let NZB = null;
function sfx(kind) {
  if (!AC || !OUT || AC.state !== 'running') return;
  const t = AC.currentTime + 0.01;
  const env = (g, v, a, d) => { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.setTargetAtTime(0, t + a, d / 4); };
  const tone = (type, f0, f1, d, v, dl = 0) => {
    const o = new OscillatorNode(AC, { type, frequency: f0 }), g = new GainNode(AC, { gain: 0 });
    o.frequency.setValueAtTime(f0, t + dl); o.frequency.exponentialRampToValueAtTime(f1, t + dl + d);
    o.connect(g).connect(OUT); g.gain.setValueAtTime(0, t + dl); g.gain.linearRampToValueAtTime(v, t + dl + 0.004); g.gain.setTargetAtTime(0, t + dl + 0.004, d / 4);
    o.start(t + dl); o.stop(t + dl + d * 1.6 + 0.05);
  };
  const noise = (f0, f1, d, v) => {
    if (!NZB) { NZB = new AudioBuffer({ length: AC.sampleRate, numberOfChannels: 1, sampleRate: AC.sampleRate }); const a = NZB.getChannelData(0); for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1; }
    const s = new AudioBufferSourceNode(AC, { buffer: NZB }), f = new BiquadFilterNode(AC, { type: 'lowpass', frequency: f0, Q: 0.7 }), g = new GainNode(AC, { gain: 0 });
    f.frequency.exponentialRampToValueAtTime(f1, t + d); s.connect(f).connect(g).connect(OUT); env(g, v, 0.004, d); s.start(t); s.stop(t + d * 1.6 + 0.05);
  };
  switch (kind) {
    case 'shot': tone('square', 760, 170, 0.07, 0.045); noise(3500, 400, 0.07, 0.12); break;
    case 'hit': tone('sine', 1500, 1150, 0.05, 0.07); break;
    case 'kill': tone('sine', 900, 1900, 0.12, 0.08); noise(1200, 80, 0.7, 0.4); tone('sine', 95, 38, 0.5, 0.3); break;
    case 'bolt': tone('sine', 1200, 600, 0.08, 0.06); break;
    case 'spit': tone('triangle', 260, 720, 0.22, 0.07); break;
    case 'hurt': tone('sawtooth', 170, 55, 0.3, 0.12); noise(700, 90, 0.3, 0.25); break;
    case 'reload': tone('square', 2200, 1800, 0.02, 0.03); tone('square', 1600, 1400, 0.03, 0.03, 0.25); tone('square', 2400, 2000, 0.03, 0.04, RELOAD - 0.1); break;
    case 'wave': tone('sine', 587.3, 587.3, 0.6, 0.07); tone('sine', 880, 880, 0.9, 0.06, 0.18); break;
    case 'over': tone('sine', 440, 110, 1.6, 0.1); break;
  }
}

// ---------------------------------------------------------------- HUD (DOM; text only changes when a value does)
const hud2 = {
  stat: $('us'), hpBar: $('uhb'), hpTxt: $('uht'), ammo: $('ua'), banner: $('un'), hit: $('uk'), dmg: $('ud'), over: $('uo'), overTxt: $('uos'),
  radar: $('ur').getContext('2d'), cx: $('ux'), cxn: $('uxn'), cxm: $('uxm'), cxb: $('uxb'), pop: [...document.querySelectorAll('.uf')],
  up: $('up'), upc: $('upc'), upk: $('upk'), hint: $('ug'), overR: $('uor'), overK: $('uok'), rank: $('uol'),
};
let shown = '', shownHp = -1, shownAmmo = '', shownCombo = -1, popI = 0;
const popup = (txt, big) => {
  const e = hud2.pop[popI++ % hud2.pop.length]; e.textContent = txt; e.style.fontSize = big ? '1.8em' : '';
  e.style.marginLeft = `${1.4 + Math.random() * 1.5}em`; e.classList.remove('on'); void e.offsetWidth; e.classList.add('on');
};
const banner = (txt) => { const b = hud2.banner; b.textContent = txt; b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); };
function hudUpdate() {
  let alive = 0; for (const f of foes) alive += f.on;
  const st = `${DF.name}   ·   WAVE ${wave}   ·   SCORE ${score}   ·   ENEMIES ${alive + toSpawn}`;
  if (st !== shown) { shown = st; hud2.stat.textContent = st; }
  const h = Math.ceil(hp);
  if (h !== shownHp) { shownHp = h; hud2.hpTxt.textContent = `${h} / ${MAXHP}`; hud2.hpBar.style.transform = `scaleX(${h / MAXHP})`; hud2.hpBar.className = h < MAXHP * 0.3 ? 'lo' : ''; }
  if (combo !== shownCombo) {
    const up = combo > shownCombo; shownCombo = combo;
    hud2.cx.classList.toggle('on', combo > 1);
    if (combo > 1) { hud2.cxn.textContent = `${combo} COMBO`; hud2.cxm.textContent = `x${mult.toFixed(1)}`; hud2.cxm.style.color = mult >= 4 ? '#ff3ccf' : mult >= 2.5 ? '#ff5e3c' : '#ffb59e'; }
    if (up) { hud2.cx.classList.remove('pop'); void hud2.cx.offsetWidth; hud2.cx.classList.add('pop'); }
  }
  hud2.cxb.style.transform = `scaleX(${max(0, comboT / CWIN)})`;
  const am = reloadT > 0 ? 'RELOADING…' : `${ammo} / ${MAG}`;
  if (am !== shownAmmo) { shownAmmo = am; hud2.ammo.textContent = am; }
  hud2.hit.style.opacity = hitFx; hud2.dmg.style.opacity = hurtFx;
  // radar: 70 m around you, forward is up
  const c = hud2.radar, R2 = 74, sc = R2 / 70, sy = sin(F[YAW]), cy = cos(F[YAW]);
  c.clearRect(0, 0, 160, 160);
  c.fillStyle = '#03131ca6'; c.beginPath(); c.arc(80, 80, R2, 0, TAU); c.fill();
  c.strokeStyle = '#7ff3ff55'; c.lineWidth = 1.5; c.beginPath(); c.arc(80, 80, R2, 0, TAU); c.moveTo(80, 80 - R2); c.lineTo(80, 80 + R2); c.moveTo(80 - R2, 80); c.lineTo(80 + R2, 80); c.stroke();
  const dot = (x, y, z, r, col) => {
    const dx = x - F[CX], dz = z - F[CZ]; let px = (dx * cy + dz * sy) * sc, pz = -(dx * sy - dz * cy) * sc;
    const l = sqrt(px * px + pz * pz); if (l > R2 - 3) { px *= (R2 - 3) / l; pz *= (R2 - 3) / l; }
    c.fillStyle = col; c.globalAlpha = abs(y - F[CY]) > 8 ? 0.45 : 1; c.beginPath(); c.arc(80 + px, 80 + pz, r, 0, TAU); c.fill();
  };
  for (const f of foes) if (f.on) dot(f.x, f.y, f.z, f.k === 2 ? 5 : 3.5, f.k === 0 ? '#ff5a3c' : f.k === 1 ? '#ffd21a' : f.k === 2 ? '#b862ff' : '#30ff95');
  for (const b of bolts) if (b.on) dot(b.x, b.y, b.z, 2, '#ff9a30');
  c.globalAlpha = 1; c.fillStyle = '#e8fbff'; c.beginPath(); c.moveTo(80, 73); c.lineTo(85, 85); c.lineTo(75, 85); c.fill();
}

// ---------------------------------------------------------------- game flow
function clearAll() { for (const a of [foes, bolts, debris, tracers]) for (const o of a) o.on = 0; nCube = 0; }
function gameStart() {
  clearAll();
  MAXHP = 100; MAG = 24; FIRE = 1 / 9; RELOAD = 1.4; DMG = 1; PIERCE = 0; MULTI = 0; BOOM = 0; LEECH = 0; CWIN = 2;
  for (const k in owned) delete owned[k];
  hp = MAXHP; score = 0; wave = 0; ammo = MAG; reloadT = fireT = 0; firing = 0; calm = 0; over = false; hurtFx = hitFx = 0; restT = -1;
  combo = 0; comboT = 0; mult = 1; choosing = false; hud2.up.classList.remove('on');
  hud2.over.classList.remove('on');
  hud2.hint.innerHTML = mob ? '左側で移動（端まで倒すと加速）・右側で視点・照準を敵に重ねると自動射撃' : '<b>左クリック</b> 射撃　<b>R</b> リロード　<b>Space</b>/<b>Ctrl</b> 上下　<b>Shift</b> 加速';
  hud2.hint.classList.add('on'); setTimeout(() => hud2.hint.classList.remove('on'), 7000);
  lookAt(...POSES[0]); F[VX] = F[VY] = F[VZ] = 0;
  navFull();
  nextWave();
}
function gameEnd() { clearAll(); over = false; choosing = false; hud2.over.classList.remove('on'); hud2.up.classList.remove('on'); hud2.cx.classList.remove('on'); shownCombo = -1; combo = 0; }
// combo bookkeeping: hit() on every hit, the window runs down in gameStep
function hit() { combo++; comboT = CWIN; mult = min(1 + 0.5 * Math.floor(combo / 5), 8); }
// upgrade draft: 3 distinct upgrades that are not maxed out
function offer() {
  const pool2 = UPS.filter((u) => (owned[u[0]] || 0) < u[3]);
  choices = [];
  while (choices.length < 3 && pool2.length) choices.push(pool2.splice(Math.random() * pool2.length | 0, 1)[0]);
  if (!choices.length) { restT = 2; return; }
  choosing = true; firing = 0;
  hud2.upc.replaceChildren(...choices.map((u, i) => {
    const b = document.createElement('button'); b.type = 'button';
    b.innerHTML = `<b>${i + 1}</b><strong>${u[1]}</strong><span>${u[2]}</span><i>${'■'.repeat(owned[u[0]] || 0)}${'□'.repeat(u[3] - (owned[u[0]] || 0))}</i>`;
    b.addEventListener('click', () => pick(i)); return b;
  }));
  hud2.upk.textContent = mob ? 'タップで選択' : 'キー 1 / 2 / 3 で選択';
  hud2.up.classList.add('on');
}
function pick(i) {
  if (!choosing || !choices[i]) return;
  const u = choices[i]; owned[u[0]] = (owned[u[0]] || 0) + 1; u[4]();
  choosing = false; hud2.up.classList.remove('on'); restT = 1.5; shownHp = -1; sfx('wave'); banner(u[1]);
}
function nextWave() {
  wave++; restT = -1; toSpawn = Math.round((3 + 2 * wave) * DF.cnt); spawnT = 2; spMul = min(1 + 0.05 * (wave - 1), 1.5) * DF.sp;
  banner(`WAVE ${wave}`); sfx('wave');
}
function pickType() {
  const r = Math.random();
  if (wave >= 4 && r < 0.18) return 3;
  if (wave >= 3 && r < 0.3) return 2;
  if (wave >= 2 && r < 0.55) return 1;
  return 0;
}
// spawns in open water you can be reached from (no enemies sealed inside rock pockets)
function spawn() {
  const f = foes.find((o) => !o.on); if (!f) return false;
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * TAU, d = R_(40, 70), x = F[CX] + cos(a) * d, z = F[CZ] + sin(a) * d, y = clamp(F[CY] + R_(-4, 8), -48, -4);
    if (hypot(x, z) > 140 || rockAt(x, y, z) > -0.99) continue;
    const c = cellOf(x, y, z); if (c < 0 || !OPEN[c] || DA[c] === FAR) continue;
    const k = pickType(), t = FT[k];
    f.on = 1; f.k = k; f.x = x; f.y = y; f.z = z; f.vx = f.vy = f.vz = 0; f.hp = Math.round(t.hp * DF.hp); f.fl = 0; f.los = 0; f.lt = Math.random() * 0.2;
    f.ph = Math.random() * TAU; f.wf = R_(0.6, 1.4); f.side = Math.random() < 0.5 ? -1 : 1; f.cd = R_(2, 4);
    const ax = R_(-1, 1), ay = R_(-1, 1), az = R_(-1, 1), l = hypot(ax, ay, az) || 1;
    f.ax = ax / l; f.ay = ay / l; f.az = az / l; f.sp = R_(0.6, 2) * (k === 1 ? 2.5 : 1); f.an = Math.random() * TAU;
    return true;
  }
  return false;
}
function hurt(d) {
  if (over) return;
  hp -= d * DF.dmg; calm = 0; combo = 0; comboT = 0; mult = 1; hurtFx = min(1, hurtFx + 0.35 + d / 60); sfx('hurt');
  if (hp <= 0) {
    hp = 0; over = true; firing = 0;
    const place = rankAdd(DF, score, wave), L = rankOf(DF);
    hud2.overTxt.textContent = `難易度 ${DF.name}  ·  WAVE ${wave}  ·  SCORE ${score}` + (place === 1 ? '  ·  自己ベスト更新！' : place ? `  ·  ${place}位` : '');
    hud2.rank.replaceChildren(...L.slice(0, 5).map((e, i) => {
      const li = document.createElement('li'); li.textContent = `${i + 1}. ${e.s}　WAVE ${e.w}`; if (i === place - 1) li.className = 'me'; return li;
    }));
    menuRank();
    const got = UPS.filter((u) => owned[u[0]]).map((u) => `${u[1]}×${owned[u[0]]}`).join(' / ');
    hud2.overR.textContent = got ? `取った強化：${got}` : '強化なし';
    hud2.overK.innerHTML = mob ? '右上の ≡ でメニュー' : '<b>Enter</b> でもリトライ ・ <b>Esc</b> でメニュー';
    hud2.over.classList.add('on'); sfx('over');
  }
}
function burst(x, y, z, n, size, spd, r, g, b) {
  for (let i = 0; i < n; i++) {
    const p = debris.find((o) => !o.on); if (!p) return;
    const ax = R_(-1, 1), ay = R_(-1, 1), az = R_(-1, 1), l = hypot(ax, ay, az) || 1, v = R_(0.4, 1) * spd;
    p.on = 1; p.x = x + ax / l * size * 0.5; p.y = y + ay / l * size * 0.5; p.z = z + az / l * size * 0.5;
    p.vx = ax / l * v; p.vy = ay / l * v; p.vz = az / l * v; p.l0 = p.life = R_(0.6, 1.2); p.s = R_(0.08, 0.2) * (0.6 + size * 0.5);
    p.r = r; p.g = g; p.b = b; p.ax = ax / l; p.ay = ay / l; p.az = az / l; p.sp = R_(4, 12); p.an = 0;
  }
}
function kill(f, scored) {
  const t = FT[f.k]; f.on = 0;
  burst(f.x, f.y, f.z, 10 + (t.s * 8 | 0), t.s, 7 + t.s * 3, t.r, t.g, t.b); sfx('kill');
  if (!scored) return;
  const pts = Math.round(t.pts * mult * DF.sc); score += pts; popup(`+${pts}`, mult >= 2.5);
  if (LEECH) hp = min(MAXHP, hp + 3 * LEECH);
  if (BOOM) { // chain explosion: damages everything near, kills can chain further
    const R = 3 + 1.5 * BOOM; burst(f.x, f.y, f.z, 14, R * 0.6, R * 2.2, 1, 0.6, 0.15);
    for (const o of foes) if (o.on && hypot(o.x - f.x, o.y - f.y, o.z - f.z) < R + FT[o.k].s) { o.hp -= 1 + BOOM; o.fl = 1; hit(); if (o.hp <= 0) kill(o, true); }
  }
}
// fires one trigger pull: 1 + 2 x MULTI harpoons in a fan; each passes through PIERCE enemies, rock stops it
const HITS = [];
function shoot() {
  ammo--; fireT = FIRE; sfx('shot'); mdy -= 2.2; // a little recoil
  camDir(); const cx0 = V3[0], cy0 = V3[1], cz0 = V3[2], ox = F[CX], oy = F[CY], oz = F[CZ];
  const rx = cos(F[YAW]), rz = sin(F[YAW]), ux = -rz * cy0, uy = rz * cx0 - rx * cz0, uz = rx * cy0; // right and up of the view
  const n = 1 + 2 * MULTI;
  for (let k = 0; k < n; k++) {
    const a = (k - (n - 1) / 2) * 0.045, e = k ? (Math.random() - 0.5) * 0.03 : 0;
    let dx = cx0 + rx * a + ux * e, dy = cy0 + uy * e, dz = cz0 + rz * a + uz * e; const dl = hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
    const rk = rayRock(ox, oy, oz, dx, dy, dz, RANGE), bt = rk >= 0 ? rk : RANGE;
    HITS.length = 0;
    for (const f of foes) if (f.on) { const t = rayBox(ox, oy, oz, dx, dy, dz, f.x, f.y, f.z, FT[f.k].s * 1.15, f.q0, f.q1, f.q2, f.q3, bt); if (t >= 0) HITS.push(t, f); }
    for (const b of bolts) if (b.on) { const t = rayBox(ox, oy, oz, dx, dy, dz, b.x, b.y, b.z, 0.5, 0, 0, 0, 1, bt); if (t >= 0) HITS.push(t, b); }
    const order = []; for (let i = 0; i < HITS.length; i += 2) order.push(i); order.sort((p, q) => HITS[p] - HITS[q]);
    let left = 1 + PIERCE, end = bt;
    for (const i of order) {
      const t = HITS[i], o = HITS[i + 1]; if (!o.on) continue;
      if ('k' in o) { o.hp -= DMG; o.fl = 1; hit(); if (o.hp <= 0) kill(o, true); else sfx('hit'); }
      else { o.on = 0; score += Math.round(25 * mult * DF.sc); hit(); sfx('bolt'); burst(o.x, o.y, o.z, 5, 0.3, 4, 1, 0.55, 0.1); }
      hitFx = 1; end = t; if (--left <= 0) break;
    }
    if (left > 0) { end = bt; if (rk >= 0) burst(ox + dx * rk, oy + dy * rk, oz + dz * rk, 3, 0.2, 3, 0.5, 0.45, 0.4); }
    // tracer from just below-right of the eye to where the harpoon stopped
    const tr = tracers.find((o) => !o.on) || tracers[k % tracers.length];
    const sx = ox + rx * 0.28 - ux * 0.22 + cx0 * 0.6, sy = oy - uy * 0.22 + cy0 * 0.6, sz = oz + rz * 0.28 - uz * 0.22 + cz0 * 0.6;
    let ex = ox + dx * end - sx, ey = oy + dy * end - sy, ez = oz + dz * end - sz; const l = hypot(ex, ey, ez) || 1; ex /= l; ey /= l; ez /= l;
    let q0 = -ey, q1 = ex, q2 = 0, q3 = 1 + ez; const ql = hypot(q0, q1, q2, q3); if (ql < 1e-4) { q0 = 0; q1 = 1; q3 = 0; } else { q0 /= ql; q1 /= ql; q3 /= ql; }
    tr.on = 1; tr.life = 0.06; tr.l = l * 0.5; tr.x = sx + ex * l * 0.5; tr.y = sy + ey * l * 0.5; tr.z = sz + ez * l * 0.5; tr.q0 = q0; tr.q1 = q1; tr.q2 = q2; tr.q3 = q3;
  }
}
// touch screens have no trigger: the gun fires by itself while an enemy is under the crosshair
function onTarget() {
  camDir(); const dx = V3[0], dy = V3[1], dz = V3[2];
  for (const f of foes) if (f.on && rayBox(F[CX], F[CY], F[CZ], dx, dy, dz, f.x, f.y, f.z, FT[f.k].s * 1.3, f.q0, f.q1, f.q2, f.q3, 70) >= 0) return true;
  return false;
}

function gameStep(dt) {
  gtime += dt; hurtFx = max(0, hurtFx - dt * 1.5); hitFx = max(0, hitFx - dt * 6);
  for (const p of debris) if (p.on) {
    const k = exp(-dt * 2.2); p.vx *= k; p.vy = p.vy * k - 1.2 * dt; p.vz *= k;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.an += p.sp * dt; if ((p.life -= dt) <= 0) p.on = 0;
  }
  for (const t of tracers) if (t.on && (t.life -= dt) <= 0) t.on = 0;
  if (over || choosing) return;
  if (combo && (comboT -= dt) <= 0) { combo = 0; mult = 1; }
  // flow field: keep refilling from where you are
  if (!navBusy) navBegin(); else navStep(NAV_BUDGET);
  const cx = F[CX], cy = F[CY], cz = F[CZ];
  // waves
  let alive = 0; for (const f of foes) alive += f.on;
  if (restT === -2) { if ((spawnT -= dt) <= 0) offer(); }
  else if (restT >= 0) { if ((restT -= dt) < 0) nextWave(); }
  else if (toSpawn > 0) { if ((spawnT -= dt) <= 0 && alive < ALIVE) { if (spawn()) toSpawn--; spawnT = max(0.35, 1.5 - wave * 0.1); } }
  else if (!alive) { const b = Math.round(500 * wave * DF.sc); restT = -2; spawnT = 1.6; hp = min(MAXHP, hp + DF.heal); score += b; banner(`WAVE ${wave} CLEAR  +${b}`); }
  // you
  if ((calm += dt) > DF.rd) hp = min(MAXHP, hp + DF.rr * dt);
  fireT -= dt;
  if (reloadT > 0 && (reloadT -= dt) <= 0) ammo = MAG;
  if (!ammo && reloadT <= 0) { reloadT = RELOAD; sfx('reload'); }
  if ((firing || (mob && onTarget())) && fireT <= 0 && reloadT <= 0 && ammo > 0) shoot();
  // enemies
  for (const f of foes) if (f.on) {
    const t = FT[f.k], sp = t.sp * spMul;
    let dx = cx - f.x, dy = cy - f.y, dz = cz - f.z; const d = hypot(dx, dy, dz) || 1; dx /= d; dy /= d; dz /= d;
    // line of sight, refreshed 5 times a second (staggered by the random start)
    if ((f.lt -= dt) <= 0) { f.lt = 0.2; f.los = rayRock(f.x, f.y, f.z, dx, dy, dz, d) < 0 ? 1 : 0; }
    const hl = hypot(dx, dz) || 1, px = -dz / hl, pz = dx / hl; // horizontal sideways
    let tx, ty, tz;
    if (!f.los && flowDir(f.x, f.y, f.z)) { tx = V3[0]; ty = V3[1]; tz = V3[2]; } // around the rock
    else if (f.k === 3) { // spitter: hold 18-28 m and circle
      const w = d < 18 ? -1 : d > 28 ? 1 : 0;
      tx = dx * w + px * f.side * 0.8; ty = dy * w * 0.5 + 0.2 * sin(gtime + f.ph); tz = dz * w + pz * f.side * 0.8;
      if ((f.cd -= dt) <= 0 && d < 45 && f.los) {
        f.cd = R_(2.2, 3.4) * DF.cd;
        const b = bolts.find((o) => !o.on);
        if (b) {
          b.on = 1; b.x = f.x + dx * 1.2; b.y = f.y + dy * 1.2; b.z = f.z + dz * 1.2; b.vx = dx * BOLTSP; b.vy = dy * BOLTSP; b.vz = dz * BOLTSP; b.life = 6; b.an = 0;
          if (d < 60) sfx('spit');
        }
      }
    } else { // rammers weave towards you
      const w = sin(gtime * f.wf + f.ph) * (d > 8 ? 0.6 : 0.15);
      tx = dx + px * w; ty = dy + 0.25 * sin(gtime * 1.3 + f.ph); tz = dz + pz * w;
    }
    const tl = hypot(tx, ty, tz) || 1, kk = 1 - exp(-dt * 2.5);
    f.vx += (tx / tl * sp - f.vx) * kk; f.vy += (ty / tl * sp - f.vy) * kk; f.vz += (tz / tl * sp - f.vz) * kk;
    // steer away from rock ahead, push out of rock it is already in
    const ra = rockAt(f.x + f.vx * 0.5, f.y + f.vy * 0.5, f.z + f.vz * 0.5);
    if (ra > -0.9 && rockGrad(f.x + f.vx * 0.5, f.y + f.vy * 0.5, f.z + f.vz * 0.5)) {
      const vn = f.vx * V3[0] + f.vy * V3[1] + f.vz * V3[2];
      if (vn > 0) { f.vx -= V3[0] * vn * 1.4; f.vy -= V3[1] * vn * 1.4; f.vz -= V3[2] * vn * 1.4; }
    }
    f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
    const thr = -min(t.s * 0.6, 0.9), r0 = rockAt(f.x, f.y, f.z);
    if (r0 > thr && rockGrad(f.x, f.y, f.z)) { f.x -= V3[0] * (r0 - thr); f.y -= V3[1] * (r0 - thr); f.z -= V3[2] * (r0 - thr); }
    const rr2 = hypot(f.x, f.z); if (rr2 > 148) { f.x *= 148 / rr2; f.z *= 148 / rr2; }
    f.y = clamp(f.y, -51, -2);
    f.an += f.sp * dt; f.fl = max(0, f.fl - dt * 8);
    const h = sin(f.an / 2); f.q0 = f.ax * h; f.q1 = f.ay * h; f.q2 = f.az * h; f.q3 = cos(f.an / 2);
    if (f.k !== 3 && d < t.s + 0.8) { hurt(t.dmg); kill(f, false); }
    else if (f.k === 3 && d < t.s + 0.8) { hurt(t.dmg); f.vx = -dx * 12; f.vy = -dy * 12; f.vz = -dz * 12; }
  }
  // bolts
  for (const b of bolts) if (b.on) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.an += dt * 6;
    if (hypot(b.x - cx, b.y - cy, b.z - cz) < 0.9) { b.on = 0; hurt(BOLTDMG); burst(b.x, b.y, b.z, 5, 0.3, 4, 1, 0.55, 0.1); }
    else if ((b.life -= dt) <= 0 || rockAt(b.x, b.y, b.z) > 0) { b.on = 0; burst(b.x, b.y, b.z, 4, 0.3, 3, 1, 0.55, 0.1); }
  }
}

// writes every box into CUBE for render() and refreshes the HUD
function gameDraw() {
  let n = 0;
  const put = (x, y, z, sx, sy, sz, fl, q0, q1, q2, q3, r, g, b, gl) => {
    if (n >= CUBEMAX) return; const o = n++ * 16;
    CUBE[o] = x; CUBE[o + 1] = y; CUBE[o + 2] = z; CUBE[o + 3] = 0;
    CUBE[o + 4] = sx; CUBE[o + 5] = sy; CUBE[o + 6] = sz; CUBE[o + 7] = fl;
    CUBE[o + 8] = q0; CUBE[o + 9] = q1; CUBE[o + 10] = q2; CUBE[o + 11] = q3;
    CUBE[o + 12] = r; CUBE[o + 13] = g; CUBE[o + 14] = b; CUBE[o + 15] = gl;
  };
  for (const f of foes) if (f.on) { const t = FT[f.k]; put(f.x, f.y, f.z, t.s, t.s, t.s, f.fl, f.q0, f.q1, f.q2, f.q3, t.r, t.g, t.b, t.gl); }
  for (const b of bolts) if (b.on) { const h = sin(b.an / 2) * 0.577; put(b.x, b.y, b.z, 0.28, 0.28, 0.28, 0.5, h, h, h, cos(b.an / 2), 1, 0.5, 0.1, 5); }
  for (const p of debris) if (p.on) { const s = p.s * min(1, p.life / p.l0 * 1.5), h = sin(p.an / 2); put(p.x, p.y, p.z, s, s, s, 0, p.ax * h, p.ay * h, p.az * h, cos(p.an / 2), p.r, p.g, p.b, 4 * p.life / p.l0); }
  for (const t of tracers) if (t.on) put(t.x, t.y, t.z, 0.022, 0.022, t.l, 0.6, t.q0, t.q1, t.q2, t.q3, 0.5, 1, 1, 7);
  nCube = n;
  hudUpdate();
}

// ---------------------------------------------------------------- input
addEventListener('mousedown', (e) => { if (battle && !menu && !choosing && e.button === 0 && document.pointerLockElement === canvas) firing = 1; });
addEventListener('mouseup', (e) => { if (e.button === 0) firing = 0; });
addEventListener('blur', () => { firing = 0; });
document.addEventListener('pointerlockchange', () => { firing = 0; });
addEventListener('keydown', (e) => {
  if (!battle || menu || e.repeat) return;
  if (choosing) { if (e.code >= 'Digit1' && e.code <= 'Digit3') pick(e.code.charCodeAt(5) - 49); return; }
  if (e.code === 'KeyR') gameReload();
  else if (e.code === 'Enter' && over) gameStart();
});
function gameReload() { if (battle && !menu && !over && !choosing && ammo < MAG && reloadT <= 0) { reloadT = RELOAD; sfx('reload'); } }
// touch / click buttons: reload, retry
$('tr').addEventListener('pointerdown', (e) => { e.preventDefault(); gameReload(); });
$('uoa').addEventListener('click', () => { if (battle && over) gameStart(); });

// ---------------------------------------------------------------- difficulty buttons and the ranking in the menu
const diffBtns = [...$('dq').querySelectorAll('button')];
function menuRank() {
  const L = rankOf(DF);
  $('dr').textContent = L.length ? `${DF.name} のベスト：${L[0].s}（WAVE ${L[0].w}）` : `${DF.name} の記録はまだありません`;
}
function setDiff(i) {
  DI = i; DF = DIFFS[i]; ALIVE = DF.alive; keep('cubeAbyssDiff', i);
  diffBtns.forEach((b, j) => { b.className = j === i ? 'on' : ''; });
  // a run in progress was played on the old difficulty: end it, the next start uses the new one
  if (battle) { battle = false; gameEnd(); bDive.textContent = '探索に戻る'; bBattle.textContent = 'バトル開始'; }
  menuRank();
}
diffBtns.forEach((b, i) => b.addEventListener('click', () => setDiff(i)));
setDiff(DI);
