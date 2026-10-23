#!/usr/bin/env node
// Captura del TicTac antiguo (UDP) para descifrar los campos que no usamos.
//
// Se anuncia como cliente InfoLap (como la app), recibe los paquetes de estado
// de 52 bytes y, por cada uno, muestra los campos conocidos (carril, piloto,
// tiempo) y los tramos que aún no sabemos leer: 25–29, 37–43 y 48–51. Marca
// con «*» los tramos que cambian respecto al paquete anterior del mismo carril,
// para cruzarlos con lo que enseña la pantalla del TicTac (posición, vueltas…).
// Todo se guarda además en bruto (hex) en captura-udp-<fecha>.log.
//
// Uso:
//   node tools/infolap-captura.js                 broadcast, ID de la IP local
//   node tools/infolap-captura.js 192.168.1.20    unicast al PC del TicTac
//   node tools/infolap-captura.js --id 087        forzar el ID del probe

const dgram = require('dgram');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PUERTO_CLIENTE = 12543;
const PUERTO_SERVIDOR = 4441;
const PLANTILLA = '7654321';
const SIN_VUELTA = 'EF54AB1';
// Tramos del paquete que todavía no sabemos interpretar.
const DESCONOCIDOS = [[25, 30], [37, 44], [48, 52]];

const args = process.argv.slice(2);
const iId = args.indexOf('--id');
const idForzado = iId >= 0 ? args.splice(iId, 2)[1] : null;
const host = args[0] ?? '255.255.255.255';

// El Gestor de TicTac ignora los probes cuyo ID no es el último octeto de la
// IP del cliente: lo sacamos de la primera IPv4 de la LAN.
function ipLocal() {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const a of iface ?? []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) return a.address;
    }
  }
  return null;
}
const ip = ipLocal();
const id = (idForzado ?? ip?.split('.').pop() ?? '1').padStart(3, '0');
const PROBE = Buffer.from(`InfoLap:C${id}`, 'ascii');

const fecha = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const fichero = path.join(process.cwd(), `captura-udp-${fecha}.log`);
const salida = fs.createWriteStream(fichero, { flags: 'a' });

function hora() {
  return new Date().toISOString().slice(11, 23);
}

function decodificaTiempo(campo) {
  if (campo === SIN_VUELTA) return null;
  const d = [];
  for (let i = 0; i < 7; i++) {
    const n = parseInt(campo[i], 16);
    if (Number.isNaN(n)) return null;
    d.push(n ^ parseInt(PLANTILLA[i], 16));
  }
  if (d.slice(0, 6).some(x => x > 9)) return null;
  return d[4] * 100000 + d[1] * 10000 + d[5] * 1000 + d[0] * 100 + d[3] * 10 + d[2];
}

const anteriores = new Map();   // carril → tramos desconocidos del último paquete

function muestraEstado(buf) {
  const s = buf.toString('latin1');
  const carril = s.slice(4, 5);
  const piloto = s.slice(5, 25).trimEnd();
  const ms = decodificaTiempo(s.slice(30, 37));
  const tiempo = ms == null ? '   —   ' : (ms / 1000).toFixed(3).padStart(7);
  const tramos = DESCONOCIDOS.map(([a, b]) => s.slice(a, b));
  const prev = anteriores.get(carril);
  anteriores.set(carril, tramos);
  const txt = tramos
    .map((t, i) => `${prev && prev[i] !== t ? '*' : ' '}[${DESCONOCIDOS[i][0]}] ${JSON.stringify(t)}`)
    .join('  ');
  console.log(`${hora()} sec=${s.slice(0, 4)} c${carril} ${piloto.padEnd(20)} ${tiempo} nueva=${s[44]}  ${txt}`);
}

const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
let probeTimer = null;
let ultimoPaquete = 0;

sock.on('error', err => { console.error('[ERR]', err.message); process.exit(1); });

sock.on('message', (msg, rinfo) => {
  ultimoPaquete = Date.now();
  salida.write(`${hora()} ${rinfo.address} len=${msg.length} ${msg.toString('hex')}\n`);
  const texto = msg.toString('latin1');
  if (texto.startsWith('OK ')) {
    console.log(`${hora()} DISCOVERY de ${rinfo.address}: ${texto}`);
    // Como la app: tras el OK no se vuelve a sondear.
    if (probeTimer) { clearInterval(probeTimer); probeTimer = null; }
    return;
  }
  if (msg.length === 52) muestraEstado(msg);
  else console.log(`${hora()} ${rinfo.address} len=${msg.length} ${JSON.stringify(texto)}`);
});

function sondea() {
  sock.send(PROBE, 0, PROBE.length, PUERTO_SERVIDOR, host, err => {
    if (err) console.error('[envío]', err.message);
  });
}

sock.bind(PUERTO_CLIENTE, () => {
  sock.setBroadcast(true);
  console.log(`[*] IP local ${ip ?? '?'} → probe "${PROBE}" a ${host}:${PUERTO_SERVIDOR}`);
  console.log(`[*] Escuchando en UDP :${PUERTO_CLIENTE}; en bruto en ${fichero}`);
  sondea();
  probeTimer = setInterval(sondea, 2000);
  // Si el TicTac deja de mandar (p. ej. se reinició el Gestor), volver a sondear.
  setInterval(() => {
    if (!probeTimer && Date.now() - ultimoPaquete > 15000) {
      console.log(`${hora()} 15 s sin paquetes → vuelvo a sondear`);
      sondea();
      probeTimer = setInterval(sondea, 2000);
    }
  }, 5000);
});

process.on('SIGINT', () => {
  salida.end(() => sock.close(() => process.exit(0)));
});
