const fs = require('fs');
const path = require('path');

const {
  withAndroidManifest,
  withMainApplication,
  withDangerousMod,
  AndroidConfig,
} = require('@expo/config-plugins');

/**
 * The package the native sources are written in. Every reference to it in the copied Kotlin and
 * in the MainApplication import is rewritten to `android.package`, so renaming the app package
 * does not require touching the sources.
 */
const SOURCE_PACKAGE = 'com.oxsabbir.snaptrade';

const NATIVE_SOURCE_DIR = path.join(__dirname, 'native', 'snaptrade');

const REQUIRED_PERMISSIONS = [
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
];

const SERVICE_NAME = '.NotificationListener';
const RECEIVER_NAME = '.BootReceiver';

function listKotlinFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listKotlinFiles(full));
    else if (entry.name.endsWith('.kt')) out.push(full);
  }
  return out;
}

/**
 * Copies the committed Kotlin sources into the generated Android project, rewriting the package
 * to match `android.package`. These files are not part of the `expo prebuild` template, so a
 * plain file copy is the only way to get them into the build.
 */
function withSignalSourceFiles(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const packageName = config.android && config.android.package;
      if (!packageName) {
        throw new Error('[withSignalNotifications] android.package is not set in app.json');
      }

      const javaRoot = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java'
      );
      const packageDir = path.join(javaRoot, ...packageName.split('.'));

      for (const sourcePath of listKotlinFiles(NATIVE_SOURCE_DIR)) {
        const contents = fs
          .readFileSync(sourcePath, 'utf8')
          .split(SOURCE_PACKAGE)
          .join(packageName);

        const relative = path.relative(NATIVE_SOURCE_DIR, sourcePath);
        const destination = path.join(packageDir, relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, contents);
      }

      return config;
    },
  ]);
}

/** Declares the listener service, the boot receiver and the permissions they depend on. */
function withSignalManifest(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults;

    for (const permission of REQUIRED_PERMISSIONS) {
      AndroidConfig.Permissions.ensurePermission(manifest, permission);
    }

    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

    app.service = app.service || [];
    if (!app.service.some((entry) => entry.$ && entry.$['android:name'] === SERVICE_NAME)) {
      app.service.push({
        $: {
          'android:name': SERVICE_NAME,
          'android:exported': 'false',
          'android:permission': 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
        },
        'intent-filter': [
          {
            action: [
              { $: { 'android:name': 'android.service.notification.NotificationListenerService' } },
            ],
          },
        ],
      });
    }

    app.receiver = app.receiver || [];
    if (!app.receiver.some((entry) => entry.$ && entry.$['android:name'] === RECEIVER_NAME)) {
      app.receiver.push({
        $: {
          'android:name': RECEIVER_NAME,
          'android:exported': 'true',
          'android:enabled': 'true',
        },
        'intent-filter': [
          { action: [{ $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } }] },
        ],
      });
    }

    return config;
  });
}

/**
 * Registers the native package and asks the OS to re-attach the listener on app start. Both
 * anchors come from the React Native template; a missing anchor throws so a template change
 * fails the prebuild loudly instead of silently shipping without the module.
 */
function withSignalMainApplication(config) {
  return withMainApplication(config, (config) => {
    const packageName = config.android && config.android.package;
    if (!packageName) {
      throw new Error('[withSignalNotifications] android.package is not set in app.json');
    }

    const contents = config.modResults.contents;
    const importLine = `import ${packageName}.notification.NotificationListenerPackage`;
    const rebindLine = 'NotificationListener.requestRebind(this)';

    let next = contents;

    if (!next.includes(importLine)) {
      if (!/^package [^\n]+\n/m.test(next)) {
        throw new Error('[withSignalNotifications] could not find the package declaration in MainApplication');
      }
      next = next.replace(/^(package [^\n]+\n)/m, `$1\n${importLine}\n`);
    }

    if (!next.includes('add(NotificationListenerPackage())')) {
      const anchor = '// add(MyReactNativePackage())';
      if (!next.includes(anchor)) {
        throw new Error('[withSignalNotifications] could not find the package list anchor in MainApplication');
      }
      next = next.replace(anchor, `${anchor}\n          add(NotificationListenerPackage())`);
    }

    if (!next.includes(rebindLine)) {
      if (!next.includes('loadReactNative(this)')) {
        throw new Error('[withSignalNotifications] could not find loadReactNative(this) in MainApplication');
      }
      next = next.replace('loadReactNative(this)', `loadReactNative(this)\n    ${rebindLine}`);
    }

    config.modResults.contents = next;
    return config;
  });
}

module.exports = function withSignalNotifications(config) {
  config = withSignalSourceFiles(config);
  config = withSignalManifest(config);
  config = withSignalMainApplication(config);
  return config;
};
