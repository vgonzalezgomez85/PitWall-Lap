// Config plugin: adopta el ciclo de vida de UIScene en iOS.
//
// Al compilar con el SDK de iOS 27 (Xcode 27), una app que no declara escenas
// muere al arrancar con EXC_BREAKPOINT en
// `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`. El
// AppDelegate que genera Expo (SDK 54) crea la ventana a la antigua, con
// `UIWindow(frame:)` en `didFinishLaunching`. Este plugin, durante
// `expo prebuild`:
//   1. declara `UIApplicationSceneManifest` en el Info.plist con un
//      `SceneDelegate`;
//   2. quita del AppDelegate la creación de la ventana y la pasa al
//      `SceneDelegate`, que arranca React Native en la ventana de la escena;
//   3. sube a 15.1 el deployment target de los pods que lo tienen más bajo
//      (Xcode 27 rechaza cualquier target < 15.0 y el build falla).

const { withAppDelegate, withInfoPlist, withPodfile } = require('@expo/config-plugins');

const TARGET_MINIMO_PODS = '15.1';

const ARRANQUE_EN_VENTANA = /#if os\(iOS\) \|\| os\(tvOS\)\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\s*factory\.startReactNative\([\s\S]*?\)\s*#endif\n?/;

const SCENE_DELEGATE = `
// Añadido por plugins/withSceneLifecycle.js: la ventana la crea la escena.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let appDelegate = UIApplication.shared.delegate as? AppDelegate,
          let factory = appDelegate.reactNativeFactory else { return }

    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: nil)

    for contexto in connectionOptions.urlContexts {
      RCTLinkingManager.application(UIApplication.shared, open: contexto.url, options: [:])
    }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for contexto in URLContexts {
      RCTLinkingManager.application(UIApplication.shared, open: contexto.url, options: [:])
    }
  }
}
`;

const POST_INSTALL_TARGET = `
    # Añadido por plugins/withSceneLifecycle.js: Xcode 27 exige iOS >= 15.0.
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        actual = build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if actual.nil? || Gem::Version.new(actual) < Gem::Version.new('${TARGET_MINIMO_PODS}')
          build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${TARGET_MINIMO_PODS}'
        end
      end
    end
`;

function conManifiestoDeEscenas(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return cfg;
  });
}

function conSceneDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error('withSceneLifecycle: se esperaba un AppDelegate en Swift.');
    }
    let codigo = cfg.modResults.contents;
    if (codigo.includes('class SceneDelegate')) return cfg;
    if (!ARRANQUE_EN_VENTANA.test(codigo)) {
      throw new Error(
        'withSceneLifecycle: no se encuentra el arranque de React Native en el AppDelegate; ' +
          'revisa el plugin tras actualizar Expo.',
      );
    }
    codigo = codigo.replace(ARRANQUE_EN_VENTANA, '');
    cfg.modResults.contents = codigo.trimEnd() + '\n' + SCENE_DELEGATE;
    return cfg;
  });
}

function conTargetMinimoEnPods(config) {
  return withPodfile(config, (cfg) => {
    let podfile = cfg.modResults.contents;
    if (podfile.includes('withSceneLifecycle')) return cfg;
    const ancla = /(react_native_post_install\([\s\S]*?\n\s*\))/;
    if (!ancla.test(podfile)) {
      throw new Error('withSceneLifecycle: no se encuentra react_native_post_install en el Podfile.');
    }
    podfile = podfile.replace(ancla, `$1\n${POST_INSTALL_TARGET}`);
    cfg.modResults.contents = podfile;
    return cfg;
  });
}

module.exports = function withSceneLifecycle(config) {
  return conTargetMinimoEnPods(conSceneDelegate(conManifiestoDeEscenas(config)));
};
