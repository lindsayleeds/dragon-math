import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const AGENT_API_DOCS = [
  {
    url: '/agent-api/instructions.txt',
    fileName: 'agent-api/instructions.txt',
    source: new URL('./docs/API_DOCS.md', import.meta.url),
    rewriteLinks: true,
  },
  { url: '/agent-api/reference.txt', fileName: 'agent-api/reference.txt', source: new URL('./docs/API.md', import.meta.url) },
];

function agentApiDocSource(doc) {
  const source = readFileSync(doc.source, 'utf8');
  return doc.rewriteLinks ? source.replaceAll('(API.md)', '(reference.txt)') : source;
}

// Publish the repository's agent brief as plain Markdown. A parent can hand
// this stable URL to any agent, and the agent can fetch the instructions
// without a Dragon Math login or access to this repository.
function agentApiDocsPlugin() {
  return {
    name: 'dragon-math-agent-api-docs',
    configureServer(server) {
      for (const doc of AGENT_API_DOCS) {
        server.middlewares.use(doc.url, (_req, res) => {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(agentApiDocSource(doc));
        });
      }
    },
    generateBundle() {
      for (const doc of AGENT_API_DOCS) {
        this.emitFile({
          type: 'asset',
          fileName: doc.fileName,
          source: agentApiDocSource(doc),
        });
      }
    },
  };
}

function getVersionInfo() {
  let commit = 'unknown';
  let commitShort = 'unknown';
  let commitDate = null;
  // A released artifact is built from an exported tree with no .git, so the
  // deployer stamps the commit it exported instead of letting the build guess.
  // See deploy/release.sh; falls back to ambient git for local `npm run build`.
  if (process.env.DM_COMMIT) {
    commit = process.env.DM_COMMIT.trim();
    commitShort = commit.slice(0, 7);
    commitDate = process.env.DM_COMMIT_DATE?.trim() || null;
    return { commit, commitShort, commitDate, builtAt: new Date().toISOString() };
  }
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
  plugins: [react(), versionPlugin(), agentApiDocsPlugin()],
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
