import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Two suites in one tree, and they cannot share an environment: the server tests
// are CommonJS on Node and must NOT get a DOM, while the React tests need jsdom
// and the JSX transform. `projects` keeps them separate but still runs both from
// one `npm test`, so CI has a single gate.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          include: ['server/**/*.test.js'],
          environment: 'node',
          // The test files under server/ are CommonJS (server/package.json pins
          // "type": "commonjs"), so they take describe/it/expect from globals
          // rather than an ESM import.
          globals: true,
        },
      },
      {
        // React needs its own plugin here: this project does not inherit the
        // root vite.config.js, so without it every .jsx import fails to parse.
        plugins: [react()],
        test: {
          name: 'web',
          include: ['src/**/*.test.{js,jsx}'],
          environment: 'jsdom',
          globals: true,
          setupFiles: ['src/test/setup.js'],
          // jsdom is per-file, so state that leaks through the DOM or through
          // localStorage would make one test's failure depend on another's
          // order. The setup file clears both between tests.
          restoreMocks: true,
        },
      },
    ],
  },
})
