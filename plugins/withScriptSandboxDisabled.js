// Config plugin: desactiva el User Script Sandboxing de Xcode.
//
// Con el sandboxing activado (por defecto en Xcode reciente), la fase
// "Bundle React Native code and images" no puede escribir `ip.txt` dentro
// del .app y el build falla ("Sandbox: deny file-write-create ... ip.txt").
// Este plugin lo pone a NO en TODAS las configuraciones del proyecto durante
// `expo prebuild`, para que el ajuste sea permanente (ios/ es gitignored).

const { withXcodeProject } = require('@expo/config-plugins');

module.exports = function withScriptSandboxDisabled(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const configurations = project.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configurations)) {
      const entry = configurations[key];
      if (entry && typeof entry === 'object' && entry.buildSettings) {
        entry.buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = 'NO';
      }
    }
    return cfg;
  });
};
