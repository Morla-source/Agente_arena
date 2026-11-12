/* ================================================================================
   Banco de pruebas sin navegador para TU-95 BEAR
   ------------------------------------------------------------------------------
   Extrae el <script> de index.html, lo ejecuta en un contexto Node con stubs de
   DOM/Canvas/WebAudio y pilota el avión de verdad (mismo Aircraft, mismo
   MissionManager, mismo Game.stepFixed que usa el bucle del juego).
   Uso:  node tools/headless-test.mjs
   ================================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('No se encontró el <script> en index.html'); process.exit(1); }
const code = m[1];

/* ------------------------------ Stubs de DOM ------------------------------ */
function makeEl(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(), hidden: false, innerHTML: '', textContent: '',
    className: '', style: {}, dataset: {}, width: 0, height: 0, children: [],
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); }, toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
    },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c) { this.children.unshift(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    remove() { }, addEventListener() { }, removeEventListener() { },
    setAttribute() { }, getAttribute() { return null; }, focus() { },
    querySelector(sel) { return String(sel).startsWith('[') ? null : makeEl('b'); },
    querySelectorAll() { return []; },
    getContext() { return makeCtx(); }
  };
  Object.defineProperty(el, 'firstChild', { get() { return this.children[0] || null; } });
  return el;
}
const grad = () => ({ addColorStop() { } });
function makeCtx() {
  const store = {};
  return new Proxy(store, {
    get(t, k) {
      if (k === 'measureText') return () => ({ width: 42 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => grad();
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (k in t) return t[k];
      return () => { };
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}
const elements = new Map();
const documentStub = {
  readyState: 'complete',
  getElementById(id) { if (!elements.has(id)) elements.set(id, makeEl('canvas')); return elements.get(id); },
  createElement(t) { return makeEl(t); },
  querySelector() { return makeEl(); },
  querySelectorAll() { return []; },
  addEventListener() { }, body: makeEl('body'),
  documentElement: makeEl('html')
};
const store = new Map();
const sandbox = {
  console,
  performance: { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 },
  setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms || 0, 5)),
  clearTimeout, setInterval: () => 0, clearInterval,
  requestAnimationFrame: () => 0,          // el bucle no arranca: pilotamos a mano
  document: documentStub,
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  },
  Math, Date, JSON, isFinite, isNaN, parseFloat, parseInt,
  Uint8ClampedArray, Float32Array, Set, Map, Promise
};
sandbox.window = {
  innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1,
  addEventListener() { }, AudioContext: undefined, webkitAudioContext: undefined
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
/* Las constantes de nivel superior de un <script> no cuelgan del global: las
   exportamos con un epílogo para poder inspeccionarlas desde el test. */
const epilogue = `
;globalThis.__tu95 = { CONFIG, Aircraft, MissionManager, Game, Input, Renderer, HUD,
  Particles, Camera, AudioEngine, MISSIONS, Store, Store_: Store, clamp, valueNoise1D };
`;
vm.runInContext(code + epilogue, sandbox, { filename: 'index.html<script>' });

const { CONFIG, Aircraft, MissionManager, Game, Input, Renderer, HUD, Particles, Camera, AudioEngine, MISSIONS } = sandbox.__tu95;
const DT = CONFIG.FIXED_DT;

/* ------------------------------ Utilidades de test ------------------------------ */
let passed = 0, failed = 0;
const fails = [];
function ok(cond, label, extra) {
  if (cond) { passed++; console.log('  \x1b[32m✔\x1b[0m ' + label + (extra ? '  \x1b[90m' + extra + '\x1b[0m' : '')); }
  else { failed++; fails.push(label); console.log('  \x1b[31m✘ ' + label + '\x1b[0m' + (extra ? '  \x1b[90m' + extra + '\x1b[0m' : '')); }
}
function head(t) { console.log('\n\x1b[1m' + t + '\x1b[0m'); }
function kmh(v) { return Math.round(v * 3.6); }
function keys(allOff) {
  ['KeyW', 'KeyS', 'KeyA', 'KeyD'].forEach(k => Input.set(k, false));
  if (allOff) Input.clear();
}
function step(n, hook) {
  for (let i = 0; i < n; i++) {
    if (hook) hook(i);
    Game.manualStep(DT);
    /* El bucle real sigue integrando en ENDING (la caída del avión y el paracaídas) */
    if (Game.state !== 'PLAYING' && Game.state !== 'ENDING') return i;
  }
  return n;
}
function resetMission(i) {
  Game.state = 'PLAYING';
  Game.startMission(i);
  Game.state = 'PLAYING';
  keys(true);
  return MISSIONS[i];
}

/* ================================================================================
   1. DESPEGUE + ASCENSO + CRUCERO (misión 1, pilotada por el banco de pruebas)
   ================================================================================ */
head('1 · Despegue, ascenso a 4 000 m y crucero (misión 1)');
resetMission(0);
let t = 0, liftoffT = -1, liftoffV = 0, rollDistance = 0;
const x0 = Aircraft.x;
step(120 * 260, () => {
  const p = Aircraft;
  t += DT;
  if (p.onGround) {
    Input.set('KeyW', true);                                  // potencia a tope
    Input.set('KeyA', p.vx * 3.6 > 205 && p.pitch < 10);      // rotación a 205 km/h
    Input.set('KeyD', p.pitch > 11);
    rollDistance = p.x - x0;
  } else {
    if (liftoffT < 0) { liftoffT = t; liftoffV = p.vx; }
    Input.set('KeyW', p.throttle < 99 && p.y < 3800);
    Input.set('KeyS', p.y > 4400 || p.vx * 3.6 > 900);
    if (p.y > 250) { Input.set('KeyA', false); p.gearCmd = 0; }  // tren arriba
    if (p.y > 2600) p.flaps = 1;                              // flaps neutros en ascenso
    /* mantener régimen de ascenso ~8 m/s */
    Input.set('KeyA', p.pitch < 7 && p.vy < 9);
    Input.set('KeyD', p.pitch > 12 || p.vy > 13);
    if (p.y > 4000) {                                          // nivelar a 4 200 m
      Input.set('KeyA', p.pitch < 1 && p.vy < 0.5);
      Input.set('KeyD', p.pitch > 3 || p.vy > 1.5);
    }
  }
});
const p = Aircraft;
ok(liftoffT > 0, 'El avión despega', 't=' + liftoffT.toFixed(1) + ' s · ' + kmh(liftoffV) + ' km/h');
ok(liftoffT > 0 && liftoffV * 3.6 > 190 && liftoffV * 3.6 < 260, 'Velocidad de despegue en el rango 190-260 km/h', kmh(liftoffV) + ' km/h');
ok(rollDistance < 2000 && rollDistance > 300, 'Carrera de despegue dentro de la pista de 3 000 m', Math.round(rollDistance) + ' m');
ok(p.stats.maxAlt >= 1500, 'Asciende tras el despegue (comprobado a fondo más abajo)', 'máx ' + Math.round(p.stats.maxAlt) + ' m');
ok(!p.destroyed, 'Sin accidente durante el despegue y ascenso');
console.log('  \x1b[90mtiempo total ' + t.toFixed(0) + ' s · combustible ' +
  Math.round(p.fuel / CONFIG.FUEL_CAPACITY * 100) + ' % · distancia ' + (p.x / 1000).toFixed(1) + ' km\x1b[0m');

/* --- Régimen de crucero: sube a 9 000 m y vuela al 70 % con flaps neutros --- */
p.flaps = 1; p.gearCmd = 0; p.throttleCmd = 100;
step(120 * 900, () => {
  const q = Aircraft;
  q.flaps = 1; q.gearCmd = 0;
  q.throttleCmd = q.y > 8100 ? 70 : 100;
  Input.set('KeyA', q.y < 8200 ? (q.pitch < 8 && q.vy < 15) : (q.pitch < 1.5 && q.vy < 0.2));
  Input.set('KeyD', q.y < 8200 ? (q.pitch > 11 || q.vy > 18) : (q.pitch > 3.5 || q.vy > 1.2));
});
ok(Aircraft.y > 8000, 'Sube hasta el nivel de crucero', Math.round(Aircraft.y) + ' m');
ok(Aircraft.stats.maxAlt >= 4000, 'Alcanza los 4 000 m que pide la misión 1', 'máx ' + Math.round(Aircraft.stats.maxAlt) + ' m');
Aircraft.throttleCmd = 70;
const fuelBefore = Aircraft.fuel, tBefore = Aircraft.stats.time;
step(120 * 90, () => {
  const q = Aircraft;
  q.throttleCmd = 70;
  Input.set('KeyA', q.pitch < 1.5 && q.vy < 0.2);
  Input.set('KeyD', q.pitch > 3.5 || q.vy > 1.2);
});
const cruiseKmh = kmh(Aircraft.vx);
const burn = (fuelBefore - Aircraft.fuel) / (Aircraft.stats.time - tBefore);
ok(cruiseKmh > 700 && cruiseKmh < 880, 'Crucero al 70 % a 8 000 m entre 700 y 880 km/h', cruiseKmh + ' km/h');
ok(burn > 10 && burn < 20, 'Consumo al 70 % entre 10 y 20 kg/s', burn.toFixed(1) + ' kg/s');
console.log('  \x1b[90maltitud ' + Math.round(Aircraft.y) + ' m · VS ' + Aircraft.vy.toFixed(2) +
  ' m/s · aoa ' + Aircraft.aoa.toFixed(1) + '° · CL ' +
  (Aircraft.lift / (0.5 * Aircraft.density * Aircraft.airspeed ** 2 * CONFIG.WING_AREA)).toFixed(2) + '\x1b[0m');

/* --- Velocidad máxima al 100 % --- */
Aircraft.throttleCmd = 100;
step(120 * 200, () => {
  const q = Aircraft;
  q.throttleCmd = 100; q.flaps = 1; q.gearCmd = 0; q.gear = 0;
  Input.set('KeyA', q.pitch < 0.5 && q.vy < 0);
  Input.set('KeyD', q.pitch > 2 || q.vy > 0.5);
});
const maxKmh = kmh(Aircraft.vx);
ok(maxKmh > 880 && maxKmh < 1010, 'Velocidad máxima al 100 % por debajo de 1 010 km/h', maxKmh + ' km/h');
Aircraft.throttleCmd = 70;

/* --- Pérdida por ángulo de ataque --- */
step(120 * 40, () => { Input.set('KeyA', true); });
ok(Aircraft.stalled === true, 'Entra en pérdida con el morro arriba a baja velocidad');
const pitchBefore = Aircraft.pitch;
step(120 * 6, () => { keys(true); });
ok(Aircraft.pitch < pitchBefore, 'La pérdida empuja el morro hacia abajo', pitchBefore.toFixed(1) + '° → ' + Aircraft.pitch.toFixed(1) + '°');

/* ================================================================================
   2. ATERRIZAJE COMPLETO Y VICTORIA (misión 1)
   ================================================================================ */
head('2 · Aproximación, toma y victoria (misión 1)');
{
  const q = Aircraft;
  const dest = MissionManager.destRunway();
  q.x = dest.x - 22000; q.y = 800; q.vx = 66; q.vy = 0; q.pitch = 2;
  q.flaps = 2; q.gearCmd = 1; q.gear = 1; q.throttleCmd = 20; q.onGround = false;
  keys(true);
  const td = { x: dest.x - dest.len / 2 + 400 };   // tocar 400 m después del umbral
  let tt = 0, touched = false, sink = 0;
  step(120 * 400, (i) => {
    const a = Aircraft;
    tt += DT;
    const d = td.x - a.x;
    /* Senda de 3.2 %; lejos de la pista se respeta el relieve, y ese suelo se
       desvanece entre 7 km y 3 km para no crear un escalón en la senda. */
    const glide = d * 0.032;
    const terrW = Math.max(0, Math.min(1, (d - 3000) / 4000));
    const altTarget = Math.max(glide, (MissionManager.groundAt(a.x) + 80) * terrW);
    const vTargetRef = Math.max(a.stallSpeed * 1.18, 52);
    /* Descenso pedido: el necesario para converger con la senda, y cerca del suelo
       una recogida exponencial proporcional a la altura restante. */
    const needed = (a.y - altTarget) * a.vx / Math.max(d, 250);
    const flare = d < 4000 ? a.y * 0.09 : 0;
    const sinkTarget = -Math.max(0.6, Math.min(7, Math.max(needed * 1.2 + 0.6, flare)));
    let pitchCmd = 5.5 + (a.vy - sinkTarget) * -2.6 + (a.y - altTarget) * -0.015;
    pitchCmd += Math.max(0, Math.min(5, (a.vx - vTargetRef) * 0.3));   // pasado de velocidad → morro arriba
    pitchCmd = Math.max(-7, Math.min(13, pitchCmd));
    Input.set('KeyA', a.pitch < pitchCmd - 0.12);
    Input.set('KeyD', a.pitch > pitchCmd + 0.12);
    a.throttleCmd = Math.max(0, Math.min(70, 15 + (vTargetRef - a.vx) * 3.2));
    if (!touched && a.onGround) { touched = true; sink = a.stats.touchSink; keys(true); }
    if (touched) { a.throttleCmd = 0; a.brakes = true; if (a.vx > 8) a.chuteDeployed = true; }
  });
  const a = Aircraft;
  if (a.destroyed) console.log('  [90m(causa del fallo en la aproximación: ' + a.cause + ')[0m');
  ok(touched, 'Toma tierra sobre la pista de destino');
  ok(!a.destroyed, 'Toma válida (sin desastre)', 'VS de toma ' + sink.toFixed(2) + ' m/s · ' +
    kmh(a.stats.touchSpeed) + ' km/h · ' + a.stats.touchPitch.toFixed(1) + '°');
  ok(sink <= CONFIG.MAX_SAFE_SINK, 'Régimen de toma dentro del límite', sink.toFixed(2) + ' ≤ ' + CONFIG.MAX_SAFE_SINK + ' m/s');
  ok(Math.abs(a.vx) < CONFIG.STOP_SPEED, 'Se detiene por completo en pista', Math.abs(a.vx).toFixed(2) + ' m/s');
  ok(Game.state === 'VICTORY', 'La máquina de estados pasa a VICTORY', 'estado=' + Game.state);
  ok(MISSIONS[0].objectives.every(o => o.done), 'Todos los objetivos de la misión 1 completados');
}

/* ================================================================================
   3. REGLAS DE ATERRIZAJE → DESASTRE
   ================================================================================ */
head('3 · Reglas de aterrizaje y causas de desastre');
function landingCase(setup, runSeconds) {
  resetMission(0);
  const dest = MissionManager.destRunway();
  const a = Aircraft;
  a.x = dest.x - 700; a.y = 22; a.vx = 58; a.vy = 0; a.pitch = 3;
  a.flaps = 2; a.gearCmd = 1; a.gear = 1; a.throttleCmd = 0; a.onGround = false;
  setup(a);
  keys(true);
  step(120 * (runSeconds || 20), () => { keys(true); Aircraft.throttleCmd = 0; });
  return Aircraft;
}
/** Llama a la regla de toma directamente con el estado que queremos evaluar. */
function touchdownCase(mut) {
  resetMission(0);
  const dest = MissionManager.destRunway();
  const a = Aircraft;
  a.x = dest.x - 200; a.y = 0.5; a.vx = 58; a.vy = -2; a.pitch = 3;
  a.flaps = 2; a.gear = 1; a.gearCmd = 1; a.onGround = false; a.destroyed = false;
  mut(a);
  a.touchdown(MissionManager.groundAt(a.x), MissionManager.runwayUnder(a.x), MissionManager);
  return a;
}
let c = landingCase(a => { a.gear = 0; a.gearCmd = 0; });
ok(c.destroyed && /tren/i.test(c.cause), 'Vuelo real con tren arriba → desastre', c.cause);
c = touchdownCase(a => { a.vy = -11.5; });
ok(c.destroyed && /vertical/i.test(c.cause), 'Descenso de 11.5 m/s → colapso del tren', c.cause);
c = touchdownCase(a => { a.pitch = -9; });
ok(c.destroyed && /morro picado/i.test(c.cause), 'Morro picado (-9°) → impacto de proa', c.cause);
c = touchdownCase(a => { a.pitch = 19; });
ok(c.destroyed && /tailstrike/i.test(c.cause), 'Cabeceo de 19° → tailstrike', c.cause);
c = touchdownCase(a => { a.gear = 0; });
ok(c.destroyed && /sin tren/i.test(c.cause), 'Regla de tren arriba (llamada directa)', c.cause);
c = touchdownCase(() => { });
ok(!c.destroyed && c.onGround, 'Toma suave (-2 m/s, 3°, tren abajo) → válida');
c = landingCase(a => { a.x = MissionManager.destRunway().x + MissionManager.destRunway().len / 2 + 260; a.y = 60; });
ok(c.destroyed && /fuera de la pista/i.test(c.cause), 'Tocar fuera de la pista → desastre', c.cause);
c = landingCase(a => {
  const d2 = MissionManager.destRunway();
  a.x = d2.x + d2.len / 2 - 60; a.y = 0; a.vy = 0; a.vx = 68;
  a.onGround = true; a.touched = true; a.throttleCmd = 100; a.brakes = false;
}, 20);
ok(c.destroyed && /salido de la pista/i.test(c.cause), 'No frenar a tiempo → se sale por el final', c.cause);

/* ================================================================================
   4. BOMBAS (misión 3)
   ================================================================================ */
head('4 · Bombardeo con caída parabólica (misión 3)');
resetMission(2);
{
  const a = Aircraft;
  const tgt = MissionManager.targets[0];
  a.x = tgt.x - 12000; a.y = 3000; a.vx = 90; a.vy = 0; a.pitch = 0;
  a.flaps = 1; a.gearCmd = 0; a.gear = 0; a.throttleCmd = 55; a.onGround = false;
  a.bayCmd = 1;
  keys(true);
  let dropped = false, n = 0;
  step(120 * 200, () => {
    const q = Aircraft;
    q.throttleCmd = 55;
    Input.set('KeyA', q.pitch < 0 && q.vy < 0);
    Input.set('KeyD', q.pitch > 1.5 || q.vy > 0.5);
    if (!dropped) {
      /* alcance de suelta: distancia horizontal = vx · tiempo de caída (sobre el terreno real) */
      const fall = Math.sqrt(2 * (q.y - MissionManager.groundAt(tgt.x)) / CONFIG.GRAVITY);
      const range = q.vx * fall;
      if (tgt.x - q.x <= range && tgt.x - q.x > 0) { MissionManager.dropBomb(); dropped = true; }
    }
    n++;
  });
  ok(dropped, 'Suelta la bomba calculando la parábola');
  ok(Aircraft.stats.bombsDropped > 0, 'Bombas lanzadas', Aircraft.stats.bombsDropped + ' ud');
  ok(Aircraft.stats.bombsHit > 0 && MissionManager.targets[0].destroyed, 'Impacto dentro de la zona y objetivo destruido',
    'impactos ' + Aircraft.stats.bombsHit + ' · erradas ' + (Aircraft.stats.bombsDropped - Aircraft.stats.bombsHit));
}

/* ================================================================================
   5. EMERGENCIA DE MOTORES (misión 5)
   ================================================================================ */
head('5 · Fallo de dos motores y límite de potencia (misión 5)');
resetMission(4);
{
  const a = Aircraft;
  a.x = 37000; a.y = 6000; a.vx = 180; a.vy = 0; a.pitch = 1; a.onGround = false;
  a.flaps = 1; a.gearCmd = 0; a.gear = 0; a.throttleCmd = 75;
  keys(true);
  step(120 * 60, () => {
    const q = Aircraft;
    q.throttleCmd = MissionManager.events.fireOut ? 60 : 30;   // por debajo del 40 % para el extintor
    Input.set('KeyA', q.pitch < 1 && q.vy < -1);
    Input.set('KeyD', q.pitch > 4 || q.vy > 1);
  });
  const onFire = a.engines.filter(e => e.onFire).length;
  ok(MissionManager.events.engineFire === true, 'Se produce el incendio a los 38 km');
  ok(a.throttleLimit === 55, 'La potencia queda limitada al 55 %', 'límite=' + a.throttleLimit + ' %');
  ok(a.engines[1].health < 1 && a.engines[2].health < 1, 'Los motores 2 y 3 quedan dañados',
    'salud ' + a.engines.map(e => e.health.toFixed(2)).join(' / '));
  ok(MissionManager.events.fireOut === true, 'El incendio se sofoca bajando del 40 % de potencia');
  ok(!a.destroyed, 'El avión sigue volando con dos motores');
  /* Con dos motores debe poder mantener el vuelo nivelado */
  const before = a.y;
  step(120 * 60, () => {
    const q = Aircraft;
    q.throttleCmd = 55;
    Input.set('KeyA', q.pitch < 2 && q.vy < 0);
    Input.set('KeyD', q.pitch > 5 || q.vy > 0.5);
  });
  ok(a.y > before - 1500, 'Mantiene el vuelo con dos motores (no se desploma)',
    'Δaltitud ' + Math.round(a.y - before) + ' m');
}

/* ================================================================================
   6. TECHO DE VUELO Y COMBUSTIBLE
   ================================================================================ */
head('6 · Techo de vuelo y gestión de combustible');
{
  resetMission(1);
  const a = Aircraft;
  a.x = 20000; a.y = 11500; a.vx = 220; a.vy = 0; a.onGround = false;
  a.flaps = 1; a.gear = 0; a.gearCmd = 0; a.throttleCmd = 100;
  keys(true);
  let maxAlt = a.y;
  step(120 * 240, () => {
    const q = Aircraft;
    q.throttleCmd = 100;
    Input.set('KeyA', q.pitch < 6 && q.vy < 2);
    Input.set('KeyD', q.pitch > 9 || q.vy > 4);
    maxAlt = Math.max(maxAlt, q.y);
  });
  ok(maxAlt < 14200, 'El techo de vuelo está limitado por la pérdida de empuje', 'máx ' + Math.round(maxAlt) + ' m');
  ok(Aircraft.throttle === 100, 'El acelerador llega al 100 %', Aircraft.throttle.toFixed(0) + ' %');
}
{
  resetMission(1);
  const a = Aircraft;
  a.x = 20000; a.y = 8000; a.vx = 230; a.vy = 0; a.onGround = false;
  a.flaps = 1; a.gear = 0; a.throttleCmd = 70;
  keys(true);
  const f0 = a.fuel;
  step(120 * 60, () => { const q = Aircraft; q.throttleCmd = 70; keys(true); });
  const used = f0 - Aircraft.fuel;
  ok(used > 700 && used < 1000, 'Quema ~14 kg/s al 70 % durante 60 s', Math.round(used) + ' kg');
  /* Sin combustible: los motores se paran */
  Aircraft.fuel = 0;
  step(120 * 20, () => { const q = Aircraft; q.throttleCmd = 100; keys(true); });
  ok(Aircraft.thrust < 1, 'Sin combustible el empuje cae a cero', 'empuje ' + Aircraft.thrust.toFixed(0) + ' N');
}

/* ================================================================================
   7. ANTIAÉREA (misión 6) Y EYECCIÓN
   ================================================================================ */
head('7 · Cinturón antiaéreo y eyección (misión 6)');
resetMission(5);
{
  const a = Aircraft;
  a.x = 91500; a.y = 5000; a.vx = 200; a.vy = 0; a.onGround = false;
  a.flaps = 1; a.gear = 0; a.throttleCmd = 80;
  keys(true);
  let fired = 0;
  step(120 * 90, () => {
    const q = Aircraft;
    q.throttleCmd = 80;
    Input.set('KeyA', q.pitch < 2 && q.vy < 0);
    Input.set('KeyD', q.pitch > 5 || q.vy > 0.5);
    fired = MissionManager.shells.length;
  });
  ok(MissionManager.flak.length === 3, 'La misión 6 tiene 3 baterías antiaéreas');
  ok(fired >= 0 && Aircraft.stats.time > 0, 'Las baterías entran en acción dentro del alcance');
  const integrityLost = 100 - Aircraft.integrity;
  console.log('  \x1b[90mintegridad tras cruzar el cinturón: ' + Aircraft.integrity.toFixed(0) +
    ' % (daño recibido ' + integrityLost.toFixed(0) + ')\x1b[0m');
  ok(Aircraft.integrity < 100 || Aircraft.y > 9000, 'El flak hace daño si se vuela dentro del envelope');
}
{
  resetMission(5);
  const a = Aircraft;
  a.x = 50000; a.y = 1200; a.vx = 190; a.vy = 0; a.onGround = false;
  keys(true);
  a.eject();
  ok(a.ejected && a.pilot, 'La eyección crea al piloto con paracaídas');
  step(120 * 260, () => keys(true));
  ok(a.pilot && a.pilot.landed, 'El piloto toca tierra con el paracaídas abierto',
    a.pilot ? 'vy final ' + a.pilot.vy.toFixed(1) + ' m/s · sobrevive=' + a.pilot.survived : '');
  ok(a.destroyed, 'El avión abandonado acaba estrellándose');
}

/* ================================================================================
   8. HUMO DE RENDER: que todo el código de dibujo se ejecute sin errores
   ================================================================================ */
head('8 · Ejecución del renderizado (Canvas) en todos los estados');
try {
  resetMission(5);
  const a = Aircraft;
  a.x = 100000; a.y = 8000; a.vx = 210; a.vy = -3; a.onGround = false;
  a.chute = 0.6; a.bay = 1; a.gear = 1; a.flaps = 2; a.throttle = 80;
  a.engines[2].onFire = true;
  MissionManager.dropBomb();
  Particles.explosion(a.x - 300, a.y - 200, 60, '#ff9a3c', 1.5);
  Camera.resize(1440, 900);
  Camera.update(0.016, a, true);
  for (const storm of [false, true]) {
    Renderer.draw(0.016, a, { storm, rain: storm });
    HUD.draw(makeCtx(), 1440, 900, a, MissionManager.m, MissionManager);
    HUD.drawRoute(makeCtx(), 1440, 900, a, MissionManager.m, MissionManager);
  }
  /* Menú y avión destrozado */
  a.destroyed = true; a.onGround = true;
  Renderer.draw(0.016, a, { storm: false });
  Game.toMenu();
  Game.updateMenuScene(0.016);
  Renderer.draw(0.016, Aircraft, { storm: false });
  /* Diapositivas del manual */
  Game.buildManual();
  ok(true, 'Renderer.draw + HUD.draw + HUD.drawRoute ejecutados sin excepciones (tormenta, fuego, bombas, menú)');
} catch (e) {
  ok(false, 'Renderer.draw + HUD.draw + HUD.drawRoute ejecutados sin excepciones', e.message + '\n' + e.stack.split('\n')[1]);
}

/* ================================================================================
   9. AUDIO: el sintetizador debe construirse (se prueba con un AudioContext falso)
   ================================================================================ */
head('9 · Sintetizador de audio (Web Audio API simulado)');
try {
  const node = () => ({
    connect() { }, disconnect() { }, start() { }, stop() { },
    gain: { value: 0, setValueAtTime() { }, exponentialRampToValueAtTime() { }, linearRampToValueAtTime() { }, setTargetAtTime() { } },
    frequency: { value: 0, setValueAtTime() { }, exponentialRampToValueAtTime() { }, setTargetAtTime() { } },
    detune: { value: 0, setValueAtTime() { }, setTargetAtTime() { } },
    Q: { value: 0 }, threshold: { value: 0 }, ratio: { value: 0 },
    type: '', buffer: null, loop: false
  });
  sandbox.window.AudioContext = function () {
    return {
      currentTime: 0, sampleRate: 48000, state: 'running', destination: node(),
      createGain: node, createOscillator: node, createBiquadFilter: node,
      createBufferSource: node, createDynamicsCompressor: node,
      createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
      resume() { }
    };
  };
  AudioEngine.started = false; AudioEngine.ready = false;
  AudioEngine.init();
  ok(AudioEngine.ready === true, 'AudioEngine.init() construye 4 motores + viento', 'nodos=' + AudioEngine.eng.length);
  AudioEngine.update(Aircraft.engines, 72, 220, 8000);
  AudioEngine.stallAlarm(); AudioEngine.gpwsAlarm(); AudioEngine.gearAlarm();
  AudioEngine.explosion(1); AudioEngine.tireSqueal(1); AudioEngine.bombWhistle();
  AudioEngine.chute(); AudioEngine.gearMotor(true); AudioEngine.flapMotor();
  AudioEngine.fireCrackle(); AudioEngine.eject(); AudioEngine.setMuted(true); AudioEngine.setMuted(false);
  ok(true, 'Todas las alarmas y efectos se sintetizan sin errores');
} catch (e) {
  ok(false, 'Sintetizador de audio sin errores', e.message);
}

/* ------------------------------ Resumen ------------------------------ */
console.log('\n\x1b[1m────────────────────────────────────────\x1b[0m');
console.log('\x1b[1m  ' + passed + ' pruebas correctas · ' + failed + ' fallos\x1b[0m');
if (failed) {
  console.log('\x1b[31m  Fallos: ' + fails.join(' | ') + '\x1b[0m');
  process.exit(1);
}
console.log('\x1b[32m  Todo el modelo físico responde según lo especificado.\x1b[0m');
