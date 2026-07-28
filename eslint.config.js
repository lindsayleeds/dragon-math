import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

// This repo is two runtimes in one tree, so globals are granted per-runtime and
// never repo-wide: `no-undef` only earns its keep if a browser file referencing
// `process` (or a server file referencing `document`) is still an error.
export default defineConfig([
  globalIgnores(['dist']),
  {
    // Baseline rules for every JS/JSX file, whatever its runtime. No globals
    // here — the runtime-specific blocks below supply them.
    files: ['**/*.{js,jsx,cjs,mjs}'],
    extends: [js.configs.recommended],
    rules: {
      // `const { [id]: _drop, ...rest } = state` is how the admin tables remove
      // one key from a state object. Discarding that sibling IS the operation,
      // so it is not a finding; every other unused-variable case still is,
      // because this only exempts siblings of a rest element.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    // The browser bundle: everything Vite ships to the client.
    files: ['src/**/*.{js,jsx}', 'solve-game.js'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      globals: {
        ...globals.browser,
        __APP_VERSION__: 'readonly',
      },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // The Express server and the `.cjs` scripts/configs are CommonJS on Node.
    files: ['server/**/*.js', '**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  {
    // Node-executed ESM: the build/tool configs at the repo root and the
    // scripts/ helpers that are run with `node`, not bundled for the browser.
    files: ['*.config.js', 'eslint.config.js', 'scripts/**/*.{js,mjs}'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    // Server-side tests (`npm test`) run in Node under vitest, not the browser.
    // ESM, so this has to re-assert sourceType over the CommonJS block above.
    files: ['**/*.test.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node, ...globals.vitest },
    },
  },
])
