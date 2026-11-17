// ============================================================================
// battle mode: cube drones attack in waves; hitscan energy gun, HUD, radar, sound effects
// ============================================================================
// Rules
//   - Waves: wave n sends 3 + 2n enemies, at most 14 at once, spawned 40-70 m away where they can reach you. Clearing
//     a wave heals 25 HP and gives bonus score. Enemies get a little faster every wave (up to +50 %).
//   - Enemy types (unlocked by wave):
//       Drone   (red, w1+)    30 HP, rams you for 12
//       Dart    (yellow, w2+) 10 HP, fast, rams you for 8
//       Brute   (purple, w3+) 120 HP, big and slow, rams you for 28
//       Spitter (green, w4+)  40 HP, keeps 18-28 m away and spits orange bolts (10 damage, they can be shot down)
//   - Gun: 24 rounds, 9 shots/s, 10 damage per hit (the shotgun upgrade splits it into pellets), 120 m range, rock blocks shots. R reloads (1 s), empty reloads itself.
//   - You: 100 HP; after 5 s without damage you heal 4 HP/s. 0 HP ends the run; Enter starts again.
//   - Score: Drone 100, Dart 150, Brute 400, Spitter 250, bolt 25, wave clear 500 x wave, all kill/bolt points times
//     the combo multiplier. Best score is kept.
//   - Combo: every hit within the combo window (2 s, upgradable) adds 1; multiplier = 1 + 0.5 per 5 combo, max x8.
//     Taking damage or letting the window run out resets it.
//   - Roguelike (Vampire Survivors style): kills give XP (Drone 10, Dart 15, Brute 40, Spitter 25, times the XP combo
//     bonus 1 + 0.1 per 5 combo, max x2). A full XP bar pauses the game and offers 3 random upgrades (keys 1-3 or
//     tap); the next level needs 1.25x more (first 50). Several levels at once are offered one after another.
//   - Rare upgrades (gold cards): each level-up card is rare with 5 % chance; the level-ups to Lv 5 and Lv 10 always
//     show one. Treasure chests: scored kills may drop one (Brute 25 %, Spitter 10 %, others 3 %, at most 4 lying
//     around); touching it opens it with a show and grants 1 (70 %), 3 (25 %) or 5 (5 %) upgrades. A chest only
//     gives evolutions (first, when a recipe is met: a maxed upgrade + a partner, see UPS kind 'e') or another stack
//     of an upgrade you already own and have not maxed; with nothing left it gives score and a full heal.
//   - Bosses rotate every BOSSW-th wave: キューブリヴァイアサン, キューブクラーケン, 巨大キューブクラゲ, then again (HP grows
//     each time). Leviathan: キューブリヴァイアサン joins a few minions. It assembles (2.4 s, untouchable), circles you,
//     spits a fan of bolts, and every few seconds roars (eyes flare, the screen edge pulses red) and charges. Head
//     and tail fin are weak points (x2). Each body segment has its own HP; breaking one shortens the body and costs
//     the boss 4 % of its HP. Below 50 % it enrages (faster, wider fans, summons jellies). It drops a big chest
//     (3 upgrades, 25 % 5). Chests drop only from Lv 2 on; the first is guaranteed (last enemy of wave 1, or the
//     first kill after reaching Lv 2).
//     Kraken: hovers 17 m away; its cube mantle is armoured (35 % damage) while any of its 6 tentacles is left, the
//     big eye is the weak point (x2). Tentacles wind up (glow red, the screen edge pulses) and slam where you were;
//     each can be shot off. It sprays fans of ink bolts; enraged it slams more often and calls darts.
//     Giant jelly: drifts with pulses, its 4 brood sacs bud small jellies (shoot them off to stop it), the core under
//     the bell is the weak point (x2), the bell takes 60 %. It charges and releases rings of bolts; its tentacles
//     sting anyone under the bell. Enraged: faster budding, double rings.
//   - Codex (図鑑, menu): rares, evolutions and the boss you have found, kept in this browser (cubeAbyssDex).
//   - Difficulty (低 / 中 / 高 / 鬼 / 龍, chosen in the menu, kept): scales enemy count, speed, HP and damage, healing and
//     score; 中 is the base values above. See DIFFS.
//   - Ranking: top 10 runs per difficulty, kept in this browser (localStorage cubeAbyssRank).
// Pathing: enemies that can see you head straight for you; the others follow a flow field (breadth-first distances
// to you over a 3 m grid of open water, rebuilt a slice per frame), so they swim around rock instead of into it.
// Pools are preallocated; the frame loop only allocates strings when a HUD value changes and nodes for sound effects.

const FT = [ // hp, speed, half size, contact damage, colour, edge glow, points
  { hp: 30, sp: 6.5, s: 0.9, dmg: 12, r: 1, g: 0.22, b: 0.12, gl: 2.4, pts: 100, xp: 10 },
  { hp: 10, sp: 11, s: 0.5, dmg: 8, r: 1, g: 0.8, b: 0.1, gl: 2.8, pts: 150, xp: 15 },
  { hp: 120, sp: 3.6, s: 1.9, dmg: 28, r: 0.7, g: 0.25, b: 1, gl: 2, pts: 400, xp: 40 },
  { hp: 40, sp: 5, s: 1.0, dmg: 10, r: 0.15, g: 1, b: 0.55, gl: 2.4, pts: 250, xp: 25 },
];
const SPBASE = 0.85; // every enemy's base speed is scaled by this (difficulty multiplies on top)
// level-ups: XP needed for the first level, growth per level, XP combo bonus per 5 combo and its cap
const XP0 = 40, XPGROW = 1.25, XPCOMBO = 0.1, XPCMAX = 2;
const RANGE = 120, BOLTDMG = 10, BOLTSP = 14;
// difficulty: name, enemy count, speed, HP, damage, alive at once, spitter fire interval, regen delay (s, Infinity =
// none), regen per s, wave clear heal, score multiplier
const DIFFS = [
  { id: 'easy', name: '低', cnt: 0.7, sp: 0.75, hp: 1, dmg: 0.5, alive: 10, cd: 1.5, rd: 3, rr: 6, heal: 40, sc: 0.5 },
  { id: 'normal', name: '中', cnt: 1, sp: 1, hp: 1, dmg: 1, alive: 14, cd: 1, rd: 5, rr: 4, heal: 25, sc: 1 },
  { id: 'hard', name: '高', cnt: 1.3, sp: 1.2, hp: 1.3, dmg: 1.5, alive: 17, cd: 0.8, rd: 7, rr: 3, heal: 15, sc: 1.5 },
  { id: 'oni', name: '鬼', cnt: 2.6, sp: 1.6, hp: 1.6, dmg: 2, alive: 22, cd: 0.6, rd: Infinity, rr: 0, heal: 10, sc: 3.5 },
  // 龍: 鬼 with enemy HP x1.5, count x1.2, damage x1.2
  { id: 'ryu', name: '龍', cnt: 3.12, sp: 1.6, hp: 2.4, dmg: 2.4, alive: 22, cd: 0.6, rd: Infinity, rr: 0, heal: 10, sc: 5 },
];
let DI = 1; try { const v = +localStorage.cubeAbyssDiff; if (v >= 0 && v < DIFFS.length) DI = v; } catch {}
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
// upgradable stats (reset per run) and the upgrade list: id, name, description (text or function), max stacks, apply,
// kind (none = normal, 'r' = rare, 'e' = evolution: only from chests), recipe check and recipe text for evolutions
let MAXHP = 100, MAG = 24, FIRE = 1 / 9, RELOAD = 1, DMG = 10, PIERCE = 0, MULTI = 0, BOOM = 0, LEECH = 0, CWIN = 2;
let SPLIT = 0, FRENZY = 0, RICO = 0, HOMING = 0, UNDY = 0, SLOWUP = 0, CHAIN = 0, EVSHOT = 0, EVBOOM = 0, EVRATE = 0;
const RARE_P = 0.05, RARE_LV = [5, 10], CHEST_P = [0.03, 0.03, 0.25, 0.1], EVO_MAT = ['rate', 'combo', 'multi', 'dmg', 'boom', 'pierce'];
const UPS = [
  ['rate', '高速連射', '連射速度 +25%', 4, () => { FIRE /= 1.25; }],
  ['dmg', '強装弾', '1発のダメージ +10', 3, () => { DMG += 10; }],
  ['pierce', '貫通弾', '弾が敵を +1体 貫通', 3, () => { PIERCE++; }],
  ['multi', '散弾化', () => { const n = SHOT[(owned.multi || 0) + 1]; return `弾が ${n.n} 発に分かれて広がる。1発の威力 ${Math.round(n.mul * 100)}%、連射 ${Math.round(n.rate * 100)}%`; }, 3, () => { MULTI++; }],
  ['boom', '連鎖爆破', '撃破時に周囲へ爆発ダメージ（重ねると範囲・威力アップ）', 3, () => { BOOM++; }],
  ['leech', '吸収', '撃破するたびにHP +3', 3, () => { LEECH++; }],
  ['mag', '大型弾倉', '装弾数 +12', 3, () => { MAG += 12; ammo = MAG; }],
  ['reload', '早業', 'リロード時間 -35%', 2, () => { RELOAD *= 0.65; }],
  ['hp', '装甲強化', '最大HP +30、全回復', 3, () => { MAXHP += 30; hp = MAXHP; }],
  ['combo', '集中', 'コンボ猶予 +1秒', 2, () => { CWIN += 1; }],
  ['split', '分裂弾', () => (owned.split ? '発動率 70%、追加の弾 3発に' : '撃つたびに40%で、ランダムな方向へ追加の弾が2発（威力60%）'), 2, () => { SPLIT++; }, 'r'],
  ['frenzy', '狂乱', 'コンボ倍率 x4 以上の間、連射速度 2倍', 1, () => { FRENZY = 1; }, 'r'],
  ['rico', '跳弾', () => (owned.rico ? '跳ね返り +1回（合計2回）' : '岩に当たった弾が1回跳ね返る'), 2, () => { RICO++; }, 'r'],
  ['homing', '磁力弾', '照準の近くにいる敵へ弾が曲がる', 1, () => { HOMING = 1; }, 'r'],
  ['undying', '不屈', 'HPが0になったとき、1回だけ HP50 で耐える', 1, () => { UNDY = 1; }, 'r'],
  ['slow', '時間減速', '15体撃破するごとに、3秒間 敵の動きが遅くなる', 1, () => { SLOWUP = 1; }, 'r'],
  ['chain', '連鎖雷', '命中した敵から近くの敵へ電撃が最大3回飛ぶ（威力60%）', 1, () => { CHAIN = 1; }, 'r'],
  ['evoShot', '破砕砲', '散弾の威力 +50%、全弾がさらに1体貫通', 1, () => { EVSHOT = 1; }, 'e', () => owned.multi === 3 && owned.dmg >= 1, '散弾化 MAX ＋ 強装弾'],
  ['evoBoom', '誘爆連鎖', '爆発の範囲 +3m、爆発の威力 2倍', 1, () => { EVBOOM = 1; }, 'e', () => owned.boom === 3 && owned.pierce >= 1, '連鎖爆破 MAX ＋ 貫通弾'],
  ['evoRate', '無限機関', '連射速度 さらに +40%、コンボ猶予 +2秒', 1, () => { EVRATE = 1; CWIN += 2; }, 'e', () => owned.rate === 4 && owned.combo >= 1, '高速連射 MAX ＋ 集中'],
];
const udesc = (u) => (typeof u[2] === 'function' ? u[2]() : u[2]);
// shotgun steps (散弾化 stacks): pellets per shot, damage per pellet, cone half-angle (rad), fire-rate factor.
// Per trigger the total grows (x1, x2.2, x2.8, x3.2) but each pellet is weaker and the cone wider.
const SHOT = [
  { n: 1, mul: 1, cone: 0, rate: 1 },
  { n: 4, mul: 0.55, cone: 0.035, rate: 0.9 },
  { n: 7, mul: 0.4, cone: 0.055, rate: 0.8 },
  { n: 10, mul: 0.32, cone: 0.075, rate: 0.7 },
];
const owned = {}; let choosing = false, choices = [];
let chestOpen = false, chestDone = false, chestReady = 0, chestTimers = [], chestItems = [], chestNew = [], firstChest = 0;
let undyUsed = 0, killN = 0, slowT = 0, chainT = 0, frenzyOn = false;
function gameFrozen() { return choosing || chestOpen; } // main.js stops the camera while this is true
let combo = 0, comboT = 0, mult = 1;
let xp = 0, xpNeed = XP0, level = 1, pending = 0; // pending: level-ups still to be chosen
const R_ = (a, b) => a + (b - a) * Math.random();
const pool = (n, f) => Array.from({ length: n }, f);
// look: TRN trail points per enemy (tentacles / body segments); beyond LODD only a few boxes are drawn; SPAWNFX
// would assemble new enemies from scattered parts over ASM seconds (off: they just appear; the boss always assembles)
const TRN = 20, LODD = RANGE, SPAWNFX = false, ASM = 0.7;
const foes = pool(24, () => ({ on: 0, k: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, hp: 0, fl: 0, ph: 0, wf: 0, side: 1, cd: 0, ax: 0, ay: 1, az: 0, sp: 0, an: 0, q0: 0, q1: 0, q2: 0, q3: 1, los: 0, lt: 0, yw: 0, pt: 0, rl: 0, mh: 1, hs: 0, born: 1, pl: 8, tr: new Float32Array(TRN * 3) }));
const bolts = pool(48, () => ({ on: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, an: 0 }));
const debris = pool(480, () => ({ on: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, l0: 1, sx: 0, sy: 0, sz: 0, q0: 0, q1: 0, q2: 0, q3: 1, r: 0, g: 0, b: 0, gl: 4, an: 0, sp: 0, ax: 0, ay: 1, az: 0 }));
const tracers = pool(48, () => ({ on: 0, x: 0, y: 0, z: 0, l: 0, q0: 0, q1: 0, q2: 0, q3: 1, life: 0, cr: 0.5, cg: 1, cb: 1 }));
const chests = pool(4, () => ({ on: 0, x: 0, y: 0, z: 0, t: 0, big: 0 }));
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
function sfx(kind, p = 0) {
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
    case 'drop': tone('triangle', 880, 1760, 0.25, 0.06); tone('sine', 1320, 1320, 0.4, 0.05, 0.12); tone('sine', 1760, 1760, 0.5, 0.04, 0.24); break;
    case 'roll': for (let i = 0; i < 14; i++) tone('square', 150 + i * 14, 110 + i * 14, 0.05, 0.035, i * 0.095); break;
    case 'open': [523.3, 659.3, 784, 1046.5].forEach((f, i) => tone('triangle', f, f, 0.4, 0.08, i * 0.08)); tone('sine', 2093, 2093, 0.9, 0.05, 0.32); noise(5000, 300, 0.8, 0.25); break;
    case 'item': { const f = 660 * 2 ** (p / 4); tone('sine', f, f * 1.5, 0.12, 0.08); tone('triangle', f * 2, f * 2, 0.3, 0.04, 0.06); break; }
    case 'rare': for (let i = 0; i < 6; i++) tone('sine', 1568 * 2 ** (i / 6), 1568 * 2 ** (i / 6), 0.15, 0.05, i * 0.045); break;
    case 'evo': tone('sawtooth', 110, 880, 0.7, 0.05); [523.3, 659.3, 784, 987.8, 1318.5].forEach((f, i) => tone('triangle', f, f, 0.9, 0.06, 0.55 + i * 0.03)); break;
    case 'zap': tone('square', 2200, 280, 0.09, 0.035); noise(7000, 1500, 0.09, 0.08); break;
    case 'slow': tone('sine', 700, 120, 0.9, 0.09); break;
    case 'charge': tone('sine', 260, 1300, 1.1, 0.06); noise(400, 3000, 1.1, 0.12); break;
    case 'bud': tone('triangle', 420, 900, 0.16, 0.06); tone('sine', 700, 1400, 0.12, 0.04, 0.08); break;
    case 'siren': for (let i = 0; i < 3; i++) tone('sawtooth', 380, 760, 0.45, 0.05, i * 0.75); break;
    case 'roar': noise(500, 70, 1.1, 0.4); tone('sawtooth', 75, 42, 1.1, 0.13); tone('square', 110, 55, 0.9, 0.05, 0.05); break;
    case 'dash': noise(2600, 200, 0.7, 0.3); tone('sine', 220, 55, 0.6, 0.12); break;
    case 'crit': tone('square', 1900, 2600, 0.05, 0.04); break;
    case 'segbreak': noise(1800, 120, 0.5, 0.35); tone('sine', 160, 50, 0.4, 0.2); tone('triangle', 1200, 600, 0.15, 0.06); break;
    case 'bossdie': tone('sawtooth', 220, 28, 2.6, 0.13); noise(1600, 50, 2.6, 0.5); [392, 523.3, 659.3, 784, 1046.5].forEach((f, i) => tone('triangle', f, f, 1.2, 0.06, 1.6 + i * 0.1)); break;
    case 'undying': tone('sine', 220, 880, 0.5, 0.1); tone('triangle', 1318.5, 1318.5, 0.8, 0.05, 0.4); break;
  }
}

// ---------------------------------------------------------------- HUD (DOM; text only changes when a value does)
const hud2 = {
  stat: $('us'), hpBar: $('uhb'), hpTxt: $('uht'), ammo: $('ua'), banner: $('un'), hit: $('uk'), dmg: $('ud'), over: $('uo'), overTxt: $('uos'),
  radar: $('ur').getContext('2d'), cx: $('ux'), cxn: $('uxn'), cxm: $('uxm'), cxb: $('uxb'), pop: [...document.querySelectorAll('.uf')],
  root: $('u'), bb: $('ubb'), bn: $('ubn'), cb: $('cb'), cbi: $('cbi'), cbt: $('cbt'), cbk: $('cbk'),
  up: $('up'), upc: $('upc'), upk: $('upk'), upt: $('upt'), xpBar: $('uxpb'), xpTxt: $('uxpt'), hint: $('ug'), overR: $('uor'), overK: $('uok'), rank: $('uol'),
};
let shownBoss = -2, shownCharge = false, shownSlow = false, shownXp = -1, shown = '', shownHp = -1, shownAmmo = '', shownCombo = -1, popI = 0;
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
  const xr = Math.floor(xp / xpNeed * 200);
  if (xr !== shownXp) { shownXp = xr; hud2.xpBar.style.transform = `scaleX(${xr / 200})`; hud2.xpTxt.textContent = `Lv ${level - pending}`; }
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
  for (const c of chests) if (c.on) dot(c.x, c.y, c.z, 5, '#ffd84a');
  if (boss.on) { for (let i = 1; i < boss.nb; i += 2) if (BPS[i] > 0) dot(BPX[i], BPY[i], BPZ[i], 2.5, '#7c8cff'); dot(boss.x, boss.y, boss.z, 6.5, '#ff3c8c'); }
  const bh = boss.on ? Math.ceil(max(0, boss.hp) / boss.mh * 300) : -1;
  if (bh !== shownBoss) {
    shownBoss = bh; hud2.root.classList.toggle('boss', bh >= 0);
    if (bh >= 0) { hud2.bb.style.transform = `scaleX(${bh / 300})`; hud2.bb.className = boss.ph2 ? 'ph2' : ''; hud2.bn.textContent = BOSSN[boss.kind] + (boss.ph2 ? ' ― 激昂' : ''); }
  }
  const chg = !!(boss.on && (boss.st === 2 || boss.warn)); if (chg !== shownCharge) { shownCharge = chg; hud2.root.classList.toggle('charge', chg); }
  if ((slowT > 0) !== shownSlow) { shownSlow = slowT > 0; hud2.root.classList.toggle('slow', shownSlow); }
  c.globalAlpha = 1; c.fillStyle = '#e8fbff'; c.beginPath(); c.moveTo(80, 73); c.lineTo(85, 85); c.lineTo(75, 85); c.fill();
}

