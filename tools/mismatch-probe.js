#!/usr/bin/env node
// Manda unicast con "InfoLap:C000" (ID no coincidente con la IP del Mac
// que es .87). Si el Gestor responde igual → formato no es la causa del
// fallo del iPhone. Si NO responde → el Gestor filtra por ID/IP match.

const dgram = require('dgram');
const sock = dgram.createSocket('udp4');
const PROBE = Buffer.from('InfoLap:C000', 'ascii');

sock.on('error', e => { console.error('error:', e); process.exit(1); });
sock.on('message', (msg, rinfo) => {
  console.log(`[${new Date().toISOString().slice(11, 23)}] from ${rinfo.address}:${rinfo.port} len=${msg.length}`);
  console.log(`  ASCII: ${msg.toString('ascii')}`);
});

sock.bind(12543, () => {
  console.log('[*] Sending UNICAST to 192.168.10.99:4441 with payload InfoLap:C000');
  const send = () => sock.send(PROBE, 0, PROBE.length, 4441, '192.168.10.99');
  send();
  setInterval(send, 2000);
});
