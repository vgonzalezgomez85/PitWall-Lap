// Dos líneas de versiones con el mismo código (ver relay/README.md):
//   • Pública (sin Radio por internet): la de app.json, 2.x.y.
//   • Con Radio por internet (compilada con EXPO_PUBLIC_RADIO_RELAY_URL): la
//     misma con mayor 1, siguiendo tras la 1.24.2: 2.M.P → 1.(25+M).P.
// TestFlight las trata como trenes de versión distintos, y cada grupo recibe
// la suya. Lo usan app.config.js, los scripts de build y testflight-grupos.js.

/** Primera versión menor de la línea 1.x que corresponde a la 2.0.0. */
const MENOR_BASE_INTERNET = 25;

function partes(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
  if (!m) throw new Error(`versión no válida: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Versión de la línea con Radio por internet para una versión pública 2.x. */
function versionInternet(publica) {
  const [mayor, menor, parche] = partes(publica);
  if (mayor !== 2) throw new Error(`la línea pública debe ser 2.x (es ${publica})`);
  return `1.${MENOR_BASE_INTERNET + menor}.${parche}`;
}

/** Versión pública (la de app.json y el CHANGELOG) de un build de cualquier
 *  línea. Las 1.x anteriores a la separación se devuelven tal cual. */
function versionPublica(version) {
  const [mayor, menor, parche] = partes(version);
  if (mayor === 1 && menor >= MENOR_BASE_INTERNET) return `2.${menor - MENOR_BASE_INTERNET}.${parche}`;
  return `${mayor}.${menor}.${parche}`;
}

/** Versión con la que se compila: la pública, o la 1.x si el build trae el relé. */
function versionDelBuild(publica, urlRelay) {
  return urlRelay && String(urlRelay).trim() ? versionInternet(publica) : publica;
}

module.exports = { MENOR_BASE_INTERNET, versionInternet, versionPublica, versionDelBuild };
