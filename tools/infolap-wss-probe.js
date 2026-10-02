#!/usr/bin/env node
// Cliente mínimo del InfoLap NUEVO de TicTac (WebSocket sobre TLS) para
// reverse-engineering. Sin dependencias: TLS de Node + framing WS a mano.
//
// El TicTac escucha en wss://<pc>:12543/ con un certificado autofirmado
// (CN=InfoLapServer) y empuja mensajes JSON (CONFIG / LAP / RIVALS_UPDATE,
// ver src/data/infolapWss.ts). No hace falta mandarle nada tras conectar.
//
// Uso:
//   node tools/infolap-wss-probe.js <ip-del-pc> [segundos]
//   (y pulsa "Test de transmisión de datos" en el TicTac o arranca carrera)
//   segundos = 0 → graba hasta Ctrl+C. Para analizarlo luego:
//   node tools/infolap-wss-probe.js <ip> 0 | tee captura.log
//   node tools/infolap-wss-analyze.js captura.log

const tls = require('tls');
const crypto = require('crypto');

const HOST = process.argv[2] || '192.168.10.144';
const DURATION_S = process.argv[3] != null ? Number(process.argv[3]) : 120;
const PORT = 12543;

const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(3).padStart(8);

// Frame cliente (enmascarado, obligatorio en WS).
function frame(opcode, payload) {
  const mask = crypto.randomBytes(4);
  const p = Buffer.from(payload);
  for (let i = 0; i < p.length; i++) p[i] ^= mask[i % 4];
  let head;
  if (p.length < 126) {
    head = Buffer.from([0x80 | opcode, 0x80 | p.length]);
  } else {
    head = Buffer.alloc(4);
    head[0] = 0x80 | opcode; head[1] = 0x80 | 126; head.writeUInt16BE(p.length, 2);
  }
  return Buffer.concat([head, mask, p]);
}

let buf = Buffer.alloc(0);
let upgraded = false;

const sock = tls.connect({ host: HOST, port: PORT, rejectUnauthorized: false }, () => {
  const cert = sock.getPeerCertificate();
  console.log(`${ts()} TLS ${sock.getProtocol()} cert CN=${cert.subject && cert.subject.CN}`);
  sock.write(
    `GET / HTTP/1.1\r\nHost: ${HOST}:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
    `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
});

sock.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  if (!upgraded) {
    const end = buf.indexOf('\r\n\r\n');
    if (end < 0) return;
    console.log(`${ts()} ${buf.slice(0, end).toString().split('\r\n')[0]}`);
    buf = buf.slice(end + 4);
    upgraded = true;
  }
  while (buf.length >= 2) {
    const op = buf[0] & 0x0f;
    let len = buf[1] & 0x7f;
    let off = 2;
    if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
    if (buf[1] & 0x80) off += 4;
    if (buf.length < off + len) return;
    const payload = buf.slice(off, off + len);
    buf = buf.slice(off + len);
    if (op === 0x9) { sock.write(frame(0xa, payload)); continue; }  // ping → pong
    if (op === 0xa) continue;                                        // keep-alive del server
    if (op === 0x8) { console.log(`${ts()} CLOSE`); continue; }
    console.log(`${ts()} ${payload.toString('utf8')}`);
  }
});

sock.on('error', (e) => console.log(`${ts()} error: ${e.message}`));
sock.on('close', () => { console.log(`${ts()} cerrado`); process.exit(0); });
if (DURATION_S > 0) setTimeout(() => process.exit(0), DURATION_S * 1000);
