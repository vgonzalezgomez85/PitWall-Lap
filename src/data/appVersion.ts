// Versión de la app en runtime.
//
// La fuente real es el manifest con el que se compiló el binario (app.json →
// expo.version), que expo-constants lee del `app.config` embebido en
// build-time: **subir la versión exige reconstruir la app**, no basta con
// recargar Metro. Si el manifest no está disponible (p. ej. bajo jest, donde
// el mock devuelve `{}`, o si la fase de build que lo embebe fallase),
// caemos a la última versión del changelog — el test de sincronía garantiza
// que coincide con app.json.

import Constants from 'expo-constants';

import { latestVersion } from './changelog';

export function getRuntimeVersion(): string | null {
  try {
    const v = Constants.expoConfig?.version;
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function getCurrentVersion(): string {
  return getRuntimeVersion() ?? latestVersion() ?? '—';
}
