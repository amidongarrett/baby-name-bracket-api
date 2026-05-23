/**
 * Jest global setup — runs once before all test suites.
 * Connects to the test MongoDB instance.
 */
require('dotenv').config();
const { connectTestDB } = require('../helpers/db');

module.exports = async function globalSetup() {
  await connectTestDB();
};
