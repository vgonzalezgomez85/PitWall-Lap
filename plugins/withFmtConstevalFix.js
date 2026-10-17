// Config plugin: parchea `fmt` (dependencia de RCT-Folly) para que compile con
// el clang de Xcode 26/27 al construir React Native desde fuente.
//
// Con `newArchEnabled: false`, RN deja de usar el core precompilado y compila
// folly/fmt/glog desde fuente. `fmt` 11.0.2 detecta `__cpp_consteval` y activa
// `FMT_USE_CONSTEVAL`, pero esa optimización está rota en el clang reciente de
// Apple y revienta compilando `fmt/src/format.cc`:
//
//   error: call to consteval function 'fmt::basic_format_string<...>'
//          is not a constant expression
//
// El parche fuerza `FMT_USE_CONSTEVAL 0` (solo desactiva esa optimización y
// cae a la ruta no-consteval). Se aplica en `post_install`, cuando los pods ya
// están descargados, para que sobreviva al `pod install` que hace el script de
// release. ios/ es gitignored y se regenera con `expo prebuild`, de ahí el
// plugin en lugar de editar el Podfile a mano.

const { withPodfile } = require('@expo/config-plugins');

const MARCA = 'withFmtConstevalFix';

const PARCHES = `
    # Añadido por plugins/${MARCA}.js: fmt 11.0.2 rompe con el clang de Xcode
    # 26/27 (consteval) al compilar RN desde fuente. Forzamos FMT_USE_CONSTEVAL 0.
    fmt_base = File.join(installer.sandbox.root, 'fmt', 'include', 'fmt', 'base.h')
    if File.exist?(fmt_base)
      contenido_fmt = File.read(fmt_base)
      unless contenido_fmt.include?('${MARCA}')
        parcheado = contenido_fmt.gsub(
          "#elif defined(__cpp_consteval)\\n#  define FMT_USE_CONSTEVAL 1",
          "#elif defined(__cpp_consteval)\\n#  define FMT_USE_CONSTEVAL 0 // ${MARCA} (clang de Apple reciente)"
        )
        if parcheado != contenido_fmt
          File.chmod(0o644, fmt_base)
          File.write(fmt_base, parcheado)
          Pod::UI.puts('${MARCA}: FMT_USE_CONSTEVAL=0 aplicado en fmt')
        end
      end
    end
`;

module.exports = function withFmtConstevalFix(config) {
  return withPodfile(config, (cfg) => {
    const podfile = cfg.modResults.contents;
    if (podfile.includes(MARCA)) {
      return cfg;
    }
    const ancla = /(react_native_post_install\([\s\S]*?\n\s*\))/;
    if (!ancla.test(podfile)) {
      throw new Error(`${MARCA}: no se encuentra react_native_post_install en el Podfile.`);
    }
    cfg.modResults.contents = podfile.replace(ancla, `$1\n${PARCHES}`);
    return cfg;
  });
};