// ---------------------------------------------------------------- game flow
function clearAll() { for (const a of [foes, bolts, debris, tracers, chests]) for (const o of a) o.on = 0; nCube = 0; chestClose(); boss.on = 0; bossT = 0; }
function gameStart() {
  clearAll();
  MAXHP = 100; MAG = 24; FIRE = 1 / 9; RELOAD = 1; DMG = 10; PIERCE = 0; MULTI = 0; BOOM = 0; LEECH = 0; CWIN = 2;
  SPLIT = FRENZY = RICO = HOMING = UNDY = SLOWUP = CHAIN = EVSHOT = EVBOOM = EVRATE = 0;
  undyUsed = 0; killN = 0; slowT = 0; chainT = 0; frenzyOn = false; firstChest = 0; bossKills = 0; maxCombo = 0;
  for (const k in owned) delete owned[k];
  hp = MAXHP; score = 0; wave = 0; ammo = MAG; reloadT = fireT = 0; firing = 0; calm = 0; over = false; hurtFx = hitFx = 0; restT = -1;
  combo = 0; comboT = 0; mult = 1; choosing = false; hud2.up.classList.remove('on');
  xp = 0; xpNeed = XP0; level = 1; pending = 0; shownXp = -1;
  hud2.over.classList.remove('on');
  hud2.hint.innerHTML = mob ? '左側で移動（端まで倒すと加速）・右側で視点・照準を敵に重ねると自動射撃' : '<b>左クリック</b> 射撃　<b>R</b> リロード　<b>Space</b>/<b>Ctrl</b> 上下　<b>Shift</b> 加速';
  hud2.hint.classList.add('on'); setTimeout(() => hud2.hint.classList.remove('on'), 7000);
  lookAt(...POSES[0]); F[VX] = F[VY] = F[VZ] = 0;
  navFull();
  nextWave();
}
function gameEnd() { clearAll(); over = false; choosing = false; hud2.over.classList.remove('on'); hud2.up.classList.remove('on'); hud2.cx.classList.remove('on'); shownCombo = -1; combo = 0; }
// XP: the combo raises it a little; every full bar is one pending level-up (offered from gameStep)
function gainXp(base) {
  xp += base * min(1 + XPCOMBO * Math.floor(combo / 5), XPCMAX);
  while (xp >= xpNeed) { xp -= xpNeed; xpNeed = Math.round(xpNeed * XPGROW); level++; pending++; }
}
// combo bookkeeping: hit() on every hit, the window runs down in gameStep
function hit() { if (combo + 1 > maxCombo) maxCombo = combo + 1; combo++; comboT = CWIN; mult = min(1 + 0.5 * Math.floor(combo / 5), 8); }
// upgrade draft: 3 distinct upgrades that are not maxed out; each card may be a rare one (gold), and the level-ups to
// RARE_LV always include one
function card(u) { // the inner HTML of an upgrade card (level-up and chest)
  const n = owned[u[0]] || 0, mat = !u[5] && EVO_MAT.includes(u[0]);
  return `${u[5] === 'r' ? '<em>RARE</em>' : u[5] === 'e' ? '<em>EVOLUTION</em>' : ''}<strong>${u[1]}</strong><span>${udesc(u)}</span>` +
    (u[5] === 'e' ? `<small>${u[7]}</small>` : `<i>${'■'.repeat(n)}${'□'.repeat(u[3] - n)}</i>`) + (mat ? '<small>◆ 進化素材</small>' : '');
}
function offer() {
  const normal = UPS.filter((u) => !u[5] && (owned[u[0]] || 0) < u[3]), rare = UPS.filter((u) => u[5] === 'r' && (owned[u[0]] || 0) < u[3]);
  const nl = level - pending + 1, force = RARE_LV.includes(nl);
  choices = [];
  for (let i = 0; i < 3; i++) {
    const src = rare.length && ((force && i === 0) || Math.random() < RARE_P || !normal.length) ? rare : normal;
    if (!src.length) break;
    choices.push(src.splice(Math.random() * src.length | 0, 1)[0]);
  }
  if (!choices.length) { pending = 0; return; } // everything maxed out
  for (let i = choices.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0, t = choices[i]; choices[i] = choices[j]; choices[j] = t; }
  choosing = true; firing = 0;
  hud2.upc.replaceChildren(...choices.map((u, i) => {
    const b = document.createElement('button'); b.type = 'button'; if (u[5] === 'r') b.className = 'rare';
    b.innerHTML = `<b>${i + 1}</b>` + card(u);
    b.addEventListener('click', () => pick(i)); return b;
  }));
  hud2.upt.textContent = `LEVEL UP!  Lv ${level - pending} → ${level - pending + 1}`;
  hud2.upk.textContent = (mob ? 'タップで選択' : 'キー 1 / 2 / 3 で選択') + (pending > 1 ? `（あと ${pending - 1} 回）` : '');
  hud2.up.classList.add('on');
  if (choices.some((u) => u[5] === 'r')) sfx('rare');
}
function pick(i) {
  if (!choosing || !choices[i]) return;
  const u = choices[i], nw = !!u[5] && !DEX[u[0]]; owned[u[0]] = (owned[u[0]] || 0) + 1; u[4](); if (u[5]) dexAdd(u[0]);
  choosing = false; hud2.up.classList.remove('on'); shownHp = -1; shownAmmo = ''; shownXp = -1; sfx('wave'); banner(nw ? `NEW!  ${u[1]}` : u[1]);
  if (--pending > 0) offer();
}
// ---------------------------------------------------------------- treasure chests
function dropChest(x, y, z, big) {
  const c = chests.find((o) => !o.on) || (big ? chests[0] : null); if (!c) return;
  c.on = 1; c.x = x; c.y = y; c.z = z; c.t = 0; c.big = big ? 1 : 0; sfx('drop'); popup(big ? 'BIG TREASURE!' : 'TREASURE!', true);
}
// one upgrade for a chest: an evolution whose recipe is met comes first, then rare (25 %) or normal
function chestRoll() {
  const ev = UPS.find((u) => u[5] === 'e' && !owned[u[0]] && u[6]()); if (ev) return ev;
  // only upgrades you already picked (never a new one you did not choose), and only those not maxed out
  const mine = UPS.filter((u) => u[5] !== 'e' && owned[u[0]] && owned[u[0]] < u[3]);
  return mine.length ? mine[Math.random() * mine.length | 0] : null;
}
// opens a chest: the upgrades are granted at once, the overlay then reveals them one by one (any click / Enter skips)
function openChest(c) {
  c.on = 0; chestOpen = true; chestDone = false; firing = 0; chestReady = performance.now() + 450;
  const r = Math.random(), n = c.big ? (r < 0.25 ? 5 : 3) : r < 0.05 ? 5 : r < 0.3 ? 3 : 1;
  chestItems = []; chestNew = [];
  for (let i = 0; i < n; i++) {
    const u = chestRoll(); if (!u) break;
    owned[u[0]] = (owned[u[0]] || 0) + 1; u[4](); chestItems.push(u); chestNew.push(!!u[5] && !DEX[u[0]]); if (u[5]) dexAdd(u[0]);
  }
  const gold = chestItems.length ? 0 : Math.round(2000 * DF.sc); // nothing left to give
  if (gold) { score += gold; hp = MAXHP; }
  shownHp = -1; shownAmmo = '';
  const box = hud2.cb; box.className = ''; void box.offsetWidth; box.className = 'on n' + n;
  hud2.cbt.textContent = n >= 5 ? 'JACKPOT!!' : n >= 3 ? 'TREASURE ×3!' : 'TREASURE!';
  hud2.cbk.textContent = '';
  const cards = chestItems.map((u) => { const d = document.createElement('div'); d.className = 'ci' + (u[5] === 'e' ? ' evo' : u[5] === 'r' ? ' rare' : ''); return d; });
  if (gold) { const d = document.createElement('div'); d.className = 'ci on'; d.innerHTML = `<strong>ボーナス</strong><span>+${gold} 点・HP全回復</span>`; cards.push(d); }
  hud2.cbi.replaceChildren(...cards);
  chestTimers.forEach(clearTimeout); chestTimers = [];
  const T = (ms, f) => chestTimers.push(setTimeout(f, ms));
  sfx('roll'); T(1400, () => sfx('open'));
  const names = UPS.filter((u) => owned[u[0]]).map((u) => u[1]); if (!names.length) names.push('？？？'); // roulette shows only your own
  chestItems.forEach((u, i) => {
    const d = cards[i], t0 = 1900 + i * 700;
    for (let j = 0; j < 9; j++) T(t0 - 640 + j * 70, () => { d.className = d.className.replace(' on', '') + (d.classList.contains('spin') ? '' : ' spin'); d.innerHTML = `<strong>${names[(Math.random() * names.length) | 0]}</strong><span>…</span>`; if (j % 2) sfx('hit'); });
    T(t0, () => chestReveal(d, u, i));
  });
  T(1900 + chestItems.length * 700, chestFinish);
}
function chestReveal(d, u, i) {
  d.classList.remove('spin'); d.classList.add('on'); d.innerHTML = card(u) + (chestNew[i] ? '<b class=nw>NEW!</b>' : '');
  sfx(u[5] === 'e' ? 'evo' : u[5] === 'r' ? 'rare' : 'item', i);
  if (u[5] === 'e') banner(`進化！ ${u[1]}`);
}
function chestFinish() {
  chestTimers.forEach(clearTimeout); chestTimers = []; chestDone = true;
  hud2.cbk.textContent = mob ? 'タップで続ける' : 'クリック / Enter で続ける';
}
function chestAdvance() {
  if (!chestOpen || performance.now() < chestReady) return;
  if (!chestDone) { // skip: everything lands at once
    const cards = [...hud2.cbi.children]; chestItems.forEach((u, i) => { if (cards[i] && !cards[i].classList.contains('on')) chestReveal(cards[i], u, i); });
    hud2.cb.classList.add('skip'); chestFinish(); chestReady = performance.now() + 250; return;
  }
  chestClose();
}
function chestClose() {
  chestTimers.forEach(clearTimeout); chestTimers = []; chestOpen = false; chestDone = false; hud2.cb.className = ''; shownHp = -1; shownAmmo = '';
}
function nextWave() {
  wave++; restT = -1; toSpawn = Math.round((3 + 2 * wave) * DF.cnt); spawnT = 2; spMul = min(1 + 0.05 * (wave - 1), 1.5) * DF.sp;
  if (wave % BOSSW === 0) { // boss wave: a few minions, the boss after a warning
    toSpawn = Math.round(3 * DF.cnt); spawnT = 5; bossT = 2.6;
    banner('WARNING!!'); sfx('siren'); hud2.root.classList.add('warn'); setTimeout(() => hud2.root.classList.remove('warn'), 2600);
    return;
  }
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
    initFoe(f, pickType(), x, y, z);
    return true;
  }
  return false;
}
// a new enemy of type k at (x, y, z)
function initFoe(f, k, x, y, z) {
  {
    const t = FT[k];
    f.on = 1; f.k = k; f.x = x; f.y = y; f.z = z; f.vx = f.vy = f.vz = 0; f.hp = Math.round(t.hp * DF.hp); f.fl = 0; f.los = 0; f.lt = Math.random() * 0.2;
    f.ph = Math.random() * TAU; f.wf = R_(0.6, 1.4); f.side = Math.random() < 0.5 ? -1 : 1; f.cd = R_(2, 4);
    const ax = R_(-1, 1), ay = R_(-1, 1), az = R_(-1, 1), l = hypot(ax, ay, az) || 1;
    f.ax = ax / l; f.ay = ay / l; f.az = az / l; f.sp = R_(0.6, 2) * (k === 1 ? 2.5 : 1); f.an = Math.random() * TAU;
    f.mh = f.hp; f.yw = atan2(F[CX] - x, z - F[CZ]); f.pt = 0; f.rl = 0; f.born = SPAWNFX ? 0 : 1; f.pl = 8;
    for (let j = 0; j < TRN; j++) { f.tr[j * 3] = x; f.tr[j * 3 + 1] = y - j * 0.3; f.tr[j * 3 + 2] = z; }
  }
}
function hurt(d) {
  if (over) return;
  hp -= d * DF.dmg; calm = 0; combo = 0; comboT = 0; mult = 1; hurtFx = min(1, hurtFx + 0.35 + d / 60); sfx('hurt');
  if (hp <= 0 && UNDY && !undyUsed) { undyUsed = 1; hp = 50; hurtFx = 0; banner('不屈！  HP 50'); sfx('undying'); return; }
  if (hp <= 0) {
    hp = 0; over = true; firing = 0;
    const place = rankAdd(DF, score, wave), L = rankOf(DF);
    hud2.overTxt.textContent = `難易度 ${DF.name}  ·  WAVE ${wave}  ·  Lv ${level}  ·  SCORE ${score}` + (place === 1 ? '  ·  自己ベスト更新！' : place ? `  ·  ${place}位` : '');
    hud2.rank.replaceChildren(...L.slice(0, 5).map((e, i) => {
      const li = document.createElement('li'); li.textContent = `${i + 1}. ${e.s}　WAVE ${e.w}`; if (i === place - 1) li.className = 'me'; return li;
    }));
    menuRank();
    const got = UPS.filter((u) => owned[u[0]]).map((u) => `${u[1]}×${owned[u[0]]}`).join(' / ');
    hud2.overR.textContent = got ? `取った強化：${got}` : '強化なし';
    hud2.overK.innerHTML = mob ? '右上の ≡ でメニュー' : '<b>Enter</b> でもリトライ ・ <b>Esc</b> でメニュー';
    hud2.over.classList.add('on'); sfx('over');
    shareMake(place);
    if (document.pointerLockElement) { overRelease = true; document.exitPointerLock(); } // free the mouse for the buttons
  }
}
function burst(x, y, z, n, size, spd, r, g, b) {
  for (let i = 0; i < n; i++) {
    const p = debris.find((o) => !o.on); if (!p) return;
    const ax = R_(-1, 1), ay = R_(-1, 1), az = R_(-1, 1), l = hypot(ax, ay, az) || 1, v = R_(0.4, 1) * spd;
    p.on = 1; p.x = x + ax / l * size * 0.5; p.y = y + ay / l * size * 0.5; p.z = z + az / l * size * 0.5;
    p.vx = ax / l * v; p.vy = ay / l * v; p.vz = az / l * v; p.l0 = p.life = R_(0.6, 1.2); p.sx = p.sy = p.sz = R_(0.08, 0.2) * (0.6 + size * 0.5);
    p.q0 = p.q1 = p.q2 = 0; p.q3 = 1; p.gl = 4;
    p.r = r; p.g = g; p.b = b; p.ax = ax / l; p.ay = ay / l; p.az = az / l; p.sp = R_(4, 12); p.an = 0;
  }
}
function kill(f, scored) {
  const t = FT[f.k];
  shatter(f, 5 + t.s * 2.5); f.on = 0; // its own parts fly apart
  burst(f.x, f.y, f.z, 6, t.s, 6 + t.s * 3, t.r, t.g, t.b); sfx('kill');
  if (!scored) return;
  const pts = Math.round(t.pts * mult * DF.sc); score += pts; popup(`+${pts}`, mult >= 2.5);
  gainXp(t.xp);
  // chests only drop once you have levelled up at least once (they give stacks of upgrades you own). The first one is
  // guaranteed: on the last enemy of wave 1, or, if you had not levelled by then, on your first kill after it.
  if (level >= 2) {
    if (!firstChest && (wave > 1 || (toSpawn === 0 && !foes.some((o) => o.on)))) { firstChest = 1; dropChest(f.x, f.y, f.z, false); banner('宝箱に触れて開けよう！'); }
    else if (Math.random() < CHEST_P[f.k]) dropChest(f.x, f.y, f.z, false);
  }
  if (SLOWUP && ++killN % 15 === 0) { slowT = 3; banner('時間減速'); sfx('slow'); }
  if (LEECH) hp = min(MAXHP, hp + 3 * LEECH);
  if (BOOM) { // chain explosion: damages everything near, kills can chain further
    const R = 3 + 1.5 * BOOM + (EVBOOM ? 3 : 0), bd = 10 * (1 + BOOM) * (EVBOOM ? 2 : 1); burst(f.x, f.y, f.z, EVBOOM ? 22 : 14, R * 0.6, R * 2.2, 1, 0.6, 0.15);
    for (const o of foes) if (o.on && hypot(o.x - f.x, o.y - f.y, o.z - f.z) < R + FT[o.k].s) { o.hp -= bd; o.fl = 1; hit(); if (o.hp <= 0) kill(o, true); }
  }
}
// tracer: a thin glowing box from (sx, sy, sz) to (tx, ty, tz)
let trI = 0;
function tracer(sx, sy, sz, tx, ty, tz, r, g, b, life = 0.06) {
  const tr = tracers.find((o) => !o.on) || tracers[trI++ % tracers.length];
  let ex = tx - sx, ey = ty - sy, ez = tz - sz; const l = hypot(ex, ey, ez) || 1; ex /= l; ey /= l; ez /= l;
  let q0 = -ey, q1 = ex, q2 = 0, q3 = 1 + ez; const ql = hypot(q0, q1, q2, q3); if (ql < 1e-4) { q0 = 0; q1 = 1; q3 = 0; } else { q0 /= ql; q1 /= ql; q3 /= ql; }
  tr.on = 1; tr.life = life; tr.l = l * 0.5; tr.x = sx + ex * l * 0.5; tr.y = sy + ey * l * 0.5; tr.z = sz + ez * l * 0.5; tr.q0 = q0; tr.q1 = q1; tr.q2 = q2; tr.q3 = q3;
  tr.cr = r; tr.cg = g; tr.cb = b;
}
// one shot ray from (ox, oy, oz) along d; the tracer starts at (sx, sy, sz). It hits up to 1 + PIERCE (+1 破砕砲)
// enemies or bolts, rock stops it or, with 跳弾, bounces it off the surface. The combo counts each enemy once per trigger.
const HITS = []; let shotId = 0, hitSnd = 0, firstHit = null;
function ray(sx, sy, sz, ox, oy, oz, dx, dy, dz, pd, range, bounce, cr, cg, cb) {
  const rk = rayRock(ox, oy, oz, dx, dy, dz, range), bt = rk >= 0 ? rk : range;
  HITS.length = 0;
  for (const f of foes) if (f.on) { const t = rayBox(ox, oy, oz, dx, dy, dz, f.x, f.y, f.z, FT[f.k].s * 1.15, f.q0, f.q1, f.q2, f.q3, bt); if (t >= 0) HITS.push(t, f); }
  for (const b of bolts) if (b.on) { const t = rayBox(ox, oy, oz, dx, dy, dz, b.x, b.y, b.z, 0.5, 0, 0, 0, 1, bt); if (t >= 0) HITS.push(t, b); }
  if (boss.on && boss.st > 0 && boss.st < 4) for (let i = 0; i < boss.nb; i++) {
    if (BPS[i] <= 0) continue;
    const t = rayBox(ox, oy, oz, dx, dy, dz, BPX[i], BPY[i], BPZ[i], BPS[i], BPQ[i * 4], BPQ[i * 4 + 1], BPQ[i * 4 + 2], BPQ[i * 4 + 3], bt);
    if (t >= 0) HITS.push(t, BPROX[i]);
  }
  const order = []; for (let i = 0; i < HITS.length; i += 2) order.push(i); order.sort((p, q) => HITS[p] - HITS[q]);
  let left = 1 + PIERCE + EVSHOT, end = bt;
  for (const i of order) {
    const t = HITS[i], o = HITS[i + 1]; if (!o.on) continue;
    if (o.bp) { if (!boss.on || boss.st === 4 || o.i >= boss.nb || BPS[o.i] <= 0) continue; bossHit(o.i, pd); }
    else if ('k' in o) {
      o.hp -= pd; o.fl = 1; if (o.hs !== shotId) { o.hs = shotId; hit(); } if (!firstHit) firstHit = o;
      if (o.hp <= 0) kill(o, true); else if (!hitSnd++) sfx('hit');
    }
    else { o.on = 0; score += Math.round(25 * mult * DF.sc); hit(); sfx('bolt'); burst(o.x, o.y, o.z, 5, 0.3, 4, 1, 0.55, 0.1); }
    hitFx = 1; end = t; if (--left <= 0) break;
  }
  if (left > 0) end = bt;
  tracer(sx, sy, sz, ox + dx * end, oy + dy * end, oz + dz * end, cr, cg, cb);
  if (left > 0 && rk >= 0) {
    const hx = ox + dx * rk, hy = oy + dy * rk, hz = oz + dz * rk;
    burst(hx, hy, hz, 3, 0.2, 3, 0.5, 0.45, 0.4);
    if (bounce > 0 && range - rk > 1 && rockGrad(hx, hy, hz)) { // mirror off the surface (V3 points into the rock)
      const nx = -V3[0], ny = -V3[1], nz = -V3[2], dn = dx * nx + dy * ny + dz * nz;
      const bx = hx + nx * 0.35, by = hy + ny * 0.35, bz = hz + nz * 0.35;
      ray(bx, by, bz, bx, by, bz, dx - 2 * dn * nx, dy - 2 * dn * ny, dz - 2 * dn * nz, pd, range - rk, bounce - 1, 1, 0.85, 0.4);
    }
  }
}
// 磁力弾: bends a direction towards the enemy nearest to it within ~6° (result in V3)
function homing(dx, dy, dz) {
  let best = 0.9945, bx = dx, by = dy, bz = dz;
  for (const f of foes) if (f.on) {
    const ex = f.x - F[CX], ey = f.y - F[CY], ez = f.z - F[CZ], l = hypot(ex, ey, ez); if (l > RANGE || l < 0.1) continue;
    const c = (ex * dx + ey * dy + ez * dz) / l; if (c > best) { best = c; bx = ex / l; by = ey / l; bz = ez / l; }
  }
  const x = dx * 0.25 + bx * 0.75, y = dy * 0.25 + by * 0.75, z = dz * 0.25 + bz * 0.75, l = hypot(x, y, z) || 1;
  V3[0] = x / l; V3[1] = y / l; V3[2] = z / l;
}
// 連鎖雷: from the first enemy hit, lightning jumps to up to 3 more enemies within 12 m
const ZAP = [];
function chainZap(f0) {
  let fx = f0.x, fy = f0.y, fz = f0.z; const dmg = max(1, Math.round(DMG * 0.6)); ZAP.length = 0; ZAP.push(f0);
  for (let j = 0; j < 3; j++) {
    let bd = 12, bn = null;
    for (const o of foes) if (o.on && !ZAP.includes(o)) { const d = hypot(o.x - fx, o.y - fy, o.z - fz); if (d < bd) { bd = d; bn = o; } }
    if (!bn) break;
    const mx = (fx + bn.x) / 2 + R_(-0.7, 0.7), my = (fy + bn.y) / 2 + R_(-0.7, 0.7), mz = (fz + bn.z) / 2 + R_(-0.7, 0.7);
    tracer(fx, fy, fz, mx, my, mz, 1, 1, 0.55, 0.12); tracer(mx, my, mz, bn.x, bn.y, bn.z, 1, 1, 0.55, 0.12);
    ZAP.push(bn); fx = bn.x; fy = bn.y; fz = bn.z;
    bn.hp -= dmg; bn.fl = 1; hit(); if (bn.hp <= 0) kill(bn, true);
  }
  if (ZAP.length > 1) sfx('zap');
}
// fires one trigger pull: SHOT[MULTI].n pellets in a cone (+ 分裂弾 extras), each one ray()
function shoot() {
  gunPose(); const mx = GP[0] + GMZ[0], my = GP[1] + GMZ[1], mz = GP[2] + GMZ[2]; // muzzle, before the kick
  const sh = SHOT[MULTI], pd = max(1, Math.round(DMG * sh.mul * (EVSHOT ? 1.5 : 1))); shotId++; hitSnd = 0; firstHit = null;
  ammo--; fireT = FIRE / sh.rate / (frenzyOn ? 2 : 1) / (EVRATE ? 1.4 : 1); sfx('shot'); mdy -= 2.2; gRec = 1; gFlash = 0.05; // recoil
  camDir(); const cx0 = V3[0], cy0 = V3[1], cz0 = V3[2], ox = F[CX], oy = F[CY], oz = F[CZ];
  const rx = cos(F[YAW]), rz = sin(F[YAW]), ux = -rz * cy0, uy = rz * cx0 - rx * cz0, uz = rx * cy0; // right and up of the view
  const extra = SPLIT && Math.random() < (SPLIT > 1 ? 0.7 : 0.4) ? (SPLIT > 1 ? 3 : 2) : 0, sd = max(1, Math.round(DMG * 0.6));
  for (let k = 0; k < sh.n + extra; k++) {
    const sp = k >= sh.n, rr = sp ? R_(0.04, 0.14) : k ? sh.cone * sqrt(Math.random()) : 0, th = Math.random() * TAU, a = rr * cos(th), e = rr * sin(th);
    let dx = cx0 + rx * a + ux * e, dy = cy0 + uy * e, dz = cz0 + rz * a + uz * e; const dl = hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
    if (HOMING) { homing(dx, dy, dz); dx = V3[0]; dy = V3[1]; dz = V3[2]; }
    ray(mx, my, mz, ox, oy, oz, dx, dy, dz, sp ? sd : pd, RANGE, RICO, sp ? 1 : 0.5, sp ? 0.55 : 1, 1);
  }
  if (CHAIN && firstHit && gtime >= chainT) { chainT = gtime + 0.2; chainZap(firstHit); }
}
// touch screens have no trigger: the gun fires by itself while an enemy is under the crosshair
function onTarget() {
  camDir(); const dx = V3[0], dy = V3[1], dz = V3[2];
  for (const f of foes) if (f.on && rayBox(F[CX], F[CY], F[CZ], dx, dy, dz, f.x, f.y, f.z, FT[f.k].s * 1.3, f.q0, f.q1, f.q2, f.q3, 70) >= 0) return true;
  if (boss.on && boss.st > 0 && boss.st < 4) for (let i = 0; i < boss.nb; i++)
    if (BPS[i] > 0 && rayBox(F[CX], F[CY], F[CZ], dx, dy, dz, BPX[i], BPY[i], BPZ[i], BPS[i] * 1.2, BPQ[i * 4], BPQ[i * 4 + 1], BPQ[i * 4 + 2], BPQ[i * 4 + 3], 70) >= 0) return true;
  return false;
}

