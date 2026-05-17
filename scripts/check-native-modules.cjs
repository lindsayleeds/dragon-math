// Verify native modules match the current Node ABI. If better-sqlite3 was
// compiled for a different Node version (common after NVM switches or system
// Node upgrades), rebuild it. No-op when everything is in sync, so it's safe
// to run as a predev hook on every startup.

try {
  require('better-sqlite3');
} catch (e) {
  const isAbiMismatch =
    e.code === 'ERR_DLOPEN_FAILED' ||
    /NODE_MODULE_VERSION/.test(e.message || '');
  if (!isAbiMismatch) throw e;

  console.log('[check-native-modules] ABI mismatch — rebuilding better-sqlite3...');
  require('child_process').execSync('npm rebuild better-sqlite3', { stdio: 'inherit' });
  console.log('[check-native-modules] Rebuild complete.');
}
