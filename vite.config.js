import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

function getVersionInfo() {
  let commit = 'unknown';
  let commitShort = 'unknown';
  let commitDate = null;
  try {
    commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    commitShort = commit.slice(0, 7);
    commitDate = execSync('git log -1 --format=%cI', { encoding: 'utf8' }).trim();
  } catch {
    // git not available; fall through with defaults
  }
  return {
    commit,
    commitShort,
    commitDate,
    builtAt: new Date().toISOString(),
  };
}

function versionPlugin() {
  const version = getVersionInfo();
  const json = JSON.stringify(version, null, 2);
  return {
    name: 'dragon-math-version',
    config() {
      return {
        define: {
          __APP_VERSION__: JSON.stringify(version),
        },
      };
    },
    configureServer(server) {
      server.middlewares.use('/version.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(json);
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: json,
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionPlugin()],
  build: {
    rolldownOptions: {
      output: {
        // Split the big libs out of the app code so they cache across deploys.
        // Groups only relocate modules — they don't force eager loading, so
        // libs used solely by lazy routes (tanstack table in /admin, qrcode in
        // the parent/teacher pages) are still fetched only with those routes.
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'vendor-router', test: /node_modules[\\/]react-router/ },
            { name: 'vendor-table', test: /node_modules[\\/]@tanstack[\\/]/ },
            { name: 'vendor-qrcode', test: /node_modules[\\/]qrcode\.react[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
