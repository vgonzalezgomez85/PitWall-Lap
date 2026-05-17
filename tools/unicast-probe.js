#!/usr/bin/env node
// Igual que infolap-probe.js pero envía UNICAST a una IP concreta en vez de
// broadcast. Sirve para comprobar si el Gestor de Carreras responde a
// probes unicast o sólo a broadcasts.

const dgram = require('dgram');
const TARGET_HOST = process.argv[2] || '192.168.10.99';
const TARGET_PORT = 4441;
const CLIENT_PORT = 12543;
const PROBE = Buffer.from('InfoLap:C087', 'ascii');

const sock = dgram.createSocket('udp4');

sock.on('error', e => { console.error('error:', e); process.exit(1); });
sock.on('message', (msg, rinfo) => {
  console.log(`[${new Date().toISOString().slice(11, 23)}] from ${rinfo.address}:${rinfo.port} len=${msg.length}`);
  console.log(`  ASCII: ${msg.toString('ascii')}`);
});

sock.bind(CLIENT_PORT, () => {
  console.log(`[*] Listening on UDP :${CLIENT_PORT}, sending UNICAST to ${TARGET_HOST}:${TARGET_PORT}`);
  const send = () => sock.send(PROBE, 0, PROBE.length, TARGET_PORT, TARGET_HOST, (err) => {
    if (err) console.error('send err:', err.message);
  });
  send();
  setInterval(send, 2000);
});