function gameStep(dt) {
  gtime += dt; hurtFx = max(0, hurtFx - dt * 1.5); hitFx = max(0, hitFx - dt * 6);
  gRec *= exp(-dt * 14); gFlash = max(0, gFlash - dt); gBob += dt * min(hypot(F[VX], F[VY], F[VZ]), 26) * 0.9;
  for (const p of debris) if (p.on) {
    const k = exp(-dt * 2.2); p.vx *= k; p.vy = p.vy * k - 1.2 * dt; p.vz *= k;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.an += p.sp * dt; if ((p.life -= dt) <= 0) p.on = 0;
    p.sp *= exp(-dt * 0.8);
  }
  for (const t of tracers) if (t.on && (t.life -= dt) <= 0) t.on = 0;
  if (over || choosing || chestOpen) return;
  if (pending > 0) { offer(); if (choosing) return; }
  if (combo && (comboT -= dt) <= 0) { combo = 0; mult = 1; }
  const fz = FRENZY && mult >= 4; if (fz && !frenzyOn) banner('狂乱！  連射 2倍'); frenzyOn = fz;
  slowT = max(0, slowT - dt);
  // flow field: keep refilling from where you are
  if (!navBusy) navBegin(); else navStep(NAV_BUDGET);
  const cx = F[CX], cy = F[CY], cz = F[CZ];
  // waves
  let alive = 0; for (const f of foes) alive += f.on;
  if (bossT > 0 && (bossT -= dt) <= 0) bossSpawn();
  if (restT >= 0) { if ((restT -= dt) < 0) nextWave(); }
  else if (toSpawn > 0) { if ((spawnT -= dt) <= 0 && alive < ALIVE) { if (spawn()) toSpawn--; spawnT = max(0.35, 1.5 - wave * 0.1); } }
  else if (!alive && !boss.on && bossT <= 0) { const b = Math.round(500 * wave * DF.sc); restT = 3; hp = min(MAXHP, hp + DF.heal); score += b; banner(`WAVE ${wave} CLEAR  +${b}`); }
  // you
  if ((calm += dt) > DF.rd) hp = min(MAXHP, hp + DF.rr * dt);
  fireT -= dt;
  if (reloadT > 0 && (reloadT -= dt) <= 0) ammo = MAG;
  if (!ammo && reloadT <= 0) { reloadT = RELOAD; sfx('reload'); }
  if ((firing || (mob && onTarget())) && fireT <= 0 && reloadT <= 0 && ammo > 0) shoot();
  // treasure chests: touch to open
  for (const c of chests) if (c.on) { c.t += dt; if (hypot(c.x - cx, c.y - cy, c.z - cz) < 2.6) { openChest(c); return; } }
  // enemies (and their bolts) run on edt: slowed by 時間減速
  const edt = slowT > 0 ? dt * 0.35 : dt;
  for (const f of foes) if (f.on) {
    const t = FT[f.k], sp = t.sp * SPBASE * spMul;
    let dx = cx - f.x, dy = cy - f.y, dz = cz - f.z; const d = hypot(dx, dy, dz) || 1; dx /= d; dy /= d; dz /= d;
    // line of sight, refreshed 5 times a second (staggered by the random start)
    if ((f.lt -= edt) <= 0) { f.lt = 0.2; f.los = rayRock(f.x, f.y, f.z, dx, dy, dz, d) < 0 ? 1 : 0; }
    const hl = hypot(dx, dz) || 1, px = -dz / hl, pz = dx / hl; // horizontal sideways
    let tx, ty, tz;
    if (!f.los && flowDir(f.x, f.y, f.z)) { tx = V3[0]; ty = V3[1]; tz = V3[2]; } // around the rock
    else if (f.k === 3) { // spitter: hold 18-28 m and circle
      const w = d < 18 ? -1 : d > 28 ? 1 : 0;
      tx = dx * w + px * f.side * 0.8; ty = dy * w * 0.5 + 0.2 * sin(gtime + f.ph); tz = dz * w + pz * f.side * 0.8;
      if ((f.cd -= edt) <= 0 && d < 45 && f.los) {
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
    const tl = hypot(tx, ty, tz) || 1, kk = 1 - exp(-edt * 2.5);
    f.vx += (tx / tl * sp - f.vx) * kk; f.vy += (ty / tl * sp - f.vy) * kk; f.vz += (tz / tl * sp - f.vz) * kk;
    // steer away from rock ahead, push out of rock it is already in
    const ra = rockAt(f.x + f.vx * 0.5, f.y + f.vy * 0.5, f.z + f.vz * 0.5);
    if (ra > -0.9 && rockGrad(f.x + f.vx * 0.5, f.y + f.vy * 0.5, f.z + f.vz * 0.5)) {
      const vn = f.vx * V3[0] + f.vy * V3[1] + f.vz * V3[2];
      if (vn > 0) { f.vx -= V3[0] * vn * 1.4; f.vy -= V3[1] * vn * 1.4; f.vz -= V3[2] * vn * 1.4; }
    }
    f.x += f.vx * edt; f.y += f.vy * edt; f.z += f.vz * edt;
    const thr = -min(t.s * 0.6, 0.9), r0 = rockAt(f.x, f.y, f.z);
    if (r0 > thr && rockGrad(f.x, f.y, f.z)) { f.x -= V3[0] * (r0 - thr); f.y -= V3[1] * (r0 - thr); f.z -= V3[2] * (r0 - thr); }
    const rr2 = hypot(f.x, f.z); if (rr2 > 148) { f.x *= 148 / rr2; f.z *= 148 / rr2; }
    f.y = clamp(f.y, -51, -2);
    f.an += edt; f.fl = max(0, f.fl - edt * 8);
    // face you (the dart faces where it flies), turning smoothly; this is also the hit box's rotation
    let hx = dx, hy = dy, hz = dz;
    if (f.k === 1) { const vl = hypot(f.vx, f.vy, f.vz); if (vl > 0.5) { hx = f.vx / vl; hy = f.vy / vl; hz = f.vz / vl; } }
    const ty0 = atan2(hx, -hz), tp0 = atan2(hy, hypot(hx, hz)), kt = min(1, edt * (f.k === 1 ? 10 : 5));
    f.yw += atan2(sin(ty0 - f.yw), cos(ty0 - f.yw)) * kt; f.pt += (tp0 - f.pt) * kt;
    f.rl = f.k === 1 ? f.rl + edt * 7 : f.k === 3 ? f.rl + edt * 0.8 : f.k === 0 ? 0.35 * sin(gtime * 1.7 + f.ph) : 0;
    qlook(f.yw, f.pt, f.rl); f.q0 = QB[0]; f.q1 = QB[1]; f.q2 = QB[2]; f.q3 = QB[3];
    f.born = min(1, f.born + edt / ASM);
    foeTrail(f);
    if (f.k === 2) { // the shell loses a plate for every 1/8 of its HP; the plate flies off
      const want = Math.ceil(8 * max(0, f.hp) / f.mh);
      while (f.pl > want && f.pl > 0) { f.pl--; plateOff(f, f.pl); }
    }
    if (f.k !== 3 && d < t.s + 0.8) { hurt(t.dmg); kill(f, false); }
    else if (f.k === 3 && d < t.s + 0.8) { hurt(t.dmg); f.vx = -dx * 12; f.vy = -dy * 12; f.vz = -dz * 12; }
  }
  if (boss.on) bossStep(edt, cx, cy, cz);
  // bolts
  for (const b of bolts) if (b.on) {
    b.x += b.vx * edt; b.y += b.vy * edt; b.z += b.vz * edt; b.an += edt * 6;
    if (hypot(b.x - cx, b.y - cy, b.z - cz) < 0.9) { b.on = 0; hurt(BOLTDMG); burst(b.x, b.y, b.z, 5, 0.3, 4, 1, 0.55, 0.1); }
    else if ((b.life -= edt) <= 0 || rockAt(b.x, b.y, b.z) > 0) { b.on = 0; burst(b.x, b.y, b.z, 4, 0.3, 3, 1, 0.55, 0.1); }
  }
}

// ---------------------------------------------------------------- boss: キューブリヴァイアサン
// A head and BSEG body segments that follow it on a trail (fixed spacing BSP), then a tail fin. States (st):
// 0 assembling, 1 circling (spits fans of bolts), 2 roaring before a charge, 3 charging, 4 dying (blows up tail first)
const BOSSW = 5, BSEG = 22, BSP = 2.3, BHS = 2.2;
const KS = 2.6, KT = 6, KJ = 7, KDUR = [0, 0.9, 0.42, 0.75]; // kraken: mantle half size, tentacles, segments, windup / strike / recover
const JS = 3.4, JSAC = 4, JTN = 8, JTJ = 10; // giant jelly: bell half size, brood sacs, tentacles, segments
const NBOX = 2 + KT * KJ; // most hit boxes any boss has
const BOSSN = ['キューブリヴァイアサン', 'キューブクラーケン', '巨大キューブクラゲ'], BOSSK = ['boss', 'boss1', 'boss2'];
const boss = { kind: 0, nb: 0, warn: 0, ks: new Int8Array(KT), kT: new Float32Array(KT), kx: new Float32Array(KT), ky: new Float32Array(KT),
  kz: new Float32Array(KT), khit: new Int8Array(KT), thp: new Float32Array(8), tfl: new Float32Array(8), on: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yw: 0, pt: 0, hp: 1, mh: 1, n: 0, born: 0, st: 0, stT: 0, th: 0, side: 1,
  ph2: 0, cd: 0, spT: 0, sumT: 0, hitT: 0, fl: 0, dT: 0, hs: 0, an: 0, jaw: 0, gx: 0, gy: 0, gz: 0, critT: 0,
  tr: new Float32Array((BSEG + 2) * 3), shp: new Float32Array(BSEG), sfl: new Float32Array(BSEG) };
let bossT = 0; // > 0: seconds until the boss of this wave appears
// hit boxes, 0 head, 1..n segments, n + 1 tail fin (cube half size BPS, rotation BPQ), refreshed by bossPose()
const BPX = new Float64Array(NBOX), BPY = new Float64Array(NBOX), BPZ = new Float64Array(NBOX), BPS = new Float64Array(NBOX), BPQ = new Float64Array(NBOX * 4), BPL = new Float64Array(NBOX);
const BPROX = pool(NBOX, (_, i) => ({ on: 1, bp: 1, i })); // stand-ins for the boss boxes in ray()
const CAPO = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }; // capture origin when the boss breaks apart
const segS = (i) => BHS * 0.78 * (1 - 0.5 * (i - 1) / BSEG); // half size of segment i (1-based)

function bossSpawn() {
  const B = boss;
  let x = 0, y = -25, z = 0;
  for (let i = 0; i < 60; i++) { // open, reachable water 45-60 m out, preferably in front of you
    camDir(); const a = atan2(V3[2], V3[0]) + R_(-1, 1) * (i < 30 ? 0.8 : PI), d = R_(45, 60);
    const px = F[CX] + cos(a) * d, pz = F[CZ] + sin(a) * d, py = clamp(F[CY] + R_(-3, 6), -40, -10);
    if (hypot(px, pz) > 135 || rockAt(px, py, pz) > -0.99) continue;
    const c = cellOf(px, py, pz); if (c < 0 || !OPEN[c] || DA[c] === FAR) continue;
    x = px; y = py; z = pz; break;
  }
  B.kind = ((wave / BOSSW | 0) - 1) % 3; B.warn = 0;
  B.on = 1; B.x = x; B.y = y; B.z = z; B.vx = B.vy = B.vz = 0; B.st = 0; B.born = 0; B.n = BSEG; B.ph2 = 0; B.fl = 0; B.an = 0; B.jaw = 0;
  B.mh = B.hp = Math.round([3600, 3400, 3000][B.kind] * DF.hp * (1 + 0.6 * (wave / BOSSW - 1)));
  B.yw = atan2(F[CX] - x, -(F[CZ] - z)); B.pt = 0; B.th = atan2(z - F[CZ], x - F[CX]); B.side = Math.random() < 0.5 ? -1 : 1;
  B.hitT = 0; B.critT = 0; B.los = 1; B.losT = 0;
  if (B.kind === 0) {
    B.cd = 7; B.spT = 3.5; B.sumT = 6;
    for (let i = 0; i < BSEG; i++) { B.shp[i] = Math.round(B.mh * 0.055); B.sfl[i] = 0; }
    const bx = -sin(B.yw), bz = cos(B.yw); // behind the head
    for (let j = 0; j < BSEG + 2; j++) { B.tr[j * 3] = x + bx * (BHS + j * BSP); B.tr[j * 3 + 1] = y; B.tr[j * 3 + 2] = z + bz * (BHS + j * BSP); }
  } else if (B.kind === 1) {
    B.cd = 4; B.spT = 3; B.sumT = 9;
    for (let t = 0; t < KT; t++) { B.thp[t] = Math.round(B.mh * 0.06); B.tfl[t] = 0; B.ks[t] = 0; B.kT[t] = 0; }
  } else {
    B.cd = 6; B.sumT = 3;
    for (let k = 0; k < JSAC; k++) { B.thp[k] = Math.round(B.mh * 0.07); B.tfl[k] = 0; }
  }
  bossPose(); sfx('roar');
}
// head heading → trail → hit boxes
function levPose() {
  const B = boss, T = B.tr; B.nb = B.n + 2;
  qlook(B.yw, B.pt, 0.15 * sin(B.an * 1.3));
  BPX[0] = B.x; BPY[0] = B.y; BPZ[0] = B.z; BPS[0] = BHS; BPQ[0] = QB[0]; BPQ[1] = QB[1]; BPQ[2] = QB[2]; BPQ[3] = QB[3];
  GBQ[0] = QB[0]; GBQ[1] = QB[1]; GBQ[2] = QB[2]; GBQ[3] = QB[3]; brot(0, 0, BHS * 1.05);
  T[0] = B.x + V3[0]; T[1] = B.y + V3[1]; T[2] = B.z + V3[2];
  for (let j = 1; j <= B.n + 1; j++) {
    const o = j * 3; let dx = T[o] - T[o - 3], dy = T[o + 1] - T[o - 2], dz = T[o + 2] - T[o - 1];
    const l = hypot(dx, dy, dz) || 1, sp = j === 1 ? BSP * 0.6 : BSP;
    T[o] = T[o - 3] + dx / l * sp; T[o + 1] = T[o - 2] + dy / l * sp; T[o + 2] = T[o - 1] + dz / l * sp;
  }
  for (let i = 1; i <= B.n + 1; i++) { // box i sits on trail point i, facing point i - 1
    const o = i * 3, dx = T[o - 3] - T[o], dy = T[o - 2] - T[o + 1], dz = T[o - 1] - T[o + 2], l = hypot(dx, dy, dz) || 1;
    qlook(atan2(dx / l, -dz / l), atan2(dy / l, hypot(dx, dz) / l), 0);
    BPX[i] = T[o]; BPY[i] = T[o + 1]; BPZ[i] = T[o + 2]; BPS[i] = i > B.n ? 1.1 : segS(i);
    BPQ[i * 4] = QB[0]; BPQ[i * 4 + 1] = QB[1]; BPQ[i * 4 + 2] = QB[2]; BPQ[i * 4 + 3] = QB[3];
  }
}
function levStep(dt, cx, cy, cz) {
  const B = boss;
  for (let i = 0; i < B.n; i++) B.sfl[i] = max(0, B.sfl[i] - dt * 8);
  if (B.st === 4) { // dying: segments burst from the tail to the head, then the head
    if ((B.dT -= dt) <= 0) { if (B.n > 0) { B.dT = 0.075; bossBreak(B.n - 1, false); } else bossDie(); }
    return;
  }
  let dx = cx - B.x, dy = cy - B.y, dz = cz - B.z; const d = hypot(dx, dy, dz) || 1; dx /= d; dy /= d; dz /= d;
  const rage = B.ph2 ? 1.22 : 1, base = 9.5 * rage * (0.8 + 0.2 * DF.sp);
  let gx, gy, gz, spd = base, turn = 1.4;
  if (B.st === 3) { gx = B.gx; gy = B.gy; gz = B.gz; spd = 30 * rage; turn = 5; }
  else if (B.st === 2) { gx = dx; gy = dy; gz = dz; spd = 2; turn = 3.5; }
  else { // circle you at 26-34 m, bobbing up and down
    const R = 30 + 4 * sin(B.an * 0.3); B.th += dt * base / R * B.side * (B.st === 0 ? 0.3 : 1);
    gx = cx + cos(B.th) * R - B.x; gy = clamp(cy + 5 * sin(B.an * 0.45), -44, -7) - B.y; gz = cz + sin(B.th) * R - B.z;
    const l = hypot(gx, gy, gz) || 1; gx /= l; gy /= l; gz /= l;
    if (B.st === 0) spd = 2;
    bossLos(dt, cx, cy, cz); // rock between you: come round it along the flow field
    if (B.st === 1 && !B.los && flowDir(B.x, B.y, B.z)) { gx = V3[0]; gy = V3[1]; gz = V3[2]; B.th = atan2(B.z - cz, B.x - cx); }
  }
  // rock ahead: follow the flow field round it (or rise); a charge that would hit rock ends
  const vl = hypot(B.vx, B.vy, B.vz) || 1, fx = B.vx / vl, fy = B.vy / vl, fz = B.vz / vl;
  if (rockAt(B.x + fx * 4, B.y + fy * 4, B.z + fz * 4) > -0.99 || rockAt(B.x + fx * 7, B.y + fy * 7, B.z + fz * 7) > -0.99) {
    if (B.st === 3) { B.st = 1; B.cd = R_(4, 6); }
    if (flowDir(B.x, B.y, B.z)) { gx = V3[0]; gy = V3[1] + 0.3; gz = V3[2]; } else { gx *= 0.3; gy = 1; gz *= 0.3; }
  }
  const k = 1 - exp(-dt * turn);
  B.vx += (gx * spd - B.vx) * k; B.vy += (gy * spd - B.vy) * k; B.vz += (gz * spd - B.vz) * k;
  B.x += B.vx * dt; B.y += B.vy * dt; B.z += B.vz * dt;
  const r0 = rockAt(B.x, B.y, B.z); if (r0 > -1 && rockGrad(B.x, B.y, B.z)) { B.x -= V3[0] * (r0 + 1); B.y -= V3[1] * (r0 + 1); B.z -= V3[2] * (r0 + 1); }
  const rr = hypot(B.x, B.z); if (rr > 140) { B.x *= 140 / rr; B.z *= 140 / rr; }
  B.y = clamp(B.y, -47, -5);
  // heading follows the velocity (or faces you while roaring / assembling)
  const hx = B.st === 2 || B.st === 0 ? dx : B.vx, hy = B.st === 2 || B.st === 0 ? dy : B.vy, hz = B.st === 2 || B.st === 0 ? dz : B.vz, hl = hypot(hx, hy, hz);
  if (hl > 0.3) {
    const kt = min(1, dt * (B.st === 3 ? 8 : 3));
    B.yw += atan2(sin(atan2(hx, -hz) - B.yw), cos(atan2(hx, -hz) - B.yw)) * kt; B.pt += (atan2(hy, hypot(hx, hz)) - B.pt) * kt;
  }
  B.jaw += ((B.st === 2 ? 0.75 : B.st === 3 ? 0.5 : B.spT < 0.6 ? 0.45 : 0.08) - B.jaw) * min(1, dt * 8);
  levPose();
  if (B.st === 0) return;
  // attacks
  const near = d < 70;
  if (B.st === 1) {
    if ((B.spT -= dt) <= 0) { // fan of bolts from the mouth
      B.spT = (B.ph2 ? 3.8 : 5) * DF.cd;
      if (near && rayRock(B.x, B.y, B.z, dx, dy, dz, d) < 0) {
        const m = B.ph2 ? 7 : 5, mx = B.x + dx * BHS * 1.3, my = B.y + dy * BHS * 1.3, mz = B.z + dz * BHS * 1.3;
        for (let j = 0; j < m; j++) {
          const b = bolts.find((o) => !o.on); if (!b) break;
          const a = (j - (m - 1) / 2) * 0.13, ca = cos(a), sa = sin(a), vx = dx * ca - dz * sa, vz = dx * sa + dz * ca;
          b.on = 1; b.x = mx; b.y = my; b.z = mz; b.vx = vx * BOLTSP; b.vy = dy * BOLTSP; b.vz = vz * BOLTSP; b.life = 6; b.an = j;
        }
        sfx('spit');
      }
    }
    if ((B.cd -= dt) <= 0 && near) { B.st = 2; B.stT = 1.15; sfx('roar'); }
    if (B.ph2 && (B.sumT -= dt) <= 0) { // enraged: calls jellies
      B.sumT = 7;
      let alive = 0; for (const f of foes) alive += f.on;
      for (let j = 0; j < 2 && alive < ALIVE; j++) {
        const f = foes.find((o) => !o.on); if (!f) break;
        const x = B.x + R_(-3, 3), y = B.y + R_(1, 3), z = B.z + R_(-3, 3); if (rockAt(x, y, z) > -0.99) continue;
        initFoe(f, 0, x, y, z); alive++;
      }
    }
  } else if (B.st === 2 && (B.stT -= dt) <= 0) { B.st = 3; B.stT = 1.6; B.gx = dx; B.gy = dy; B.gz = dz; sfx('dash'); }
  else if (B.st === 3 && (B.stT -= dt) <= 0) { B.st = 1; B.cd = R_(5, 7) / rage; }
  // touching it hurts (the head more, most while charging) and knocks you away
  if ((B.hitT -= dt) <= 0) {
    let hitI = -1;
    if (hypot(cx - B.x, cy - B.y, cz - B.z) < BHS + 1.3) hitI = 0;
    else for (let i = 1; i <= B.n; i++) if (hypot(cx - BPX[i], cy - BPY[i], cz - BPZ[i]) < BPS[i] + 0.9) { hitI = i; break; }
    if (hitI >= 0) {
      hurt(hitI ? 10 : B.st === 3 ? 30 : 18); B.hitT = 1;
      let px = cx - BPX[hitI], py = cy - BPY[hitI], pz = cz - BPZ[hitI]; const pl = hypot(px, py, pz) || 1;
      F[VX] += px / pl * 16; F[VY] += py / pl * 16; F[VZ] += pz / pl * 16;
      if (B.st === 3) { B.st = 1; B.cd = R_(5, 7); }
    }
  }
}
// leviathan box i: 0 head and n + 1 tail are weak points (x2), the rest are segments with their own HP
function levHit(i, pd) {
  const B = boss;
  if (i === 0 || i === B.n + 1) { weakHit(pd); return; }
  B.hp -= pd; const s = i - 1; B.sfl[s] = 1; B.shp[s] -= pd; if (B.shp[s] <= 0) bossBreak(s, true); else if (!hitSnd++) sfx('hit');
}
// segment s (0-based) breaks: its boxes fly off, the body closes up behind it
function bossBreak(s, scored) {
  const B = boss, i = s + 1;
  CAPO.x = BPX[i]; CAPO.y = BPY[i]; CAPO.z = BPZ[i]; CAPO.vx = B.vx * 0.3; CAPO.vy = B.vy * 0.3; CAPO.vz = B.vz * 0.3;
  cap = CAPO; capV = 9; drawSeg(i); cap = null;
  burst(BPX[i], BPY[i], BPZ[i], 8, BPS[i], 9, 0.3, 0.95, 1); sfx('segbreak');
  for (let j = s; j < B.n - 1; j++) { B.shp[j] = B.shp[j + 1]; B.sfl[j] = B.sfl[j + 1]; }
  for (let j = i + 1; j <= B.n + 1; j++) { const o = j * 3; B.tr[o] = B.tr[o + 3]; B.tr[o + 1] = B.tr[o + 4]; B.tr[o + 2] = B.tr[o + 5]; }
  B.n--;
  if (scored) {
    B.hp -= B.mh * 0.04; const pts = Math.round(300 * mult * DF.sc); score += pts; popup(`+${pts}`, true); gainXp(12);
    bossDown();
  }
}
function bossDie() {
  const B = boss;
  CAPO.x = B.x; CAPO.y = B.y; CAPO.z = B.z; CAPO.vx = CAPO.vy = CAPO.vz = 0;
  cap = CAPO; capV = 12; pIdx = 0; basm = 0;
  if (B.kind === 0) { drawBossHead(); drawSeg(B.n + 1); } else if (B.kind === 1) krakDraw(-1); else jellyDraw(-1);
  cap = null;
  const C = [[1, 0.4, 0.7, 0.3, 0.95, 1], [1, 0.55, 0.2, 0.55, 0.12, 0.2], [1, 0.45, 0.9, 0.75, 1, 0.35]][B.kind];
  burst(B.x, B.y, B.z, 30, BHS * 2, 16, C[0], C[1], C[2]); burst(B.x, B.y, B.z, 20, BHS, 10, C[3], C[4], C[5]); sfx('kill');
  const pts = Math.round(4000 * (wave / BOSSW) * DF.sc * mult); score += pts; popup(`+${pts}`, true); gainXp(200);
  dropChest(B.x, B.y, B.z, true); dexAdd(BOSSK[B.kind]); bossKills++;
  B.on = 0;
}

// boss look: dark indigo armour, cyan glow lines (red-orange when enraged), pink weak points
let basm = 0;
function bpart(lx, ly, lz, sx, sy, sz, qx, qy, qz, qw, fl, r, g, b, gl) {
  if (basm > 0) { const h = ++pIdx * 12.9898, k = basm * 9; lx += sin(h) * k; ly += cos(h * 1.37) * k; lz += sin(h * 0.71 + 1) * k; const m = 1 - basm * 0.5; sx *= m; sy *= m; sz *= m; gl += basm * 7; }
  part(GP0[0], GP0[1], GP0[2], lx, ly, lz, sx, sy, sz, qx, qy, qz, qw, fl, r, g, b, gl);
}
const GP0 = new Float64Array(3);
function glowC() { return boss.ph2 ? [1, 0.38, 0.15] : [0.3, 0.95, 1]; }
function drawBossHead() {
  const B = boss, s = BHS, a = B.an, fl = B.fl, [gr, gg, gb] = glowC(), eye = B.st === 2 ? 10 : 6 + 2 * sin(a * 5);
  GBQ[0] = BPQ[0]; GBQ[1] = BPQ[1]; GBQ[2] = BPQ[2]; GBQ[3] = BPQ[3]; GP0[0] = B.x; GP0[1] = B.y; GP0[2] = B.z;
  bpart(0, 0.15 * s, 0.1 * s, 0.82 * s, 0.6 * s, 0.95 * s, 0, 0, 0, 1, fl, 0.16, 0.2, 0.42, 1.2); // skull
  const j = B.jaw;
  bpart(0, 0.3 * s, -1.05 * s, 0.7 * s, 0.2 * s, 0.55 * s, sin(j * 0.35), 0, 0, cos(j * 0.35), fl, 0.18, 0.22, 0.46, 1.3); // upper jaw
  bpart(0, -0.45 * s - 0.25 * j * s, -0.95 * s, 0.62 * s, 0.14 * s, 0.6 * s, sin(-j * 0.5), 0, 0, cos(-j * 0.5), fl, 0.14, 0.17, 0.36, 1.1); // lower jaw
  for (let i = 0; i < 4; i++) { const tx = (i - 1.5) * 0.36 * s; // teeth
    bpart(tx, 0.12 * s, -1.45 * s, 0.07 * s, 0.2 * s, 0.05 * s, 0, 0, 0, 1, fl, 1, 1, 0.95, 3);
    bpart(tx + 0.18 * s, -0.3 * s - 0.25 * j * s, -1.42 * s, 0.07 * s, 0.18 * s, 0.05 * s, 0, 0, 0, 1, fl, 1, 1, 0.95, 3); }
  bpart(0, -0.05 * s, -1.2 * s, 0.5 * s, 0.1 * s + 0.2 * j * s, 0.05 * s, 0, 0, 0, 1, fl, 1, 0.3 + 0.2 * j, 0.5, 2 + 6 * j); // throat glow
  for (const sd of [-1, 1]) {
    bpart(sd * 0.84 * s, 0.42 * s, -0.5 * s, 0.07 * s, 0.17 * s, 0.22 * s, 0, 0, 0, 1, fl, 1, 0.25, 0.6, eye); // eyes (weak point), on the sides of the skull
    bpart(sd * 0.45 * s, 0.5 * s, -0.86 * s, 0.2 * s, 0.07 * s, 0.03 * s, 0, 0, sd * sin(0.2), cos(0.2), fl, 1, 0.25, 0.6, eye * 0.8); // glowing brows
    bpart(sd * 0.88 * s, 0.05 * s, 0.1 * s, 0.07 * s, 0.4 * s, 0.6 * s, 0, 0, sin(sd * 0.25), cos(sd * 0.25), fl, gr, gg, gb, 3); // gill plates
    const w = 0.25 * sin(a * 2.2 + sd); // whiskers
    bpart(sd * 0.55 * s, -0.35 * s, -1.5 * s, 0.05 * s, 0.05 * s, 0.5 * s, sin(w / 2), 0, 0, cos(w / 2), fl, gr, gg, gb, 4);
  }
  for (let i = 0; i < 3; i++) bpart(0, (0.8 + 0.15 * i) * s, (-0.35 + 0.42 * i) * s, 0.06 * s, (0.35 - 0.06 * i) * s, 0.16 * s, sin(-0.3), 0, 0, cos(-0.3), fl, gr, gg, gb, 3.5); // crest
}
// segment i (1..n) or the tail fin (n + 1)
function drawSeg(i) {
  const B = boss, [gr, gg, gb] = glowC();
  GBQ[0] = BPQ[i * 4]; GBQ[1] = BPQ[i * 4 + 1]; GBQ[2] = BPQ[i * 4 + 2]; GBQ[3] = BPQ[i * 4 + 3]; GP0[0] = BPX[i]; GP0[1] = BPY[i]; GP0[2] = BPZ[i];
  if (i > B.n) { // tail: two glowing blades in a V (weak point)
    const w = 0.35 * sin(B.an * 3), fl = B.fl;
    bpart(0, 0, 0, 0.45, 0.45, 0.7, 0, 0, 0, 1, fl, 0.16, 0.2, 0.42, 1.2);
    for (const sd of [-1, 1]) bpart(0, sd * 0.9, 1.2, 0.08, 1.1, 0.55, sin((sd * 0.55 + w) / 2), 0, 0, cos((sd * 0.55 + w) / 2), fl, 1, 0.3, 0.6, 5);
    return;
  }
  const s = segS(i), fl = B.sfl[i - 1], dmg = 1 - B.shp[i - 1] / (B.mh * 0.055);
  bpart(0, 0, 0, s, s * 0.92, BSP * 0.52, 0, 0, 0, 1, fl, i % 2 ? 0.16 : 0.2, i % 2 ? 0.2 : 0.25, i % 2 ? 0.42 : 0.5, 1.1 + 2.5 * dmg); // armour (glows hotter as it cracks)
  bpart(0, s * 1.02 + 0.25 * s * (i % 2), 0, 0.06 * s, 0.35 * s + 0.25 * s * (i % 2), 0.4 * s, sin(-0.35), 0, 0, cos(-0.35), fl, gr, gg, gb, 3.5); // dorsal spike
  if (i % 2 === 0 || cap) for (const sd of [-1, 1]) bpart(sd * s * 1.01, -0.1 * s, 0, 0.03 * s, 0.12 * s, BSP * 0.45, 0, 0, 0, 1, fl, gr, gg, gb, 5); // side lights
  if (i % 4 === 1 && i < B.n - 2) for (const sd of [-1, 1]) { const w = 0.4 * sin(B.an * 3 + i) * sd; // fins
    bpart(sd * s * 1.35, -0.4 * s, 0, 0.6 * s, 0.05 * s, 0.4 * s, 0, 0, sin(w / 2), cos(w / 2), fl, gr * 0.6, gg * 0.6, gb * 0.8, 2.5); }
}
function drawBoss() {
  const B = boss; pIdx = 0; basm = B.st === 0 ? (1 - B.born) * (1 - B.born) : 0;
  if (B.kind === 0) { drawBossHead(); for (let i = 1; i <= B.n + 1; i++) drawSeg(i); }
  else if (B.kind === 1) krakDraw(-2); else jellyDraw(-2);
  basm = 0;
}

// ---------------------------------------------------------------- bosses: shared parts
function bossPose() { if (boss.kind === 0) levPose(); else if (boss.kind === 1) krakPose(); else jellyPose(); }
function bossStep(dt, cx, cy, cz) {
  const B = boss; B.an += dt; B.fl = max(0, B.fl - dt * 8);
  if (B.st === 0 && (B.born = min(1, B.born + dt / 2.4)) >= 1) { B.st = 1; banner(BOSSN[B.kind]); }
  if (B.st !== 4 && !B.ph2 && B.hp < B.mh * 0.5) { B.ph2 = 1; banner('激昂！'); sfx('roar'); }
  if (B.kind === 0) levStep(dt, cx, cy, cz); else if (B.kind === 1) krakStep(dt, cx, cy, cz); else jellyStep(dt, cx, cy, cz);
}
function bossHit(i, pd) {
  const B = boss; if (B.st === 0 || B.st === 4) return;
  if (B.hs !== shotId) { B.hs = shotId; hit(); }
  if (B.kind === 0) levHit(i, pd); else if (B.kind === 1) krakHit(i, pd); else jellyHit(i, pd);
  bossDown();
}
function weakHit(pd) {
  const B = boss; B.hp -= pd * 2; B.fl = 1;
  if (!hitSnd++) sfx('crit'); if (gtime > B.critT) { B.critT = gtime + 0.6; popup('WEAK ×2'); }
}
function bossDown() {
  const B = boss;
  if (B.hp <= 0 && B.st !== 4) { B.st = 4; B.dT = 0.4; B.hp = 0; B.warn = 0; banner('BOSS DOWN!'); sfx('bossdie'); for (const b of bolts) b.on = 0; }
}
// hit box i at (x, y, z), half size s, rotation = the last qlook (QB)
function setBox(i, x, y, z, s) {
  BPX[i] = x; BPY[i] = y; BPZ[i] = z; BPS[i] = s;
  BPQ[i * 4] = QB[0]; BPQ[i * 4 + 1] = QB[1]; BPQ[i * 4 + 2] = QB[2]; BPQ[i * 4 + 3] = QB[3];
}
function useBox(i) { // anchor bpart() on hit box i
  GP0[0] = BPX[i]; GP0[1] = BPY[i]; GP0[2] = BPZ[i];
  GBQ[0] = BPQ[i * 4]; GBQ[1] = BPQ[i * 4 + 1]; GBQ[2] = BPQ[i * 4 + 2]; GBQ[3] = BPQ[i * 4 + 3];
}
function bossFace(dt, cx, cy, cz, k) {
  const B = boss, dx = cx - B.x, dy = cy - B.y, dz = cz - B.z, kt = min(1, dt * k), ty = atan2(dx, -dz);
  B.yw += atan2(sin(ty - B.yw), cos(ty - B.yw)) * kt; B.pt += (atan2(dy, hypot(dx, dz)) - B.pt) * kt;
}
function bossLos(dt, cx, cy, cz) { // B.los: can it see you (refreshed 3 times a second)
  const B = boss;
  if ((B.losT -= dt) <= 0) { B.losT = 0.3; const x = cx - B.x, y = cy - B.y, z = cz - B.z, d = hypot(x, y, z) || 1; B.los = rayRock(B.x, B.y, B.z, x / d, y / d, z / d, d) < 0 ? 1 : 0; }
}
// circle you at radius R (speed spd), hy above you. When rock hides you it follows the flow field round it (like the
// minions); rock right ahead on its way is avoided the same way.
function bossDrift(dt, cx, cy, cz, R, spd, hy) {
  const B = boss;
  bossLos(dt, cx, cy, cz);
  B.th += dt * spd * 0.6 / R * B.side;
  let gx = cx + cos(B.th) * R - B.x, gy = clamp(cy + hy, -44, -8) - B.y, gz = cz + sin(B.th) * R - B.z;
  const l = hypot(gx, gy, gz) || 1; let v = min(spd * 2, l * 0.9 + 0.5); gx /= l; gy /= l; gz /= l;
  if (!B.los && flowDir(B.x, B.y, B.z)) { gx = V3[0]; gy = V3[1]; gz = V3[2]; v = spd * 2; B.th = atan2(B.z - cz, B.x - cx); }
  else if (rockAt(B.x + gx * 5, B.y + gy * 5, B.z + gz * 5) > -0.99) { if (flowDir(B.x, B.y, B.z)) { gx = V3[0]; gy = V3[1] + 0.3; gz = V3[2]; } else { gx *= 0.3; gy = 1; gz *= 0.3; } }
  const k = 1 - exp(-dt * 1.5);
  B.vx += (gx * v - B.vx) * k; B.vy += (gy * v - B.vy) * k; B.vz += (gz * v - B.vz) * k;
  B.x += B.vx * dt; B.y += B.vy * dt; B.z += B.vz * dt;
  const r0 = rockAt(B.x, B.y, B.z); if (r0 > -1 && rockGrad(B.x, B.y, B.z)) { B.x -= V3[0] * (r0 + 1); B.y -= V3[1] * (r0 + 1); B.z -= V3[2] * (r0 + 1); }
  const rr = hypot(B.x, B.z); if (rr > 140) { B.x *= 140 / rr; B.z *= 140 / rr; }
  B.y = clamp(B.y, -46, -6);
}
function bossBolt(x, y, z, dx, dy, dz, sp) {
  const b = bolts.find((o) => !o.on); if (!b) return;
  b.on = 1; b.x = x; b.y = y; b.z = z; b.vx = dx * sp; b.vy = dy * sp; b.vz = dz * sp; b.life = 6; b.an = Math.random() * 6;
}
function bossCall(k, n, x, y, z) { // summons n minions of type k near (x, y, z)
  let alive = 0; for (const f of foes) alive += f.on;
  for (let j = 0; j < n && alive < ALIVE; j++) {
    const f = foes.find((o) => !o.on); if (!f) break;
    const px = x + R_(-2, 2), py = y + R_(-1, 1), pz = z + R_(-2, 2); if (rockAt(px, py, pz) > -0.99) continue;
    initFoe(f, k, px, py, pz); alive++;
  }
}
function bossKnock(px, py, pz, dmg, push) { // hurt and push you away from (px, py, pz)
  const B = boss; hurt(dmg); B.hitT = 0.9;
  let x = F[CX] - px, y = F[CY] - py, z = F[CZ] - pz; const l = hypot(x, y, z) || 1;
  F[VX] += x / l * push; F[VY] += y / l * push; F[VZ] += z / l * push;
}
function bossReward(pts, xp, txt) {
  const p = Math.round(pts * mult * DF.sc); score += p; popup(`+${p}`, true); gainXp(xp); if (txt) banner(txt);
}

// ---------------------------------------------------------------- boss 2: キューブクラーケン
// boxes: 0 mantle, 1 eye, 2 + t * KJ + j tentacle t segment j. Tentacle states (ks): 0 idle (hangs and sways),
// 1 windup (rises, glows), 2 strike (whips to where you were when it started), 3 recover. A tentacle is a quadratic
// Bezier from its base under the mantle to its end point; the boxes sit between the curve points.
const KB = new Float64Array((KJ + 1) * 3);
function krakPose() {
  const B = boss; B.nb = 2 + KT * KJ;
  qlook(B.yw, B.pt * 0.4, 0.08 * sin(B.an * 0.9)); GBQ[0] = QB[0]; GBQ[1] = QB[1]; GBQ[2] = QB[2]; GBQ[3] = QB[3];
  setBox(0, B.x, B.y, B.z, KS);
  brot(0, 0.25 * KS, -1.02 * KS); setBox(1, B.x + V3[0], B.y + V3[1], B.z + V3[2], 0.8);
  const q0 = QB[0], q1 = QB[1], q2 = QB[2], q3 = QB[3];
  for (let t = 0; t < KT; t++) {
    GBQ[0] = q0; GBQ[1] = q1; GBQ[2] = q2; GBQ[3] = q3;
    const a = t * TAU / KT + PI / KT;
    brot(cos(a) * KS * 0.75, -KS, sin(a) * KS * 0.75); const bx = B.x + V3[0], by = B.y + V3[1], bz = B.z + V3[2];
    brot(cos(a), 0, sin(a)); const ox = V3[0], oz = V3[2];
    const sw = B.an * 1.3 + t * 1.7, st = B.ks[t], p = st ? clamp(1 - B.kT[t] / KDUR[st], 0, 1) : 0, e = p * p * (3 - 2 * p);
    const ix = bx + ox * 6 + 1.6 * sin(sw), iy = by - 6.5 + 1.2 * cos(sw * 0.8), iz = bz + oz * 6 + 1.6 * cos(sw * 1.1); // idle end
    const rx = bx + ox * 3, ry = by + 7, rz = bz + oz * 3; // raised for the windup
    let ex = ix, ey = iy, ez = iz;
    if (st === 1) { ex = ix + (rx - ix) * e; ey = iy + (ry - iy) * e; ez = iz + (rz - iz) * e; }
    else if (st === 2) { const f = sqrt(p); ex = rx + (B.kx[t] - rx) * f; ey = ry + (B.ky[t] - ry) * f; ez = rz + (B.kz[t] - rz) * f; }
    else if (st === 3) { ex = B.kx[t] + (ix - B.kx[t]) * e; ey = B.ky[t] + (iy - B.ky[t]) * e; ez = B.kz[t] + (iz - B.kz[t]) * e; }
    const qx = bx + ox * 3 + (ex - bx) * 0.3, qy = by - 1 + (ey - by) * 0.3, qz = bz + oz * 3 + (ez - bz) * 0.3;
    KB[0] = bx; KB[1] = by; KB[2] = bz;
    for (let j = 1; j <= KJ; j++) {
      const u = j / KJ, a0 = (1 - u) * (1 - u), a1 = 2 * (1 - u) * u, a2 = u * u, w = 0.5 * u * sin(B.an * 2.2 - j * 0.9 + t) * (st ? 0.3 : 1);
      KB[j * 3] = a0 * bx + a1 * qx + a2 * ex + w; KB[j * 3 + 1] = a0 * by + a1 * qy + a2 * ey; KB[j * 3 + 2] = a0 * bz + a1 * qz + a2 * ez + w * 0.7;
    }
    const alive = B.thp[t] > 0;
    for (let j = 1; j <= KJ; j++) {
      const o = j * 3, px = KB[o - 3], py = KB[o - 2], pz = KB[o - 1], x = KB[o], y = KB[o + 1], z = KB[o + 2];
      const dx = x - px, dy = y - py, dz = z - pz, l = hypot(dx, dy, dz) || 1, i = 1 + t * KJ + j;
      qlook(atan2(dx / l, -dz / l), atan2(dy / l, hypot(dx, dz) / l), 0);
      setBox(i, (px + x) / 2, (py + y) / 2, (pz + z) / 2, alive ? 0.62 * (1 - 0.55 * (j - 1) / KJ) : 0); BPL[i] = l / 2;
    }
  }
}
function krakStep(dt, cx, cy, cz) {
  const B = boss;
  for (let t = 0; t < KT; t++) B.tfl[t] = max(0, B.tfl[t] - dt * 8);
  if (B.st === 4) { // dying: tentacles come off one by one, then the mantle bursts
    if ((B.dT -= dt) <= 0) { let t = -1; for (let k = 0; k < KT; k++) if (B.thp[k] > 0) { t = k; break; } if (t < 0) { bossDie(); return; } B.dT = 0.22; krakBreak(t, false); }
    krakPose(); return;
  }
  const rage = B.ph2 ? 1.3 : 1;
  bossDrift(dt, cx, cy, cz, 17 + 2 * sin(B.an * 0.4), B.st === 0 ? 0.8 : 3.2 * rage, 3 + 2 * sin(B.an * 0.6));
  bossFace(dt, cx, cy, cz, 2);
  // tentacle states; the windup keeps aiming at you, the strike then goes there (up to 20 m from the mantle)
  B.warn = 0;
  for (let t = 0; t < KT; t++) if (B.ks[t]) {
    if (B.ks[t] === 1) {
      let x = cx - B.x, y = cy - B.y, z = cz - B.z; const l = hypot(x, y, z) || 1, m = min(1, 20 / l);
      B.kx[t] = B.x + x * m; B.ky[t] = B.y + y * m; B.kz[t] = B.z + z * m; B.warn = 1;
    }
    if ((B.kT[t] -= dt) <= 0) { const s = B.ks[t]; B.ks[t] = s === 3 ? 0 : s + 1; B.kT[t] = KDUR[B.ks[t]]; if (s === 1) sfx('dash'); }
  }
  krakPose();
  if (B.st === 0) return;
  let dx = cx - B.x, dy = cy - B.y, dz = cz - B.z; const d = hypot(dx, dy, dz) || 1; dx /= d; dy /= d; dz /= d;
  // slam: the free tentacle whose tip is nearest to you
  if ((B.cd -= dt) <= 0) {
    B.cd = (B.ph2 ? 2.1 : 3.3) * (0.7 + 0.3 * DF.cd);
    let bt = -1, bd = 1e9;
    for (let t = 0; t < KT; t++) if (B.thp[t] > 0 && !B.ks[t]) { const i = 1 + t * KJ + KJ, e = hypot(cx - BPX[i], cy - BPY[i], cz - BPZ[i]); if (e < bd) { bd = e; bt = t; } }
    if (bt >= 0 && d < 28) { B.ks[bt] = 1; B.kT[bt] = KDUR[1]; B.khit[bt] = 0; sfx('charge'); }
  }
  // ink: a fan of bolts from the eye
  if ((B.spT -= dt) <= 0) {
    B.spT = (B.ph2 ? 3.6 : 5.2) * DF.cd;
    if (d < 70 && rayRock(BPX[1], BPY[1], BPZ[1], dx, dy, dz, d) < 0) {
      const m = B.ph2 ? 9 : 7;
      for (let j = 0; j < m; j++) { const a = (j - (m - 1) / 2) * 0.16, ca = cos(a), sa = sin(a); bossBolt(BPX[1] + dx * 1.5, BPY[1] + dy * 1.5, BPZ[1] + dz * 1.5, dx * ca - dz * sa, dy + R_(-0.06, 0.06), dx * sa + dz * ca, BOLTSP); }
      sfx('spit');
    }
  }
  if (B.ph2 && (B.sumT -= dt) <= 0) { B.sumT = 9; bossCall(1, 2, B.x, B.y + KS, B.z); }
  // a striking tentacle hurts once; touching the mantle hurts too
  for (let t = 0; t < KT; t++) if (B.ks[t] === 2 && !B.khit[t] && B.kT[t] < KDUR[2] * 0.65)
    for (let j = 0; j < KJ; j++) { const i = 2 + t * KJ + j; if (hypot(cx - BPX[i], cy - BPY[i], cz - BPZ[i]) < BPS[i] + 1.2) { B.khit[t] = 1; bossKnock(BPX[i], BPY[i], BPZ[i], 20, 15); break; } }
  if ((B.hitT -= dt) <= 0 && d < KS * 1.4 + 1) bossKnock(B.x, B.y, B.z, 16, 16);
}
function krakHit(i, pd) {
  const B = boss;
  if (i === 1) { weakHit(pd); return; }
  if (i === 0) { // the mantle is armoured while any tentacle is left
    let n = 0; for (let t = 0; t < KT; t++) n += B.thp[t] > 0;
    B.hp -= n ? pd * 0.35 : pd; B.fl = 1;
    if (n && gtime > B.critT) { B.critT = gtime + 1.2; popup('ARMOR'); }
    if (!hitSnd++) sfx('hit'); return;
  }
  const t = (i - 2) / KJ | 0; if (B.thp[t] <= 0) return;
  B.hp -= pd; B.tfl[t] = 1; B.thp[t] -= pd;
  if (B.thp[t] <= 0) krakBreak(t, true); else if (!hitSnd++) sfx('hit');
}
function krakBreak(t, scored) {
  const B = boss, i = 2 + t * KJ + (KJ >> 1);
  CAPO.x = BPX[i]; CAPO.y = BPY[i]; CAPO.z = BPZ[i]; CAPO.vx = B.vx * 0.3; CAPO.vy = B.vy * 0.3; CAPO.vz = B.vz * 0.3;
  cap = CAPO; capV = 8; pIdx = 0; krakDraw(t); cap = null;
  B.thp[t] = 0; B.ks[t] = 0; for (let j = 0; j < KJ; j++) BPS[2 + t * KJ + j] = 0;
  burst(BPX[i], BPY[i], BPZ[i], 10, 1, 9, 1, 0.55, 0.2); sfx('segbreak');
  if (scored) { B.hp -= B.mh * 0.04; bossReward(400, 15, '触手破壊！'); }
}
// only: -2 everything alive, -1 the body, t >= 0 tentacle t alone (used when it breaks off)
function krakDraw(only) {
  const B = boss, G = B.ph2 ? [1, 0.25, 0.12] : [1, 0.6, 0.22], fl = B.fl, a = B.an;
  if (only < 0) {
    useBox(0);
    bpart(0, 0, 0, KS, KS * 1.05, KS, 0, 0, 0, 1, fl, 0.42, 0.1, 0.16, 1.1); // mantle
    bpart(0, KS * 1.4, KS * 0.2, KS * 0.72, KS * 0.5, KS * 0.72, sin(0.1), 0, 0, cos(0.1), fl, 0.48, 0.12, 0.2, 1.2); // dome
    bpart(0, KS * 2.05, KS * 0.45, KS * 0.36, KS * 0.32, KS * 0.36, sin(0.2), 0, 0, cos(0.2), fl, 0.52, 0.14, 0.22, 1.3);
    for (const sd of [-1, 1]) {
      const w = (0.35 * sin(a * 2.4) + 0.2) * sd; // fins
      bpart(sd * KS * 1.2, KS * 1.6, KS * 0.4, KS * 0.55, 0.12 * KS, KS * 0.45, 0, 0, sin(w / 2), cos(w / 2), fl, G[0] * 0.7, G[1] * 0.5, G[2] * 0.6, 2.4);
      for (let k = 0; k < 3; k++) bpart(sd * KS * 1.01, KS * (0.5 - k * 0.45), KS * (-0.4 + k * 0.4), 0.04, 0.16, 0.16, 0, 0, 0, 1, fl, G[0], G[1], G[2], 4 + 2 * sin(a * 3 + k)); // photophores
    }
    const ey = B.warn ? 10 : 5 + sin(a * 4); // the eye (weak point), slit pupil, brow
    bpart(0, 0.25 * KS, -1.02 * KS, 0.8, 0.62, 0.1, 0, 0, 0, 1, fl, 1, 0.85, 0.45, ey);
    bpart(0, 0.25 * KS, -1.07 * KS, 0.14, 0.5, 0.05, 0, 0, 0, 1, 0, 0.05, 0.02, 0.04, 0.2);
    bpart(0, 0.25 * KS + 0.75, -1.03 * KS, 0.95, 0.08, 0.08, 0, 0, 0, 1, fl, G[0], G[1], G[2], 4);
    bpart(0, -KS * 1.05, -KS * 0.15, 0.45, 0.4, 0.45, 0, S8, 0, C8, fl, 0.15, 0.08, 0.06, 1); // beak
  }
  if (only === -1) return;
  for (let t = 0; t < KT; t++) {
    if (only >= 0 ? t !== only : B.thp[t] <= 0) continue;
    const wind = B.ks[t] === 1 || B.ks[t] === 2, tf = B.tfl[t];
    for (let j = 0; j < KJ; j++) {
      const i = 2 + t * KJ + j, s = BPS[i]; if (s <= 0) continue;
      useBox(i); const c = j % 2 ? 0.46 : 0.38;
      bpart(0, 0, 0, s, s, BPL[i] * 1.05, 0, 0, 0, 1, tf, wind ? 0.9 : c, wind ? 0.2 : c * 0.24, wind ? 0.15 : c * 0.36, wind ? 4 : 1.2);
      bpart(0, -s * 0.95, 0, s * 0.45, 0.05, s * 0.45, 0, 0, 0, 1, tf, G[0], G[1], G[2], wind ? 8 : 3.5); // suckers
    }
  }
}

// ---------------------------------------------------------------- boss 3: 巨大キューブクラゲ
// boxes: 0 bell, 1 core (weak point, hangs under the bell), 2.. brood sacs on the rim. st 2 = charging a pulse.
function jellyPose() {
  const B = boss; B.nb = 2 + JSAC;
  qlook(B.yw, 0.12 * sin(B.an * 0.7), 0.12 * sin(B.an * 0.5)); GBQ[0] = QB[0]; GBQ[1] = QB[1]; GBQ[2] = QB[2]; GBQ[3] = QB[3];
  brot(0, 0.3 * JS, 0); setBox(0, B.x + V3[0], B.y + V3[1], B.z + V3[2], JS * 0.78);
  brot(0, -0.98 * JS, 0); setBox(1, B.x + V3[0], B.y + V3[1], B.z + V3[2], 0.95);
  for (let k = 0; k < JSAC; k++) {
    const a = k * TAU / JSAC + PI / 4; brot(cos(a) * JS * 1.08, -0.15 * JS, sin(a) * JS * 1.08);
    setBox(2 + k, B.x + V3[0], B.y + V3[1], B.z + V3[2], B.thp[k] > 0 ? 0.8 : 0);
  }
}
function jellyStep(dt, cx, cy, cz) {
  const B = boss;
  for (let k = 0; k < JSAC; k++) B.tfl[k] = max(0, B.tfl[k] - dt * 6);
  if (B.st === 4) { // dying: the sacs pop, then the bell
    if ((B.dT -= dt) <= 0) { let k = -1; for (let j = 0; j < JSAC; j++) if (B.thp[j] > 0) { k = j; break; } if (k < 0) { bossDie(); return; } B.dT = 0.3; jellyBreak(k, false); }
    jellyPose(); return;
  }
  const rage = B.ph2 ? 1.3 : 1, pu = max(0, sin(B.an * 2.2));
  bossDrift(dt, cx, cy, cz, 21 + 3 * sin(B.an * 0.3), (B.st === 0 ? 0.6 : 1.6 + 2.6 * pu) * rage, 6 + 3 * sin(B.an * 0.5));
  B.yw += dt * 0.25;
  jellyPose();
  if (B.st === 0) return;
  let dx = cx - BPX[1], dy = cy - BPY[1], dz = cz - BPZ[1]; const d = hypot(dx, dy, dz) || 1; dx /= d; dy /= d; dz /= d;
  if ((B.sumT -= dt) <= 0) { // brood: sacs bud small jellies
    B.sumT = B.ph2 ? 4 : 6.5; let n = 0;
    for (let k = 0; k < JSAC && n < 2; k++) if (B.thp[k] > 0 && Math.random() < 0.7) { bossCall(0, 1, BPX[2 + k], BPY[2 + k] - 1.2, BPZ[2 + k]); B.tfl[k] = 1; n++; }
    if (n) sfx('bud');
  }
  if (B.st === 1 && (B.cd -= dt) <= 0) { B.st = 2; B.stT = 1.3; sfx('charge'); }
  else if (B.st === 2 && (B.stT -= dt) <= 0) { // pulse: rings of bolts round the core, plus three at you
    B.st = 1; B.cd = (B.ph2 ? 4.6 : 6.5) * DF.cd;
    const x = BPX[1], y = BPY[1], z = BPZ[1];
    for (const e of B.ph2 ? [0.28, -0.28] : [0]) for (let k = 0; k < 14; k++) { const a = k * TAU / 14 + B.an; bossBolt(x, y, z, cos(a) * cos(e), sin(e), sin(a) * cos(e), BOLTSP * 0.8); }
    if (d < 70) for (let k = -1; k <= 1; k++) { const ca = cos(k * 0.1), sa = sin(k * 0.1); bossBolt(x, y, z, dx * ca - dz * sa, dy, dx * sa + dz * ca, BOLTSP); }
    burst(x, y, z, 14, 1.5, 10, 0.6, 0.85, 1); sfx('zap');
  }
  // stings: the bell, and the tentacles hanging under it
  if ((B.hitT -= dt) <= 0) {
    const hx = cx - B.x, hz = cz - B.z, hr = hypot(hx, hz), hy = cy - B.y;
    if (hypot(hx, hy - 0.3 * JS, hz) < JS + 1.2) bossKnock(B.x, B.y, B.z, 14, 15);
    else if (hr < JS * 0.95 && hy < -2 && hy > -JTJ * 1.2 - 2) { bossKnock(B.x, cy, B.z, 10, 12); sfx('zap'); }
  }
}
function jellyHit(i, pd) {
  const B = boss;
  if (i === 1) { weakHit(pd); return; }
  if (i === 0) { B.hp -= pd * 0.6; B.fl = 1; if (!hitSnd++) sfx('hit'); return; }
  const k = i - 2; if (B.thp[k] <= 0) return;
  B.hp -= pd; B.tfl[k] = 1; B.thp[k] -= pd;
  if (B.thp[k] <= 0) jellyBreak(k, true); else if (!hitSnd++) sfx('hit');
}
function jellyBreak(k, scored) {
  const B = boss, i = 2 + k;
  CAPO.x = BPX[i]; CAPO.y = BPY[i]; CAPO.z = BPZ[i]; CAPO.vx = B.vx * 0.3; CAPO.vy = B.vy * 0.3; CAPO.vz = B.vz * 0.3;
  cap = CAPO; capV = 7; pIdx = 0; jellyDraw(k); cap = null;
  B.thp[k] = 0; BPS[i] = 0;
  burst(BPX[i], BPY[i], BPZ[i], 12, 1, 8, 0.75, 1, 0.35); sfx('segbreak');
  if (scored) { B.hp -= B.mh * 0.05; bossReward(400, 15, '卵嚢破壊！'); }
}
// only: -2 everything alive, -1 the body, k >= 0 brood sac k alone
function jellyDraw(only) {
  const B = boss, a = B.an, pu = sin(a * 2.2), G = B.ph2 ? [0.45, 0.85, 1] : [1, 0.45, 0.9], fl = B.fl, chg = B.st === 2 ? clamp(1 - B.stT / 1.3, 0, 1) : 0;
  const w = JS * (1 + 0.08 * pu), h = JS * (0.5 - 0.05 * pu);
  if (only < 0) {
    GP0[0] = B.x; GP0[1] = B.y; GP0[2] = B.z; GBQ[0] = BPQ[0]; GBQ[1] = BPQ[1]; GBQ[2] = BPQ[2]; GBQ[3] = BPQ[3];
    bpart(0, 0.45 * JS, 0, w, h, w, 0, 0, 0, 1, fl, 0.42, 0.22, 0.6, 1.3 + 4 * chg); // bell
    bpart(0, 0.45 * JS + h * 1.3, 0, w * 0.6, h * 0.45, w * 0.6, 0, 0, 0, 1, fl, 0.5, 0.28, 0.68, 1.5 + 3 * chg); // crown
    bpart(0, 0.45 * JS - h, 0, w * 1.06, 0.1 * JS, w * 1.06, 0, 0, 0, 1, fl, G[0], G[1], G[2], 4 + 4 * chg); // rim
    for (let k = 0; k < 4; k++) { const b = k * PI / 2; bpart(cos(b) * 0.42 * JS, 0.5 * JS, sin(b) * 0.42 * JS, 0.5, 0.25, 0.5, 0, sin(b / 2), 0, cos(b / 2), fl, G[0], G[1], G[2], 5 + 3 * chg); } // glow under the dome
    const cs = sin(a * 1.7) * 0.5;
    bpart(0, -0.55 * JS, 0, 0.3, 0.25 * JS, 0.3, 0, 0, 0, 1, fl, 0.6, 0.35, 0.7, 2); // stalk
    bpart(0, -0.98 * JS, 0, 0.95, 0.95, 0.95, 0, sin(cs), 0, cos(cs), fl, 1, 0.85, 0.95, 7 + 3 * sin(a * 5) + 8 * chg); // core (weak point)
    for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) { // frilly oral arms
      const b = k * PI / 2 + PI / 4 + 0.25 * sin(a * 1.4 + j * 0.8 + k), r = 0.5 + 0.12 * j;
      bpart(cos(b) * r, -1.2 * JS - j * 1.0, sin(b) * r, 0.32, 0.5, 0.1, 0, sin(-b / 2 + PI / 4), 0, cos(-b / 2 + PI / 4), fl, G[0] * 0.8, G[1] * 0.6, G[2] * 0.85, 2.5);
    }
  }
  if (only === -1) return;
  for (let k = 0; k < JSAC; k++) { // brood sacs: glowing green cubes that swell before they bud
    if (only >= 0 ? k !== only : B.thp[k] <= 0) continue;
    useBox(2 + k); const sw = 0.8 * (1 + 0.15 * sin(a * 3 + k) + 0.25 * B.tfl[k]), sp = a * 1.5 + k;
    bpart(0, 0, 0, sw, sw, sw, 0, sin(sp / 2), 0, cos(sp / 2), B.tfl[k] * 0.5, 0.75, 1, 0.35, 4 + 2 * sin(a * 4 + k));
    bpart(0, sw + 0.15, 0, 0.25, 0.2, 0.25, 0, 0, 0, 1, 0, 1, 1, 0.8, 8);
  }
  if (only !== -2) return;
  for (let t = 0; t < JTN; t++) { // tentacles: hang from the rim, sway, trail behind as it swims
    const b = t * TAU / JTN + B.yw;
    let px = B.x + cos(b) * JS * 0.92, py = B.y + 0.45 * JS - h, pz = B.z + sin(b) * JS * 0.92;
    for (let j = 1; j <= JTJ; j++) {
      const sw = 0.18 * j * sin(a * 1.6 - j * 0.5 + t * 1.3);
      const x = B.x + cos(b) * JS * (0.92 - 0.03 * j) + sw * cos(b + 1.5) - B.vx * j * 0.1;
      const y = B.y + 0.45 * JS - h - 1.2 * j - B.vy * j * 0.05;
      const z = B.z + sin(b) * JS * (0.92 - 0.03 * j) + sw * sin(b + 1.5) - B.vz * j * 0.1;
      const dx = x - px, dy = y - py, dz = z - pz, l = hypot(dx, dy, dz) || 1;
      qlook(atan2(dx / l, -dz / l), atan2(dy / l, hypot(dx, dz) / l), 0);
      GP0[0] = (px + x) / 2; GP0[1] = (py + y) / 2; GP0[2] = (pz + z) / 2; GBQ[0] = QB[0]; GBQ[1] = QB[1]; GBQ[2] = QB[2]; GBQ[3] = QB[3];
      const tip = j === JTJ;
      bpart(0, 0, 0, 0.13, 0.13, l * 0.52, 0, 0, 0, 1, 0, tip ? 1 : G[0] * 0.7, tip ? 1 : G[1] * 0.6, tip ? 1 : G[2] * 0.8, tip ? 9 : 2.4 + 2 * chg);
      px = x; py = y; pz = z;
    }
  }
}

