/**
 * Jest setup file — runs before each test module is evaluated.
 * Ensures MONGODB_URI points at the test database before server.js is loaded.
 */
require('dotenv').config();

if (process.env.MONGODB_URI_TEST) {
  process.env.MONGODB_URI = process.env.MONGODB_URI_TEST;
}
