import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Server-side unit tests only. The React app has no tests yet, and pointing
    // vitest at src/ would spin up the whole JSX/jsdom pipeline for nothing.
    include: ['server/**/*.test.js'],
    environment: 'node',
    // The test files under server/ are CommonJS (server/package.json pins
    // "type": "commonjs"), so they take describe/it/expect from globals rather
    // than an ESM import.
    globals: true,
  },
})
