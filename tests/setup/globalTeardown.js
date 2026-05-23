/**
 * Jest global teardown — runs once after all test suites complete.
 * Closes the MongoDB connection.
 */
const { disconnectTestDB } = require('../helpers/db');

module.exports = async function globalTeardown() {
  await disconnectTestDB();
};
