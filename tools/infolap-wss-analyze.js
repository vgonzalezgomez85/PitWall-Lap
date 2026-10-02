#!/usr/bin/env node
// Analiza una captura de tools/infolap-wss-probe.js para averiguar qué
// significan `isFastLap` e `isRace` en los mensajes LAP del TicTac nuevo,
// y avisa de campos o tipos de mensaje que aún no conocemos.
//
// Uso:
//   node tools/infolap-wss-probe.js <ip> 0 | tee captura.log
//   node tools/infolap-wss-analyze.js captura.log

const fs = require('fs');

const file = process.argv[2];
if (!file) { console.error('Uso: node tools/infolap-wss-analyze.js <captura.log>'); process.exit(1); }

const CAMPOS = {
  CONFIG: ['type', 'minAppVersionCode', 'minAppVersion', 'mangaPilots', 'rivals'],
  LAP: ['type', 'frame', 'laneId', 'pilotName', 'lapTime', 'isFastLap', 'position', 'isRace',
    'isFirstLap', 'pilotAheadName', 'pilotAheadVme', 'gapAhead', 'pilotBehindName',
    'pilotBehindVme', 'gapBehind'],
  RIVALS_UPDATE: ['type', 'rivals'],
};
const MIN_VUELTA_S = 0.5;   // igual que la app: por debajo es el test de transmisión

// ── Lectura ──────────────────────────────────────────────────────────────
const mensajes = [];
for (const linea of fs.readFileSync(file, 'utf8').split('\n')) {
  const m = linea.match(/^\s*([\d.]+)\s+(\{.*\})\s*$/);
  if (!m) continue;
  try { mensajes.push({ t: Number(m[1]), msg: JSON.parse(m[2]) }); } catch { /* línea corrupta */ }
}
console.log(`${mensajes.length} mensajes JSON en ${file}\n`);

// ── Campos y tipos desconocidos ──────────────────────────────────────────
const tipos = new Map();
const desconocidos = new Map();
for (const { msg } of mensajes) {
  tipos.set(msg.type, (tipos.get(msg.type) ?? 0) + 1);
  const conocidos = CAMPOS[msg.type];
  if (!conocidos) { desconocidos.set(`tipo ${msg.type}`, JSON.stringify(msg).slice(0, 200)); continue; }
  for (const k of Object.keys(msg)) {
    if (!conocidos.includes(k)) desconocidos.set(`${msg.type}.${k}`, JSON.stringify(msg[k]));
  }
}
console.log('Tipos:', [...tipos].map(([k, n]) => `${k}×${n}`).join('  '));
if (desconocidos.size) {
  console.log('NUEVO (no lo conocíamos):');
  for (const [k, ej] of desconocidos) console.log(`  ${k}  ej: ${ej}`);
} else {
  console.log('Sin campos ni tipos nuevos.');
}

// ── isFastLap: contrastar hipótesis ──────────────────────────────────────
// Para cada vuelta válida calculamos si sería "la mejor" según varios
// criterios y medimos cuál coincide con lo que dice el TicTac.
const hipotesis = {
  'mejor personal en la manga': (v) => v.mejorPilotoManga,
  'mejor personal en la captura': (v) => v.mejorPilotoTotal,
  // "manga" = desde el último CONFIG (también se reinicia con la carrera).
  'mejor de todos en la manga': (v) => v.mejorAbsManga,
  'mejor de todos en la captura': (v) => v.mejorAbsTotal,
  'mejor del carril en la manga': (v) => v.mejorCarrilManga,
};
const aciertos = Object.fromEntries(Object.keys(hipotesis).map(h => [h, { ok: 0, fp: 0, fn: 0 }]));
let pilotoManga = new Map(), carrilManga = new Map(), absManga = Infinity;
const pilotoTotal = new Map();
let absTotal = Infinity;
let vueltas = 0, rapidas = 0, mangas = 0;
const ejemplosRapida = [];

// ── isRace: tramos consecutivos con el mismo valor ───────────────────────
const tramos = [];
let posCeroPorIsRace = { true: 0, false: 0 }, vueltasPorIsRace = { true: 0, false: 0 };

