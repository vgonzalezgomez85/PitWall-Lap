#!/usr/bin/env node
// Listener mínimo en UDP :4441 para confirmar si el iPhone realmente envía
// paquetes UDP unicast al puerto 4441.
//
// Uso:
//   1. Lanzar este script en el Mac.
//   2. En la app del iPhone, meter la IP del Mac (192.168.10.87) en el
//      campo de "IP manual" y pulsar conectar.
//   3. Si llega algo aquí → iOS sí envía UDP. El problema está en el PC
//      Windows (firewall) o en su respuesta.
//   4. Si no llega nada → iOS está silenciando el envío.

const dgram = require('dgram');
const PORT = 4441;
const sock = dgram.createSocket('udp4');

sock.on('error', e => { console.error('error:', e); process.exit(1); });

sock.on('message', (msg, rinfo) => {
  console.log(`[${new Date().toISOString().slice(11, 23)}] from ${rinfo.address}:${rinfo.port} len=${msg.length}`);
  console.log(`  ASCII: ${msg.toString('ascii')}`);
});

sock.bind(PORT, () => {
  console.log(`[*] Listening on UDP :${PORT}`);
});
