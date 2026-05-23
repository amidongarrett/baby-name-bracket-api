/**
 * Test DB helper — manages a single mongoose connection for the entire test suite.
 * Uses MONGODB_URI_TEST if set, falling back to MONGODB_URI.
 * Safe to call multiple times; only the first call connects.
 *
 * Environment patching (MONGODB_URI_TEST → MONGODB_URI) is handled by
 * tests/setup/envSetup.js, which Jest loads via setupFiles before any module runs.
 */
const mongoose = require('mongoose');

let connected = false;

async function connectTestDB() {
  if (connected || mongoose.connection.readyState === 1) {
    connected = true;
    return;
  }

  const uri = process.env.MONGODB_URI_TEST || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'No MongoDB URI found. Set MONGODB_URI_TEST or MONGODB_URI in your .env file.'
    );
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  });

  connected = true;
}

async function disconnectTestDB() {
  if (!connected) return;
  await mongoose.connection.close();
  connected = false;
}

module.exports = { connectTestDB, disconnectTestDB };