// ---------------------------------------------------------------- codex (図鑑): rares, evolutions and the boss you have found
let DEX = {}; try { DEX = JSON.parse(localStorage.cubeAbyssDex || '{}') || {}; } catch { DEX = {}; }
function dexAdd(id) { DEX[id] = (DEX[id] || 0) + 1; keep('cubeAbyssDex', JSON.stringify(DEX)); }
function dexRender() {
  const L = UPS.filter((u) => u[5]), n = L.filter((u) => DEX[u[0]]).length + BOSSK.filter((k) => DEX[k]).length;
  $('dxn').textContent = `発見 ${n} / ${L.length + BOSSK.length}`;
  const cell = (cls, tag, name, desc, foot) => { const e = document.createElement('div'); e.className = 'de ' + cls; e.innerHTML = `<em>${tag}</em><strong>${name}</strong><span>${desc}</span>${foot ? `<small>${foot}</small>` : ''}`; return e; };
  $('dxl').replaceChildren(
    ...L.map((u) => {
      const got = DEX[u[0]], ev = u[5] === 'e', tag = ev ? 'EVOLUTION' : 'RARE';
      if (got) return cell(ev ? 'evo' : 'rare', tag, u[1], udesc(u), ev ? u[7] : '');
      return cell('no', tag, '？？？', ev ? `${u[7].split(' ＋ ')[0]} ＋ ？？？ で宝箱を開けると…` : 'レベルアップか宝箱で出会えるかも', '');
    }),
    ...BOSSK.map((k, i) => DEX[k] ? cell('boss', 'BOSS', BOSSN[i], `撃破 ${DEX[k]} 回`, `WAVE ${BOSSW * (i + 1)}, ${BOSSW * (i + 4)}, … に出現`)
      : cell('no', 'BOSS', '？？？', `WAVE ${BOSSW * (i + 1)} に何かが来る`, '')));
}
$('dxb').addEventListener('click', () => { dexRender(); $('dx').classList.add('on'); });
$('dxc').addEventListener('click', () => $('dx').classList.remove('on'));
for (const b of [$('x'), $('d')]) b.addEventListener('click', () => $('dx').classList.remove('on'));

