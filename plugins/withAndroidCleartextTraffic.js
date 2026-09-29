// Config plugin: permite tráfico HTTP sin cifrar (cleartext) en Android.
//
// PitWall Manager se sirve en la LAN por http://<ip>:puerto (REST + socket.io
// por ws://), sin TLS. Desde Android 9 (API 28) el sistema bloquea cleartext
// por defecto en builds release, así que sin este flag la app no puede
// conectar con el servidor ni por autobúsqueda mDNS ni escribiendo la IP a
// mano — ambos caminos acaban en el mismo fetch/socket.io HTTP bloqueado.
// android/ es gitignored y se regenera con `expo prebuild`, de ahí el plugin.

const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withAndroidCleartextTraffic(config) {
  return withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (application) {
      application.$['android:usesCleartextTraffic'] = 'true';
    }
    return cfg;
  });
};
