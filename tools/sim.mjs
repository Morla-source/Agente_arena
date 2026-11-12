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


export function loadGame() {
  const api = sandbox.__tu95;
  return { ...api, sandbox, DT: api.CONFIG.FIXED_DT };
}
export const G = sandbox.__tu95;
