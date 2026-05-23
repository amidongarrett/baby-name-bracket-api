/**
 * Jest configuration for API integration tests.
 *
 * Run: npm test
 *
 * Uses supertest against the Express app directly (no real server port needed).
 * Requires a running MongoDB instance; point MONGODB_URI_TEST at a test database
 * to avoid polluting production data. Falls back to MONGODB_URI if not set.
 *
 * Each test file manages its own DB connection lifecycle via connectTestDB() /
 * disconnectTestDB() in beforeAll / afterAll — no global setup needed.
 */
'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/api/**/*.test.js'],
  testTimeout: 20000,
  // Run suites sequentially to share the mongoose connection state correctly
  maxWorkers: 1,
  // Patch environment before any module is loaded in the worker process
  setupFiles: ['./tests/setup/envSetup.js'],
  verbose: false,
  // Allow Jest to transform uuid (ESM-only in v9+) via Babel
  transformIgnorePatterns: ['/node_modules/(?!(uuid)/)'],
};
