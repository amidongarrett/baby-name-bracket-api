/**
 * Auth helper for tests.
 * Uses the test-email short-circuit in authController so no real OTP inbox is needed.
 * Any test+<slug>@amidonlabs.com address is accepted with any code value.
 */
const request = require('supertest');
const app = require('../../server');

/**
 * Obtain a signed JWT for a test account.
 * @param {string} slug - The part after "test+" (e.g. "owner1")
 * @returns {Promise<string>} Signed JWT token
 */
async function getTestToken(slug = 'owner1') {
  const email = `test+${slug}@amidonlabs.com`;

  // Step 1: request-code (short-circuits for test emails, no real OTP sent)
  await request(app)
    .post('/api/auth/request-code')
    .send({ email })
    .expect(200);

  // Step 2: verify-code with any code — short-circuit returns a real token
  const res = await request(app)
    .post('/api/auth/verify-code')
    .send({ email, code: '000000' })
    .expect(200);

  if (!res.body.token) {
    throw new Error(`getTestToken: no token returned for ${email}`);
  }

  return res.body.token;
}

module.exports = { getTestToken };
