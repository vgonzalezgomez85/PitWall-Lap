#!/usr/bin/env node
// Emulador mínimo de cliente InfoLap (Tic Tac Slot) para reverse-engineering.
// - Hace bind UDP en :12543 (puerto fijo del cliente Infolap).
// - Broadcastea "InfoLap:C<NNN>" a 255.255.255.255:4441 cada 2 s.
// - Vuelca cada datagrama recibido como hex + ASCII con timestamp ms.

const dgram = require('dgram');
const os = require('os');

const CLIENT_PORT = 12543;
const SERVER_PORT = 4441;

// Derivar el ID "CXXX" del último octeto de la IP local
function localLastOctet() {
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const a of iface) {
      if (a.family === 'IPv4' && !a.internal && a.address.startsWith('192.168.10.')) {
        return a.address.split('.').pop().padStart(3, '0');
      }
    }
  }
  return '087';
}
const PROBE = Buffer.from('InfoLap:C' + localLastOctet(), 'ascii');

function hexAscii(buf) {
  const hex = [];
  const ascii = [];
  for (let i = 0; i < buf.length; i++) {
    hex.push(buf[i].toString(16).padStart(2, '0'));
    const c = buf[i];
    ascii.push(c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.');
  }
  return { hex: hex.join(' '), ascii: ascii.join('') };
}

const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

sock.on('error', err => { console.error('[ERR]', err); process.exit(1); });

sock.on('message', (msg, rinfo) => {
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  const { hex, ascii } = hexAscii(msg);
  console.log(`[${ts}] from ${rinfo.address}:${rinfo.port} len=${msg.length}`);
  console.log(`  HEX:   ${hex}`);
  console.log(`  ASCII: ${ascii}`);
});

sock.bind(CLIENT_PORT, () => {
  sock.setBroadcast(true);
  console.log(`[*] Listening on UDP :${CLIENT_PORT}`);
  console.log(`[*] Probe payload: "${PROBE.toString()}" (${PROBE.length} bytes)`);
  console.log(`[*] Broadcasting to 255.255.255.255:${SERVER_PORT} every 2 s`);
  console.log('');

  const send = () => {
    sock.send(PROBE, 0, PROBE.length, SERVER_PORT, '255.255.255.255', err => {
      if (err) console.error('[send err]', err.message);
    });
  };
  send();
  setInterval(send, 2000);
});

process.on('SIGINT', () => {
  console.log('\n[*] Bye.');
  sock.close(() => process.exit(0));
});
