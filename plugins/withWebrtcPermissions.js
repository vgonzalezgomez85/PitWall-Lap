// Config plugin: permisos Android que WebRTC necesita y que no añaden los
// config plugins de expo-audio / expo-image-picker.
//
//   • CHANGE_NETWORK_STATE — WebRTC lo usa para gestionar la red móvil.
//   • BLUETOOTH_CONNECT (Android 12+) y BLUETOOTH / BLUETOOTH_ADMIN (≤ 30) —
//     para que la voz salga por cascos Bluetooth.
//
// `android/` es gitignored y se regenera con `expo prebuild`, de ahí que se
// haga con un plugin en vez de tocar el manifest a mano.

const { withAndroidManifest } = require('@expo/config-plugins');

const PERMISOS = [
  { nombre: 'android.permission.CHANGE_NETWORK_STATE' },
  { nombre: 'android.permission.BLUETOOTH_CONNECT' },
  { nombre: 'android.permission.BLUETOOTH', maxSdkVersion: '30' },
  { nombre: 'android.permission.BLUETOOTH_ADMIN', maxSdkVersion: '30' },
];

const PERMISOS_MICRO = ['android.permission.RECORD_AUDIO'];

module.exports = function withWebrtcPermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    // Algún plugin del prebuild deja RECORD_AUDIO marcado con
    // tools:node="remove": el APK salía SIN permiso de micrófono, getUserMedia
    // fallaba en Android y la voz de Radio se quedaba en «Conectando voz…» en
    // los dos móviles (sin micro no hay oferta WebRTC). Se quita la marca y se
    // declara el permiso de forma normal.
    manifest['uses-permission'] = (manifest['uses-permission'] || []).filter(
      (p) => !(p.$?.['android:name'] === 'android.permission.RECORD_AUDIO' && p.$?.['tools:node'] === 'remove'),
    );
    PERMISOS_MICRO.forEach((nombre) => {
      if (!manifest['uses-permission'].some((p) => p.$?.['android:name'] === nombre)) {
        manifest['uses-permission'].push({ $: { 'android:name': nombre } });
      }
    });
    const usos = manifest['uses-permission'];
    const presentes = new Set(usos.map((p) => p.$?.['android:name']));

    for (const p of PERMISOS) {
      if (presentes.has(p.nombre)) continue;
      const $ = { 'android:name': p.nombre };
      if (p.maxSdkVersion) $['android:maxSdkVersion'] = p.maxSdkVersion;
      usos.push({ $ });
    }

    // Declara el micrófono como opcional (no excluye dispositivos sin micro).
    const features = (manifest['uses-feature'] = manifest['uses-feature'] || []);
    if (!features.some((f) => f.$?.['android:name'] === 'android.hardware.microphone')) {
      features.push({ $: { 'android:name': 'android.hardware.microphone', 'android:required': 'false' } });
    }

    return cfg;
  });
};