// ---------------------------------------------------------------- models: enemies and the gun, built from boxes
// quaternions on plain numbers (x, y, z, w); results land in QA / QB, nothing is allocated per frame
const QA = new Float64Array(4), QB = new Float64Array(4), GBQ = new Float64Array(4), GP = new Float64Array(3), GMZ = new Float64Array(3);
function qmul(ax, ay, az, aw, bx, by, bz, bw) { // QA = a * b
  QA[0] = aw * bx + ax * bw + ay * bz - az * by; QA[1] = aw * by - ax * bz + ay * bw + az * bx;
  QA[2] = aw * bz + ax * by - ay * bx + az * bw; QA[3] = aw * bw - ax * bx - ay * by - az * bz;
}
// QB = the camera's convention: local -z looks along (yaw, pitch), x is right, then a roll about the view axis
function qlook(yaw, pit, roll) {
  qmul(0, sin(-yaw / 2), 0, cos(-yaw / 2), sin(pit / 2), 0, 0, cos(pit / 2));
  qmul(QA[0], QA[1], QA[2], QA[3], 0, 0, sin(roll / 2), cos(roll / 2));
  QB[0] = QA[0]; QB[1] = QA[1]; QB[2] = QA[2]; QB[3] = QA[3];
}
// V3 = (x, y, z) rotated by GBQ
function brot(x, y, z) {
  const qx = GBQ[0], qy = GBQ[1], qz = GBQ[2], w = GBQ[3], tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  V3[0] = x + w * tx + qy * tz - qz * ty; V3[1] = y + w * ty + qz * tx - qx * tz; V3[2] = z + w * tz + qx * ty - qy * tx;
}
let cn = 0; // boxes written this frame
function put(x, y, z, sx, sy, sz, fl, q0, q1, q2, q3, r, g, b, gl) {
  if (cap) { // breaking apart: this box becomes debris flying out from the enemy's centre
    const p = debris.find((o) => !o.on); if (!p) return;
    let dx = x - cap.x, dy = y - cap.y, dz = z - cap.z; const l = hypot(dx, dy, dz);
    if (l < 0.05) { dx = R_(-1, 1); dy = R_(-1, 1); dz = R_(-1, 1); } const m = hypot(dx, dy, dz) || 1, v = capV * R_(0.5, 1.2);
    p.on = 1; p.x = x; p.y = y; p.z = z; p.vx = dx / m * v + cap.vx * 0.5; p.vy = dy / m * v + cap.vy * 0.5 + R_(0, 2); p.vz = dz / m * v + cap.vz * 0.5;
    p.sx = sx; p.sy = sy; p.sz = sz; p.q0 = q0; p.q1 = q1; p.q2 = q2; p.q3 = q3; p.r = r; p.g = g; p.b = b; p.gl = max(gl, 2.5);
    const ax = R_(-1, 1), ay = R_(-1, 1), az = R_(-1, 1), al = hypot(ax, ay, az) || 1;
    p.ax = ax / al; p.ay = ay / al; p.az = az / al; p.sp = R_(3, 9); p.an = 0; p.l0 = p.life = R_(0.9, 1.6);
    return;
  }
  if (cn >= CUBEMAX) return; const o = cn++ * 16;
  CUBE[o] = x; CUBE[o + 1] = y; CUBE[o + 2] = z; CUBE[o + 3] = 0;
  CUBE[o + 4] = sx; CUBE[o + 5] = sy; CUBE[o + 6] = sz; CUBE[o + 7] = fl;
  CUBE[o + 8] = q0; CUBE[o + 9] = q1; CUBE[o + 10] = q2; CUBE[o + 11] = q3;
  CUBE[o + 12] = r; CUBE[o + 13] = g; CUBE[o + 14] = b; CUBE[o + 15] = gl;
}
// a box in the frame GBQ anchored at (bx, by, bz): local centre, half size, local rotation (quaternion)
function part(bx, by, bz, lx, ly, lz, sx, sy, sz, qx, qy, qz, qw, fl, r, g, b, gl) {
  brot(lx, ly, lz); const px = V3[0], py = V3[1], pz = V3[2];
  qmul(GBQ[0], GBQ[1], GBQ[2], GBQ[3], qx, qy, qz, qw);
  put(bx + px, by + py, bz + pz, sx, sy, sz, fl, QA[0], QA[1], QA[2], QA[3], r, g, b, gl);
}
const S8 = sin(PI / 8), C8 = cos(PI / 8); // 45° about one axis

