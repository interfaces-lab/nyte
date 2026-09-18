const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

const marker = "// Nyte: the scene delegate creates the window.";
const start = "// @generated begin nyte-scene-lifecycle";
const end = "// @generated end nyte-scene-lifecycle";

module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "NyteSceneDelegate",
          },
        ],
      },
    };
    return mod;
  });
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== "swift") {
      throw new Error("Nyte scene lifecycle requires Expo's Swift AppDelegate template.");
    }
    let source = mod.modResults.contents;
    if (!source.includes(marker)) {
      const launch =
        /#if os\(iOS\) \|\| os\(tvOS\)\s+window = UIWindow\(frame: UIScreen\.main\.bounds\)\s+factory\.startReactNative\(\s+withModuleName: "main",\s+in: window,\s+launchOptions: launchOptions\)\s+#endif/g;
      if ([...source.matchAll(launch)].length !== 1) {
        throw new Error(
          "Expo's AppDelegate launch template changed. Review or remove Nyte's scene lifecycle plugin.",
        );
      }
      source = source.replace(launch, marker);
    }
    const scene = readFileSync(join(__dirname, "NyteSceneDelegate.swift"), "utf8").trimEnd();
    const block = `${start}\n${scene}\n${end}`;
    const previous =
      /\/\/ @generated begin nyte-scene-lifecycle[\s\S]*?\/\/ @generated end nyte-scene-lifecycle/;
    mod.modResults.contents = previous.test(source)
      ? source.replace(previous, () => block)
      : `${source.trimEnd()}\n\n${block}\n`;
    return mod;
  });
};
