/**
 * Release imzasını yerel derlemeye bağlayan Expo config plugin'i.
 *
 * Neden gerekli: `android/` klasörü prebuild ile her seferinde yeniden üretiliyor
 * (.gitignore'da). build.gradle'ı elle düzenlesek bir sonraki prebuild'de silinirdi.
 * Bu plugin, prebuild sırasında imza yapılandırmasını yeniden enjekte eder.
 *
 * Anahtar ve şifreler credentials/keystore.properties dosyasından okunur; o dosya
 * repoya girmez. Dosya yoksa plugin sessizce devre dışı kalır ve derleme eskisi
 * gibi debug anahtarıyla imzalanır (ör. anahtarı olmayan bir geliştirici).
 */
const fs = require('fs');
const path = require('path');
const { withAppBuildGradle, withDangerousMod } = require('@expo/config-plugins');

const CRED_DIR = 'credentials';
const PROPS_FILE = 'keystore.properties';

function readCredentials(projectRoot) {
  const propsPath = path.join(projectRoot, CRED_DIR, PROPS_FILE);
  if (!fs.existsSync(propsPath)) return null;

  const props = {};
  for (const line of fs.readFileSync(propsPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    props[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  if (!props.storeFile || !props.storePassword || !props.keyAlias || !props.keyPassword) {
    return null;
  }
  return props;
}

/** Keystore'u native projeye kopyalar (gradle oradan okur). */
function withKeystoreFile(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const creds = readCredentials(projectRoot);
      if (!creds) {
        console.warn('[release-signing] credentials/keystore.properties yok — debug imza kullanılacak.');
        return cfg;
      }
      const src = path.join(projectRoot, CRED_DIR, creds.storeFile);
      const dest = path.join(cfg.modRequest.platformProjectRoot, 'app', creds.storeFile);
      if (fs.existsSync(src)) fs.copyFileSync(src, dest);
      return cfg;
    },
  ]);
}

/** build.gradle'a release signingConfig'i enjekte eder. */
function withSigningConfig(config) {
  return withAppBuildGradle(config, (cfg) => {
    const creds = readCredentials(cfg.modRequest.projectRoot);
    if (!creds) return cfg;

    let contents = cfg.modResults.contents;
    if (contents.includes('opennewsRelease')) return cfg;   // zaten uygulanmış

    // 1) signingConfigs bloğuna release anahtarını ekle
    contents = contents.replace(
      /signingConfigs\s*\{/,
      `signingConfigs {
        opennewsRelease {
            storeFile file('${creds.storeFile}')
            storePassword '${creds.storePassword}'
            keyAlias '${creds.keyAlias}'
            keyPassword '${creds.keyPassword}'
        }`,
    );

    // 2) release buildType'ı debug yerine bu anahtarla imzala
    contents = contents.replace(
      /(release\s*\{[\s\S]*?signingConfig\s+)signingConfigs\.debug/,
      '$1signingConfigs.opennewsRelease',
    );

    cfg.modResults.contents = contents;
    return cfg;
  });
}

module.exports = function withReleaseSigning(config) {
  return withSigningConfig(withKeystoreFile(config));
};