// ---------------------------------------------------------------- enemy looks: deep-sea creatures built from boxes
// The hit box is still one box of half size s with rotation q (see shoot); these are only looks. Local -z is front.
//   0 キューブクラゲ (jellyfish): a pulsing bell, a glowing core, 4 tentacles that hang and trail
//   1 キューブカマス (barracuda): a head with jaws and eyes, a body of segments that follows it, a tail fin
//   2 キューブガメ (turtle): a glowing body under 8 shell plates (one breaks off per 1/8 HP), head, paddling flippers
//   3 キューブアンコウ (anglerfish): a big jaw with teeth, a lure on a stalk that flares up before it spits
// Tentacles and segments follow the trail in f.tr (follow-the-leader, fixed spacing).

// trail: point 0 is the anchor (bell bottom / tail root), each next point keeps `sp` metres from the one before;
// jelly tentacles also sink a little so they hang when the jelly is still
function foeTrail(f) {
  const s = FT[f.k].s, T = f.tr;
  if (f.k === 0) { T[0] = f.x; T[1] = f.y - 0.35 * s; T[2] = f.z; }
  else { qlook(f.yw, f.pt, 0); GBQ[0] = QB[0]; GBQ[1] = QB[1]; GBQ[2] = QB[2]; GBQ[3] = QB[3]; brot(0, 0, (f.k === 1 ? 1.1 : 0.9) * s); T[0] = f.x + V3[0]; T[1] = f.y + V3[1]; T[2] = f.z + V3[2]; }
  const sp = f.k === 0 ? 0.42 * s : f.k === 1 ? 0.95 * s : 0.6 * s, sink = f.k === 0 ? 0.5 : 0;
  for (let j = 1; j < TRN; j++) {
    const o = j * 3; let dx = T[o] - T[o - 3], dy = T[o + 1] - T[o - 2] - sink * sp, dz = T[o + 2] - T[o - 1];
    const l = hypot(dx, dy, dz) || 1; T[o] = T[o - 3] + dx / l * sp; T[o + 1] = T[o - 2] + dy / l * sp; T[o + 2] = T[o - 1] + dz / l * sp;
  }
}
// capture: while set, put() turns boxes into flying debris instead of drawing them
let cap = null, capV = 0;
function shatter(f, v) { cap = f; capV = v; drawFoe(f, 0); cap = null; }
// one shell plate breaks off (index i of the 8 in drawTurtle)
function plateOff(f, i) {
  const s = FT[2].s; GBQ[0] = f.q0; GBQ[1] = f.q1; GBQ[2] = f.q2; GBQ[3] = f.q3;
  cap = f; capV = 7; turtlePlate(f, i, s, 0); cap = null; sfx('bolt');
}
let pIdx = 0, asmK = 0; // part index within the current enemy, assembly amount (1 = scattered, 0 = built)
function fpart(f, lx, ly, lz, sx, sy, sz, qx, qy, qz, qw, r, g, b, gl) {
  if (asmK > 0) { // scattered, smaller and brighter while the enemy is being assembled
    const h = ++pIdx * 12.9898, k = asmK * 3.5 * FT[f.k].s;
    lx += sin(h) * k; ly += cos(h * 1.37) * k; lz += sin(h * 0.71 + 1) * k;
    const m = 1 - asmK * 0.6; sx *= m; sy *= m; sz *= m; gl += asmK * 6;
  }
  part(f.x, f.y, f.z, lx, ly, lz, sx, sy, sz, qx, qy, qz, qw, f.fl, r, g, b, gl);
}
// a box at a world point (trail segment), rotated to point from (ax..) to (bx..); fl and assembly as fpart
function seg(f, x, y, z, ax, ay, az, sx, sy, sz, roll, r, g, b, gl) {
  const dx = x - ax, dy = y - ay, dz = z - az, l = hypot(dx, dy, dz) || 1;
  qlook(atan2(dx / l, -dz / l), atan2(dy / l, hypot(dx, dz) / l), roll);
  if (asmK > 0) { const h = ++pIdx * 12.9898, k = asmK * 3.5 * FT[f.k].s; x += sin(h) * k; y += cos(h * 1.37) * k; z += sin(h * 0.71 + 1) * k; gl += asmK * 6; const m = 1 - asmK * 0.6; sx *= m; sy *= m; sz *= m; }
  put(x, y, z, sx, sy, sz, f.fl, QB[0], QB[1], QB[2], QB[3], r, g, b, gl);
}