for (const { t, msg } of mensajes) {
  if (msg.type === 'CONFIG') {
    mangas += 1;
    pilotoManga = new Map(); carrilManga = new Map(); absManga = Infinity;
    tramos.push({ config: true, t });
    continue;
  }
  if (msg.type !== 'LAP') continue;

  const r = msg.isRace === true;
  const ultimo = [...tramos].reverse().find(x => !x.config);
  if (!ultimo || ultimo.isRace !== r || tramos[tramos.length - 1].config) {
    tramos.push({ isRace: r, desde: t, hasta: t, vueltas: 0 });
  }
  const tramo = tramos[tramos.length - 1];
  tramo.hasta = t; tramo.vueltas += 1;
  vueltasPorIsRace[r] += 1;
  if (!msg.position) posCeroPorIsRace[r] += 1;

  const s = msg.lapTime;
  if (!r) continue;   // tanda libre: isFastLap solo tiene sentido en carrera
  if (msg.isFirstLap || typeof s !== 'number' || s < MIN_VUELTA_S) continue;
  vueltas += 1;
  const nombre = msg.pilotName ?? `Carril ${msg.laneId}`;
  const v = {
    mejorPilotoManga: s < (pilotoManga.get(nombre) ?? Infinity),
    mejorPilotoTotal: s < (pilotoTotal.get(nombre) ?? Infinity),
    mejorAbsManga: s < absManga,
    mejorAbsTotal: s < absTotal,
    mejorCarrilManga: s < (carrilManga.get(msg.laneId) ?? Infinity),
  };
  pilotoManga.set(nombre, Math.min(s, pilotoManga.get(nombre) ?? Infinity));
  pilotoTotal.set(nombre, Math.min(s, pilotoTotal.get(nombre) ?? Infinity));
  carrilManga.set(msg.laneId, Math.min(s, carrilManga.get(msg.laneId) ?? Infinity));
  absManga = Math.min(s, absManga);
  absTotal = Math.min(s, absTotal);

  const fast = msg.isFastLap === true;
  if (fast) {
    rapidas += 1;
    if (ejemplosRapida.length < 8) ejemplosRapida.push(`t=${t}s ${nombre} c${msg.laneId} ${s}s`);
  }
  for (const [h, f] of Object.entries(hipotesis)) {
    const pred = f(v);
    if (pred === fast) aciertos[h].ok += 1;
    else if (pred) aciertos[h].fn += 1;   // creíamos que era la mejor y el TicTac dice que no
    else aciertos[h].fp += 1;             // el TicTac dice mejor y no lo esperábamos
  }
}

console.log(`\n── isFastLap ── ${vueltas} vueltas de carrera, ${rapidas} marcadas rápidas, ${mangas} CONFIG`);
if (vueltas) {
  const filas = Object.entries(aciertos).sort((a, b) => b[1].ok - a[1].ok);
  for (const [h, a] of filas) {
    console.log(`  ${((a.ok / vueltas) * 100).toFixed(1).padStart(5)}%  ${h.padEnd(30)} ` +
      `(TicTac sí/nosotros no: ${a.fp}, nosotros sí/TicTac no: ${a.fn})`);
  }
  console.log('  Ejemplos marcados rápidos:'); for (const e of ejemplosRapida) console.log(`    ${e}`);
  console.log('  Ojo: si la captura empieza con la carrera ya en marcha, la "mejor en la captura"' +
    ' no ve las vueltas anteriores y falla al principio.');
}

console.log('\n── isRace ── tramos en orden (│ = llega un CONFIG)');
for (const x of tramos) {
  if (x.config) console.log(`  │ CONFIG t=${x.t}s`);
  else console.log(`  isRace=${x.isRace}  t=${x.desde}–${x.hasta}s  ${x.vueltas} vueltas`);
}
for (const r of ['true', 'false']) {
  if (vueltasPorIsRace[r]) {
    console.log(`  isRace=${r}: ${vueltasPorIsRace[r]} LAP, ${posCeroPorIsRace[r]} con position 0`);
  }
}
