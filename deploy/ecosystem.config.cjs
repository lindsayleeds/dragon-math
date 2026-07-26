// pm2 application definition for a released-artifact deployment.
//
// Read on the TARGET box by deploy/release.sh (`pm2 startOrReload`). It is
// shipped inside each release, so the config that starts a release is the
// config that release was built with.
//
// Everything is driven by DM_* environment variables that release.sh exports,
// so the same file serves any target. The defaults describe the test box.
//
// Secrets are NOT here. The app loads them with dotenv from `<cwd>/.env`, which
// each release symlinks to shared/.env — so a rollback re-uses the current
// secrets rather than restoring a release's stale copy.

const ROOT = process.env.DM_ROOT || '/srv/dragon-math';
const instances = Number(process.env.DM_PM2_INSTANCES || 2);

module.exports = {
  apps: [
    {
      name: process.env.DM_PM2_APP || 'dragonmath-api-test',

      // Deliberately pointed through the `current` symlink rather than at a
      // release path. pm2 stores this string verbatim (path.resolve is lexical,
      // it does not resolve symlinks), so each respawn re-reads the symlink —
      // which is what lets `rollback.sh` swap `current` and `pm2 reload` be the
      // whole rollback.
      script: `${ROOT}/current/server/index.js`,
      cwd: `${ROOT}/current`,

      // Cluster mode with >1 instance is the point: `pm2 reload` cycles workers
      // one at a time, so the listening socket is never empty and a deploy is
      // zero-downtime. Fork mode with a single process drops every in-flight
      // request on every deploy.
      exec_mode: process.env.DM_PM2_EXEC_MODE || 'cluster',
      instances,

      // Give a booting worker time to open its listener before pm2 considers
      // the reload finished, and let a retiring worker drain in-flight requests.
      listen_timeout: 10000,
      kill_timeout: 8000,

      // A crash loop should not hammer the DB pool.
      min_uptime: 20000,
      max_restarts: 10,
      restart_delay: 2000,
      autorestart: true,
      watch: false,

      max_memory_restart: '600M',

      merge_logs: true,
      time: true,

      env: {
        // Not in shared/.env on purpose: these are properties of the *box and
        // process topology*, not secrets, so they belong in version control.
        NODE_ENV: 'production',
        API_PORT: process.env.DM_API_PORT || '4070',
        // Keeps the port off the public interface; nginx proxies to it.
        API_HOST: process.env.DM_API_HOST || '127.0.0.1',

        // Belt and braces. shared/.env also sets ENABLE_CRON=0; setting it here
        // too means a hand-edited shared/.env cannot quietly arm the weekly
        // parent digest on a non-production box. server/lib/cronSchedule.js
        // treats an explicit 0 as authoritative even under NODE_ENV=production,
        // and only cluster instance 0 would ever schedule.
        ...(process.env.DM_ENVIRONMENT === 'production' ? {} : { ENABLE_CRON: '0' }),
      },
    },
  ],
};