function drawJelly(f, s, a, r, g, b, far) {
  qlook(f.yw, 0.25 * sin(a * 0.9 + f.ph), 0.2 * sin(a * 1.3 + f.ph)); GBQ[0] = QB[0]; GBQ[1] = QB[1]; GBQ[2] = QB[2]; GBQ[3] = QB[3];
  const pu = sin(a * 3.2 + f.ph), w = s * (1 + 0.13 * pu), h = s * (0.5 - 0.07 * pu);
  fpart(f, 0, 0.25 * s, 0, w, h, w, 0, 0, 0, 1, r * 0.55, g * 0.55, b * 0.6, 1.4); // bell
  fpart(f, 0, 0.12 * s, 0, 0.42 * s, 0.32 * s, 0.42 * s, 0, 0, 0, 1, 1, 0.75, 0.6, 7); // glowing core
  if (far) return;
  fpart(f, 0, 0.82 * s - 0.05 * pu * s, 0, 0.55 * w, 0.18 * s, 0.55 * w, 0, 0, 0, 1, r * 0.75, g * 0.75, b * 0.8, 2); // crown
  fpart(f, 0, -0.27 * s, 0, w * 1.08, 0.07 * s, w * 1.08, 0, 0, 0, 1, r, g * 1.4, b * 1.2, 4.5); // rim
  const T = f.tr;
  for (let i = 0; i < 4; i++) { // tentacles: the trail offset to the 4 corners of the rim, swaying
    const o = i * PI / 2 + PI / 4, ox = cos(o + f.yw) * 0.62 * w, oz = sin(o + f.yw) * 0.62 * w;
    let px = T[0] + ox, py = T[1], pz = T[2] + oz;
    for (let j = 1; j <= 6; j++) {
      const k = j * 3, sw = 0.12 * s * j * sin(a * 2.4 - j * 0.8 + i * 1.7), q = 1 - j / 8;
      const x = T[k] + ox * q + sw * cos(o), y = T[k + 1], z = T[k + 2] + oz * q + sw * sin(o), tip = j === 6;
      seg(f, x, y, z, px, py, pz, 0.11 * s * (1.15 - j * 0.12), 0.11 * s * (1.15 - j * 0.12), 0.24 * s, 0, tip ? 1 : r, tip ? 0.85 : g * 1.3, tip ? 0.7 : b, tip ? 8 : 2.6);
      px = x; py = y; pz = z;
    }
  }
}
function drawCuda(f, s, a, r, g, b, far) {
  fpart(f, 0, 0, -0.1 * s, 0.42 * s, 0.48 * s, 0.85 * s, 0, 0, 0, 1, r * 0.6, g * 0.6, b * 0.55, 1.5); // head
  fpart(f, 0, -0.06 * s, -0.95 * s, 0.3 * s, 0.22 * s, 0.25 * s, 0, 0, 0, 1, r * 0.7, g * 0.7, b * 0.6, 1.6); // snout
  if (far) return;
  const jaw = 0.12 + 0.1 * max(0, sin(a * 5 + f.ph));
  fpart(f, 0, -0.42 * s, -0.75 * s, 0.26 * s, 0.07 * s, 0.5 * s, sin(-jaw), 0, 0, cos(-jaw), r * 0.5, g * 0.5, b * 0.45, 1.2); // lower jaw
  for (let i = 0; i < 3; i++) fpart(f, 0, -0.3 * s, -0.55 * s - i * 0.22 * s, 0.22 * s, 0.05 * s, 0.03 * s, 0, 0, 0, 1, 1, 1, 0.95, 3); // teeth
  for (const sd of [-1, 1]) fpart(f, sd * 0.43 * s, 0.17 * s, -0.55 * s, 0.03 * s, 0.11 * s, 0.11 * s, 0, 0, 0, 1, 1, 0.3, 0.15, 9); // eyes
  const T = f.tr; let px = T[0], py = T[1], pz = T[2];
  for (let j = 1; j <= 5; j++) { // body: the segments follow the head
    const k = j * 3, q = 1 - j * 0.13, x = T[k], y = T[k + 1], z = T[k + 2];
    seg(f, px, py, pz, x, y, z, 0.38 * s * q, 0.44 * s * q, 0.55 * s, f.rl * 0.3, j % 2 ? r * 0.55 : r * 0.7, j % 2 ? g * 0.55 : g * 0.7, b * 0.5, j % 2 ? 1.4 : 2.2);
    if (j === 1) { // dorsal fin
      const dx = px - x, dy = py - y, dz = pz - z, l = hypot(dx, dy, dz) || 1;
      seg(f, (px + x) / 2, (py + y) / 2 + 0.55 * s, (pz + z) / 2, (px + x) / 2 + dx / l, (py + y) / 2 + 0.55 * s + dy / l, (pz + z) / 2 + dz / l, 0.04 * s, 0.32 * s, 0.4 * s, 0, r, g, b, 3.5);
    }
    px = x; py = y; pz = z;
  }
  const k = 18, dx = T[k - 3] - T[k], dy = T[k - 2] - T[k + 1], dz = T[k - 1] - T[k + 2], l = hypot(dx, dy, dz) || 1, fl2 = sin(a * 9 + f.ph) * 0.5; // tail fin
  seg(f, T[k] - dx / l * 0.4 * s, T[k + 1] - dy / l * 0.4 * s, T[k + 2] - dz / l * 0.4 * s, T[k], T[k + 1], T[k + 2], 0.04 * s, 0.75 * s, 0.4 * s, fl2 * 0.4, r, g * 1.1, b, 4);
}
// turtle shell plate i (0-7) in the frame GBQ; o = 1 while drawing, 0 when breaking off (capture)
function turtlePlate(f, i, s, o) {
  const P = [ // centre x y z, half size x y z: top 4, sides 2, back, front rim
    [-0.5, 0.95, -0.45, 0.48, 0.14, 0.43], [0.5, 0.95, -0.45, 0.48, 0.14, 0.43], [-0.5, 0.95, 0.45, 0.48, 0.14, 0.43], [0.5, 0.95, 0.45, 0.48, 0.14, 0.43],
    [-1.02, 0.25, 0, 0.13, 0.62, 0.95], [1.02, 0.25, 0, 0.13, 0.62, 0.95], [0, 0.3, 1.02, 0.88, 0.6, 0.13], [0, 0.72, -0.98, 0.9, 0.18, 0.12]];
  const p = P[i], c = i % 2 ? 0.48 : 0.4;
  fpart(f, p[0] * s, p[1] * s, p[2] * s, p[3] * s, p[4] * s, p[5] * s, 0, 0, 0, 1, FT[2].r * c, FT[2].g * c, FT[2].b * c, 1.6);
}
function drawTurtle(f, s, a, r, g, b, far) {
  const hurt = 1 - f.hp / f.mh, beat = 2.2 + 2.5 * hurt + 1.2 * sin(a * (3 + 5 * hurt));
  fpart(f, 0, 0, 0, 0.85 * s, 0.7 * s, 0.85 * s, 0, 0, 0, 1, r * 0.75, g * 0.6, b * 0.8, beat); // body (glows more as it breaks)
  if (far) { fpart(f, 0, 0.7 * s, 0, s, 0.3 * s, s, 0, 0, 0, 1, r * 0.4, g * 0.4, b * 0.4, 1.6); return; }
  for (let i = 0; i < f.pl; i++) turtlePlate(f, i, s, 1);
  fpart(f, 0, 0.05 * s, -1.15 * s, 0.38 * s, 0.32 * s, 0.38 * s, 0, 0, 0, 1, r * 0.6, g * 0.5, b * 0.7, 1.6); // head
  for (const sd of [-1, 1]) fpart(f, sd * 0.2 * s, 0.15 * s, -1.53 * s, 0.07 * s, 0.07 * s, 0.03 * s, 0, 0, 0, 1, 1, 0.9, 1, 9); // eyes
  for (let i = 0; i < 4; i++) { // flippers: front pair paddle, back pair trail
    const sd = i % 2 ? 1 : -1, fr = i < 2, ang = (fr ? 0.6 : 0.25) * sin(a * 2.6 + (fr ? 0 : 1.2)) * sd;
    fpart(f, sd * 1.05 * s, -0.35 * s, (fr ? -0.55 : 0.65) * s, (fr ? 0.6 : 0.38) * s, 0.07 * s, (fr ? 0.26 : 0.22) * s, 0, 0, sin(ang / 2), cos(ang / 2), r * 0.55, g * 0.45, b * 0.65, 1.8);
  }
}
function drawAngler(f, s, a, r, g, b, far) {
  const ch = f.los && f.cd < 0.8 ? 1 - max(0, f.cd) / 0.8 : 0, lg = 5 + 9 * ch + 1.5 * sin(a * 6);
  fpart(f, 0, 0.05 * s, 0.1 * s, 0.82 * s, 0.7 * s, 0.85 * s, 0, 0, 0, 1, r * 0.35, g * 0.4, b * 0.4, 1.3); // body
  if (far) { fpart(f, 0, 1.3 * s, -0.9 * s, 0.17 * s, 0.17 * s, 0.17 * s, 0, 0, 0, 1, 1, 0.8, 0.35, lg); return; }
  const op = 0.15 + 0.25 * ch + 0.06 * sin(a * 2);
  fpart(f, 0, -0.55 * s, -0.55 * s, 0.86 * s, 0.16 * s, 0.6 * s, sin(op / 2), 0, 0, cos(op / 2), r * 0.3, g * 0.35, b * 0.35, 1.2); // jaw
  for (let i = 0; i < 5; i++) { const tx = (i - 2) * 0.32 * s; // teeth, top and bottom
    fpart(f, tx, -0.3 * s, -0.9 * s, 0.05 * s, 0.13 * s, 0.03 * s, 0, 0, 0, 1, 1, 1, 0.9, 3);
    fpart(f, tx + 0.16 * s, -0.5 * s, -1.0 * s - 0.25 * op * s, 0.05 * s, 0.12 * s, 0.03 * s, 0, 0, 0, 1, 1, 1, 0.9, 3); }
  fpart(f, 0, -0.28 * s, -0.92 * s, 0.7 * s, 0.12 * s, 0.03 * s, 0, 0, 0, 1, 1, 0.45 + 0.3 * ch, 0.15, 2 + 6 * ch); // throat glow
  for (const sd of [-1, 1]) fpart(f, sd * 0.5 * s, 0.45 * s, -0.72 * s, 0.1 * s, 0.1 * s, 0.05 * s, 0, 0, 0, 1, 0.9, 1, 0.9, 6); // eyes
  for (let i = 0; i < 3; i++) { // lure stalk: arcs up and forward
    const t = (i + 0.5) / 3, sw = 0.12 * s * sin(a * 2 + i);
    fpart(f, sw, 0.75 * s + t * 0.55 * s, -0.25 * s - t * t * 0.65 * s, 0.05 * s, 0.17 * s, 0.05 * s, sin(-0.5 * t), 0, 0, cos(-0.5 * t), r * 0.5, g * 0.5, b * 0.5, 1.5);
  }
  const ls = (0.15 + 0.08 * ch) * s; // lure: amber, white-hot right before it spits
  fpart(f, 0.12 * s * sin(a * 2 + 3), 1.3 * s, -0.9 * s, ls, ls, ls, S8, 0, 0, C8, 1, 0.75 + 0.25 * ch, 0.3 + 0.6 * ch, lg);
  const tf = 0.4 * sin(a * 4 + f.ph); // tail and side fins
  fpart(f, 0, 0.05 * s, 1.15 * s, 0.05 * s, 0.55 * s, 0.32 * s, 0, sin(tf / 2), 0, cos(tf / 2), r * 0.8, g * 0.8, b * 0.8, 3);
  for (const sd of [-1, 1]) { const fa = 0.4 * sin(a * 5 + sd) * sd;
    fpart(f, sd * 0.95 * s, -0.05 * s, 0.15 * s, 0.25 * s, 0.04 * s, 0.22 * s, 0, 0, sin(fa / 2), cos(fa / 2), r * 0.8, g * 0.8, b * 0.8, 2.5); }
}
// d: distance from the camera (beyond LODD only a couple of boxes); the hit box frame is GBQ = q
function drawFoe(f, d) {
  const t = FT[f.k], s = t.s, a = f.an, far = d > LODD;
  GBQ[0] = f.q0; GBQ[1] = f.q1; GBQ[2] = f.q2; GBQ[3] = f.q3;
  pIdx = 0; asmK = cap ? 0 : (1 - f.born) * (1 - f.born);
  if (f.k === 0) drawJelly(f, s, a, t.r, t.g, t.b, far);
  else if (f.k === 1) drawCuda(f, s, a, t.r, t.g, t.b, far);
  else if (f.k === 2) drawTurtle(f, s, a, t.r, t.g, t.b, far);
  else drawAngler(f, s, a, t.r, t.g, t.b, far);
  asmK = 0;
}

