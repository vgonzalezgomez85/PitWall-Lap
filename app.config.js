// app.json manda; esto solo cambia la versión de los builds con Radio por
// internet (compilados con EXPO_PUBLIC_RADIO_RELAY_URL) a su línea 1.x. Ver
// scripts/version-linea.js.
const { versionDelBuild } = require('./scripts/version-linea');

module.exports = ({ config }) => ({
  ...config,
  version: versionDelBuild(config.version, process.env.EXPO_PUBLIC_RADIO_RELAY_URL),
});
