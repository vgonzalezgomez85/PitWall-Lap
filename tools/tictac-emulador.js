#!/usr/bin/env node
// Emulador del TicTac ANTIGUO (protocolo UDP) para probar la app sin pista.
//
//   node tools/tictac-emulador.js [--pilotos "Víctor,Ana,Luis,Marta"] [--media 4.5]
//
// Protocolo (el mismo que entiende src/data/InfolapSource.ts):
//   • La app manda probes "InfoLap:Cxxx" desde UDP :12543 al :4441.
//   • Respondemos "OK <nombre>;#<id>..." (id de 3 dígitos) al origen del probe.
//   • Después empujamos paquetes de estado de 52 bytes a cada cliente:
//       0-3  secuencia | 4 carril | 5-24 nombre | 30-36 tiempo (XOR "7654321")
//       37   flag      | 44 '1' vuelta nueva / 'X' reposo | 45-47 código carril
//   • No escuchamos en TCP 12543 → la app descarta el WSS y se queda en UDP.

const dgram = require('dgram');
const os = require('os');

const PUERTO_SERVIDOR = 4441;
const PLANTILLA = '7654321';
const CENTINELA_SIN_VUELTA = 'EF54AB1';

function arg(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}

const pilotos = arg('pilotos', 'Víctor,Ana,Luis,Marta').split(',').map(s => s.trim()).filter(Boolean);
const mediaMs = Math.round(parseFloat(arg('media', '4.5')) * 1000);

// ── Codificación del paquete ─────────────────────────────────────────────

/** Inverso de decodeLapField: ms → 7 chars hex. */
function codificarTiempo(ms) {
  const centenas = Math.floor(ms / 100000) % 10;
  const decenas = Math.floor(ms / 10000) % 10;
  const unidades = Math.floor(ms / 1000) % 10;
  const decimas = Math.floor(ms / 100) % 10;
  const centesimas = Math.floor(ms / 10) % 10;
  const milesimas = ms % 10;
  const digitos = [decimas, decenas, milesimas, centesimas, centenas, unidades, 0];
  return digitos.map((d, i) => (d ^ parseInt(PLANTILLA[i], 16)).toString(16).toUpperCase()).join('');
}

// El paquete va en ASCII: quitamos tildes para que el nombre ocupe 1 byte/char.
function ascii(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?');
}

function paquete({ secuencia, carril, nombre, ms, nueva }) {
  const s =
    String(secuencia % 10000).padStart(4, '0') +
    String(carril) +
    ascii(nombre).slice(0, 20).padEnd(20, ' ') +
    '     ' +
    (ms == null ? CENTINELA_SIN_VUELTA : codificarTiempo(ms)) +
    ' ' +
    '      ' +
    (nueva ? '1' : 'X') +
    String(carril).padStart(3, '0') +
    '    ';
  if (s.length !== 52) throw new Error(`paquete de ${s.length} bytes`);
  return Buffer.from(s, 'ascii');
}

// ── Estado de la "pista" ─────────────────────────────────────────────────

const carriles = pilotos.map((nombre, i) => ({
  carril: i + 1,
  nombre,
  ritmo: mediaMs + (i - pilotos.length / 2) * 120,  // cada piloto con su ritmo
  ultimaMs: null,
  secuencia: 0,
  vueltas: 0,
}));
let secuenciaGlobal = 1;
const clientes = new Map();   // "ip:puerto" → { address, port }

const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

function enviarATodos(buf) {
  for (const c of clientes.values()) sock.send(buf, c.port, c.address);
}

function enviarEstado(c, nueva) {
  enviarATodos(paquete({ secuencia: c.secuencia, carril: c.carril, nombre: c.nombre, ms: c.ultimaMs, nueva }));
}

function programarVuelta(c) {
  const ms = Math.round(c.ritmo + (Math.random() - 0.5) * 400 + (Math.random() < 0.08 ? 1500 : 0));
  setTimeout(() => {
    c.ultimaMs = ms;
    c.secuencia = secuenciaGlobal++;
    c.vueltas += 1;
    // Como el Gestor real: el mismo estado se reenvía varias veces.
    for (let k = 0; k < 3; k++) setTimeout(() => enviarEstado(c, k === 0), k * 80);
    if (clientes.size > 0) {
      console.log(`  carril ${c.carril} ${c.nombre.padEnd(10)} vuelta ${String(c.vueltas).padStart(3)}  ${(ms / 1000).toFixed(3)} s`);
    }
    programarVuelta(c);
  }, ms);
}

// ── Red ──────────────────────────────────────────────────────────────────

sock.on('error', e => { console.error('Error de socket:', e.message); process.exit(1); });

sock.on('message', (msg, rinfo) => {
  const texto = msg.toString('ascii');
  if (!texto.startsWith('InfoLap:C')) {
    console.log(`? Paquete desconocido de ${rinfo.address}:${rinfo.port} (${msg.length} B): ${JSON.stringify(texto.slice(0, 60))}`);
    return;
  }
  const clave = `${rinfo.address}:${rinfo.port}`;
  if (!clientes.has(clave)) console.log(`→ Probe ${texto} de ${clave} — cliente conectado`);
  clientes.set(clave, { address: rinfo.address, port: rinfo.port });
  const ok = 'OK ' + carriles.map(c => `${ascii(c.nombre)};#${String(c.carril).padStart(3, '0')}`).join('');
  sock.send(Buffer.from(ok, 'ascii'), rinfo.port, rinfo.address);
});

sock.bind(PUERTO_SERVIDOR, () => {
  sock.setBroadcast(true);
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`TicTac antiguo emulado en UDP :${PUERTO_SERVIDOR}  (IP: ${ips.join(', ') || '?'})`);
  console.log(`Pilotos: ${carriles.map(c => `${c.carril}=${c.nombre}`).join('  ')}`);
  console.log('Esperando probes de la app… (Ctrl+C para salir)\n');
  for (const c of carriles) programarVuelta(c);
  // Reposo: cada carril repite su último estado (~1 s), como el Gestor real.
  setInterval(() => { for (const c of carriles) enviarEstado(c, false); }, 1000);
});