// the gun: an energy gun in camera space, bottom right; kicks back on each shot, tips over while reloading, bobs
// when you swim. gunPose() leaves its rotation in GBQ, its anchor in GP and the muzzle offset in GMZ.
let gRec = 0, gFlash = 0, gBob = 0;
function gunPose() {
  const rp = reloadT > 0 ? 1 - reloadT / RELOAD : 0, d = sin(rp * PI), sw = min(1, hypot(F[VX], F[VY], F[VZ]) / 7);
  const lx = 0.2 + 0.008 * sin(gBob) * sw, ly = -0.205 - 0.09 * d + 0.007 * abs(cos(gBob)) * sw - 0.008 * gRec, lz = -0.52 + 0.045 * gRec;
  qlook(F[YAW], F[PIT], 0); GBQ[0] = QB[0]; GBQ[1] = QB[1]; GBQ[2] = QB[2]; GBQ[3] = QB[3]; brot(lx, ly, lz); GP[0] = F[CX] + V3[0]; GP[1] = F[CY] + V3[1]; GP[2] = F[CZ] + V3[2];
  const cx = GBQ[0], cy = GBQ[1], cz = GBQ[2], cw = GBQ[3], px = (0.13 * gRec + 0.3 * d) / 2, rz = 0.6 * d / 2;
  // toe-in towards the crosshair, kick up, roll over while reloading
  qmul(0, sin(0.045), 0, cos(0.045), sin(px), 0, 0, cos(px));
  qmul(QA[0], QA[1], QA[2], QA[3], 0, 0, sin(rz), cos(rz));
  qmul(cx, cy, cz, cw, QA[0], QA[1], QA[2], QA[3]);
  GBQ[0] = QA[0]; GBQ[1] = QA[1]; GBQ[2] = QA[2]; GBQ[3] = QA[3];
  brot(0, 0.012, -0.33); GMZ[0] = V3[0]; GMZ[1] = V3[1]; GMZ[2] = V3[2];
}
function drawGun() {
  gunPose();
  const x = GP[0], y = GP[1], z = GP[2], rp = reloadT > 0 ? 1 - reloadT / RELOAD : 0, mag = sin(rp * PI);
  const am = reloadT > 0 ? rp : ammo / MAG, lo = am < 0.25 && reloadT <= 0;
  const M = [0.3, 0.36, 0.42], D = [0.16, 0.19, 0.23]; // metal, dark metal
  part(x, y, z, 0, 0, 0, 0.034, 0.042, 0.12, 0, 0, 0, 1, 0, M[0], M[1], M[2], 0.35); // receiver
  part(x, y, z, 0, 0.012, -0.2, 0.017, 0.017, 0.1, 0, 0, 0, 1, 0, D[0], D[1], D[2], 0.3); // barrel
  const rr = frenzyOn ? 1 : 0.3, rg = frenzyOn ? 0.45 : 0.95, rb = frenzyOn ? 0.2 : 1; // glowing rings (orange in 狂乱)
  part(x, y, z, 0, 0.012, -0.15, 0.023, 0.023, 0.007, 0, 0, 0, 1, 0, rr, rg, rb, 3.5);
  part(x, y, z, 0, 0.012, -0.25, 0.023, 0.023, 0.007, 0, 0, 0, 1, 0, rr, rg, rb, 3.5);
  const tip = 1 - gRec; // the emitter crystal, back in place as the kick fades
  if (tip > 0.2) part(x, y, z, 0, 0.012, -0.31 - 0.01 * tip, 0.011 * tip, 0.011 * tip, 0.028, 0, 0, S8, C8, 0, 0.5, 1, 1, 6);
  part(x, y, z, 0, -0.07, 0.065, 0.017, 0.045, 0.024, sin(-0.14), 0, 0, cos(-0.14), 0, D[0], D[1], D[2], 0.2); // grip
  part(x, y, z, 0, -0.058 - 0.12 * mag, -0.045 + 0.02 * mag, 0.02, 0.035, 0.028, 0, 0, 0, 1, 0, 0.12, 0.5, 0.6, 2.2 * (1 - mag) + 0.4); // power cell
  part(x, y, z, 0, 0.052, -0.03, 0.008, 0.009, 0.042, 0, 0, 0, 1, 0, D[0], D[1], D[2], 0.25); // sight
  part(x, y, z, 0, 0.052, -0.074, 0.006, 0.006, 0.003, 0, 0, 0, 1, 0, 0.4, 1, 1, 5);
  part(x, y, z, 0, 0.004, 0.13, 0.028, 0.034, 0.016, 0, 0, 0, 1, 0, M[0], M[1], M[2], 0.5); // stock plate
  // ammo strip on the side facing you: shrinks as you shoot, refills during the reload, red when low
  if (am > 0.01) part(x, y, z, -0.036, 0.014, -0.005 + 0.085 * (1 - am), 0.003, 0.007, 0.085 * am, 0, 0, 0, 1, 0, lo ? 1 : 0.3, lo ? 0.25 : 0.95, lo ? 0.2 : 1, lo ? 7 : 5);
  for (let i = 0; i < MULTI; i++) for (const side of [-1, 1]) // spread-shot barrels
    part(x, y, z, side * 0.03, 0.03 - 0.045 * i, -0.17, 0.008, 0.008, 0.07, 0, 0, 0, 1, 0, 0.3, 0.95, 1, 2.5);
  if (gFlash > 0) { // muzzle flash
    const k = gFlash / 0.05, e = 0.012 + 0.014 * k, ro = gBob * 7 + gtime * 40;
    part(x, y, z, 0, 0.012, -0.35, e, e, 0.012 + 0.012 * k, 0, 0, sin(ro), cos(ro), 0.3, 0.55, 1, 1, 6);
  }
}

// treasure chest: a gold-banded box that turns and bobs, a light beam above it and three orbiting sparks
function drawChest(c) {
  const y = c.y + 0.25 * sin(c.t * 2.2), x = c.x, z = c.z, gl = 3 + sin(c.t * 5);
  qlook(c.t * 1.2, 0, 0); GBQ[0] = QB[0]; GBQ[1] = QB[1]; GBQ[2] = QB[2]; GBQ[3] = QB[3];
  part(x, y, z, 0, 0, 0, 0.6, 0.34, 0.42, 0, 0, 0, 1, 0, 0.55, 0.3, 0.08, 1.2);
  part(x, y, z, 0, 0.44, 0, 0.64, 0.12, 0.46, 0, 0, 0, 1, 0, 1, 0.75, 0.2, gl);
  part(x, y, z, 0.4, 0.05, 0, 0.07, 0.37, 0.44, 0, 0, 0, 1, 0, 1, 0.75, 0.2, gl);
  part(x, y, z, -0.4, 0.05, 0, 0.07, 0.37, 0.44, 0, 0, 0, 1, 0, 1, 0.75, 0.2, gl);
  part(x, y, z, 0, 0.18, -0.45, 0.1, 0.12, 0.03, 0, 0, 0, 1, 0.3, 1, 1, 0.7, 8);
  const top = min(c.y + 24, -0.5), hh = max(0.5, (top - c.y - 0.6) / 2);
  put(x, c.y + 0.6 + hh, z, 0.05, hh, 0.05, 0, 0, 0, 0, 1, 1, 0.85, 0.3, gl);
  for (let i = 0; i < 3; i++) { const o = c.t * 2.5 + i * TAU / 3; put(x + cos(o) * 1.1, y + 0.3 * sin(o * 1.7), z + sin(o) * 1.1, 0.06, 0.06, 0.06, 0.4, 0, 0, 0, 1, 1, 0.9, 0.5, 8); }
}
// writes every box into CUBE for render() and refreshes the HUD
function gameDraw() {
  cn = 0;
  for (const f of foes) if (f.on) drawFoe(f, hypot(f.x - F[CX], f.y - F[CY], f.z - F[CZ]));
  for (const b of bolts) if (b.on) { const h = sin(b.an / 2) * 0.577; put(b.x, b.y, b.z, 0.28, 0.28, 0.28, 0.5, h, h, h, cos(b.an / 2), 1, 0.5, 0.1, 5); }
  for (const p of debris) if (p.on) { // own rotation, then tumbling; shrinks and fades at the end
    const k = min(1, p.life / p.l0 * 1.5), h = sin(p.an / 2);
    qmul(p.ax * h, p.ay * h, p.az * h, cos(p.an / 2), p.q0, p.q1, p.q2, p.q3);
    put(p.x, p.y, p.z, p.sx * k, p.sy * k, p.sz * k, 0, QA[0], QA[1], QA[2], QA[3], p.r, p.g, p.b, p.gl * p.life / p.l0);
  }
  for (const t of tracers) if (t.on) put(t.x, t.y, t.z, 0.006, 0.006, t.l, 0.6, t.q0, t.q1, t.q2, t.q3, t.cr, t.cg, t.cb, 7);
  for (const c of chests) if (c.on) drawChest(c);
  if (boss.on) drawBoss();
  if (!over) drawGun();
  nCube = cn;
  hudUpdate();
}

// ---------------------------------------------------------------- input
addEventListener('mousedown', (e) => { if (battle && !menu && !choosing && !chestOpen && e.button === 0 && document.pointerLockElement === canvas) firing = 1; });
addEventListener('mouseup', (e) => { if (e.button === 0) firing = 0; });
addEventListener('blur', () => { firing = 0; });
document.addEventListener('pointerlockchange', () => { firing = 0; });
addEventListener('keydown', (e) => {
  if (!battle || menu || e.repeat) return;
  if (chestOpen) { if (e.code === 'Enter' || e.code === 'Space') chestAdvance(); return; }
  if (choosing) { if (e.code >= 'Digit1' && e.code <= 'Digit3') pick(e.code.charCodeAt(5) - 49); return; }
  if (e.code === 'KeyR') gameReload();
  else if (e.code === 'Enter' && over) retry();
});
// chest overlay: any click / tap (also with the mouse captured) skips the reveal, then closes it
addEventListener('pointerdown', (e) => { if (chestOpen && battle && !menu && !(e.target.closest && e.target.closest('button'))) chestAdvance(); });
function gameReload() { if (battle && !menu && !over && !choosing && !chestOpen && ammo < MAG && reloadT <= 0) { reloadT = RELOAD; sfx('reload'); } }
// touch / click buttons: reload, retry
$('tr').addEventListener('pointerdown', (e) => { e.preventDefault(); gameReload(); });
$('uoa').addEventListener('click', retry);
function retry() { if (!battle || !over) return; gameStart(); if (!mob && !document.pointerLockElement) capture(); }

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

// gold pieces for the chest overlay: random flight vectors, created once
{
  const cc = $('cbc');
  for (let i = 0; i < 28; i++) {
    const e = document.createElement('i'), a = Math.random() * TAU, d = 20 + Math.random() * 30;
    e.style.cssText = `--x:${(cos(a) * d).toFixed(1)}vmin;--y:${(sin(a) * d - 12).toFixed(1)}vmin;--r:${(Math.random() * 720 - 360) | 0}deg;animation-delay:${(1.4 + Math.random() * 0.15).toFixed(2)}s`;
    cc.appendChild(e);
  }
}

// ---------------------------------------------------------------- share: result card image + post to X
// The card is drawn on a 2D canvas (1200 x 630, the large link-card size). X's post intent can only carry text and a
// link, so the image is offered separately: saved as a PNG, or attached through the system share sheet where the
// browser supports sharing files (mostly phones).
function gameOverRelease() { const r = overRelease; overRelease = false; return r; }
let bossKills = 0, maxCombo = 0, overRelease = false, shareText = '', shareBlob = null;
const shareURL = () => (/^https?:/.test(location.protocol) ? location.origin + location.pathname : '');
function shareMake(place) {
  const evo = UPS.filter((u) => u[5] === 'e' && owned[u[0]]).map((u) => u[1]);
  const rare = UPS.filter((u) => u[5] === 'r' && owned[u[0]]).map((u) => u[1]);
  const best = place === 1 ? '（自己ベスト更新！）' : '';
  shareText = `CUBE ABYSS【${DF.name}】WAVE ${wave} / ${score.toLocaleString()}点${best}\n` +
    `Lv ${level} ・ 最大 ${maxCombo} コンボ` + (bossKills ? ` ・ ボス撃破 ${bossKills}` : '') + '\n' +
    (evo.length ? `進化：${evo.join('・')}\n` : '') + (rare.length ? `レア：${rare.join('・')}\n` : '') + '#CUBEABYSS';
  const cv = $('shc'), c = cv.getContext('2d'), W = 1200, H = 630, F0 = "'Segoe UI', 'Hiragino Sans', 'Noto Sans JP', system-ui, sans-serif";
  // background: deep water, light rays, scattered cubes
  let g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0d4a60'); g.addColorStop(0.55, '#06222f'); g.addColorStop(1, '#020b10');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.save(); c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 7; i++) {
    const x = 120 + i * 170 + 40 * sin(i * 3.1), w = 40 + 30 * (i % 3);
    g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#9ff6ff22'); g.addColorStop(1, '#9ff6ff00');
    c.fillStyle = g; c.beginPath(); c.moveTo(x, 0); c.lineTo(x + w, 0); c.lineTo(x + w * 2.4 - 160, H); c.lineTo(x - 160, H); c.fill();
  }
  c.restore();
  const COL = ['#ff5a3c', '#ffd21a', '#b862ff', '#30ff95', '#ffd84a'];
  for (let i = 0; i < 26; i++) {
    const x = (i * 337) % W, y = 40 + ((i * 211) % (H - 80)), s = 6 + (i * 7) % 18, a = i * 0.7;
    if (x > 60 && x < 760 && y > 60 && y < 560) continue; // keep the text area clear
    c.save(); c.translate(x, y); c.rotate(a); c.globalAlpha = 0.35 + 0.4 * ((i * 13) % 10) / 10;
    c.fillStyle = COL[i % 5]; c.shadowColor = COL[i % 5]; c.shadowBlur = 14; c.fillRect(-s, -s, s * 2, s * 2); c.restore();
  }
  // title
  c.save(); c.transform(1, 0, -0.14, 1, 0, 0);
  g = c.createLinearGradient(0, 40, 0, 120); g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#ffd2c4'); g.addColorStop(1, '#ff5e3c');
  c.font = `italic 900 76px Impact, 'Arial Black', ${F0}`; c.fillStyle = '#03131c'; c.fillText('CUBE ABYSS', 92, 126); c.fillStyle = g; c.fillText('CUBE ABYSS', 88, 120);
  c.restore();
  c.font = `800 22px ${F0}`; c.fillStyle = '#7ff3ff'; c.fillText('深 海 キ ュ ー ブ 迎 撃 戦', 84, 160);
  // difficulty badge
  const dc = ['#19c3d6', '#ffb21a', '#ff5e3c', '#ff3ccf', '#ffd84a'][DI];
  c.fillStyle = dc; c.beginPath(); c.roundRect(84, 196, 150, 54, 12); c.fill();
  c.font = `900 30px ${F0}`; c.fillStyle = '#03131c'; c.textAlign = 'center'; c.fillText(`難易度 ${DF.name}`, 159, 234); c.textAlign = 'left';
  c.font = `900 30px ${F0}`; c.fillStyle = '#e8fbff'; c.fillText(`WAVE ${wave}`, 256, 234);
  // score
  c.font = `800 22px ${F0}`; c.fillStyle = '#9ff6ff'; c.fillText('SCORE', 84, 300);
  g = c.createLinearGradient(0, 300, 0, 400); g.addColorStop(0, '#fff6c8'); g.addColorStop(1, '#ffb21a');
  c.font = `italic 900 96px Impact, 'Arial Black', ${F0}`; c.fillStyle = g; c.shadowColor = '#ff9a1a'; c.shadowBlur = 24; c.fillText(score.toLocaleString(), 80, 392); c.shadowBlur = 0;
  if (place === 1) { c.font = `900 24px ${F0}`; c.fillStyle = '#ff3c8c'; c.fillText('★ 自己ベスト更新！', 84, 432); }
  c.font = `700 26px ${F0}`; c.fillStyle = '#e8fbff';
  c.fillText(`Lv ${level}   ・   最大 ${maxCombo} コンボ` + (bossKills ? `   ・   ボス撃破 ${bossKills}` : ''), 84, place === 1 ? 476 : 446);
  // evolutions and rares as chips (right column)
  const chips = [...evo.map((n) => [n, 1]), ...rare.map((n) => [n, 0])].slice(0, 8);
  let y = 210; c.font = `800 20px ${F0}`; c.fillStyle = '#ffd84a'; if (chips.length) c.fillText('進化 / レア', 800, y - 18);
  for (const [n, e] of chips) {
    c.font = `900 26px ${F0}`; const w = c.measureText(n).width + 44;
    g = c.createLinearGradient(800, y, 800 + w, y); if (e) { g.addColorStop(0, '#c86bff'); g.addColorStop(1, '#3ce0ff'); } else { g.addColorStop(0, '#ffd84a'); g.addColorStop(1, '#ff9a1a'); }
    c.fillStyle = g; c.beginPath(); c.roundRect(800, y, w, 44, 10); c.fill();
    c.fillStyle = e ? '#fff' : '#2d1a00'; c.fillText(n, 822, y + 32); y += 54;
  }
  if (!chips.length) { c.font = `700 22px ${F0}`; c.fillStyle = '#7aa'; c.fillText('レア・進化：なし', 800, 210); }
  // footer
  c.fillStyle = '#ffffff18'; c.fillRect(0, H - 64, W, 64);
  c.font = `700 22px ${F0}`; c.fillStyle = '#bfe9f2'; c.fillText(shareURL().replace(/^https?:\/\//, '') || 'ブラウザで遊べる深海ローグライクFPS', 84, H - 24);
  c.textAlign = 'right'; c.fillStyle = '#ffd84a'; c.fillText('#CUBEABYSS', W - 60, H - 24); c.textAlign = 'left';
  shareBlob = null; cv.toBlob((b) => { shareBlob = b; }, 'image/png');
  $('shi').src = cv.toDataURL('image/png');
  $('shf').hidden = !(navigator.canShare && navigator.share);
}
$('shx').addEventListener('click', () => {
  const u = shareURL(), q = `text=${encodeURIComponent(shareText)}` + (u ? `&url=${encodeURIComponent(u)}` : '');
  open(`https://x.com/intent/post?${q}`, '_blank', 'noopener');
});
$('shs').addEventListener('click', () => {
  const a = document.createElement('a'); a.download = `cube-abyss-${Date.now()}.png`; a.href = $('shc').toDataURL('image/png'); a.click();
});
$('shf').addEventListener('click', async () => { // phones: share sheet with the image attached
  try {
    const file = new File([shareBlob], 'cube-abyss.png', { type: 'image/png' }), u = shareURL();
    const data = { text: shareText + (u ? `\n${u}` : '') };
    if (shareBlob && navigator.canShare({ files: [file] })) data.files = [file];
    await navigator.share(data);
  } catch {}
});
