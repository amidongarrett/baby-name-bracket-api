/**
 * Auth API integration tests
 * Verifies the test-email short-circuit for OTP-free authentication.
 */
const request = require('supertest');
const app = require('../../server');
const { connectTestDB, disconnectTestDB } = require('../helpers/db');

beforeAll(async () => {
  await connectTestDB();
});

afterAll(async () => {
  await disconnectTestDB();
});

describe('POST /api/auth/request-code', () => {
  it('returns 200 for a test email address', async () => {
    const res = await request(app)
      .post('/api/auth/request-code')
      .send({ email: 'test+authtest@amidonlabs.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Code sent');
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app)
      .post('/api/auth/request-code')
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/verify-code', () => {
  it('returns 200 with a token for a test email (any code accepted)', async () => {
    const email = 'test+authtest@amidonlabs.com';

    // Ensure the user exists first (request-code upserts it)
    await request(app)
      .post('/api/auth/request-code')
      .send({ email });

    const res = await request(app)
      .post('/api/auth/verify-code')
      .send({ email, code: '000000' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).toHaveProperty('id');
    expect(res.body.user).toHaveProperty('email', email);
  });

  it('returns 400 when email or code is missing', async () => {
    const res = await request(app)
      .post('/api/auth/verify-code')
      .send({ email: 'test+authtest@amidonlabs.com' });

    expect(res.status).toBe(400);
  });
});
