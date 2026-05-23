/**
 * Invite link API integration tests
 * Covers GET /api/bracket/:id/invite-link and POST /api/bracket/:id/invite
 */
const request = require('supertest');
const app = require('../../server');
const { connectTestDB, disconnectTestDB } = require('../helpers/db');
const { seedBracket, teardownBracket } = require('../helpers/seed');
const { getTestToken } = require('../helpers/auth');

let bracketId;
let owner1Token;
let unauthToken;

beforeAll(async () => {
  await connectTestDB();
  ({ bracketId, owner1Token } = await seedBracket({ withNames: false }));
  unauthToken = await getTestToken('invite-unrelated');
});

afterAll(async () => {
  await teardownBracket(bracketId, owner1Token);
  await disconnectTestDB();
});

describe('GET /api/bracket/:id/invite-link', () => {
  it('returns 401 when no auth token is provided', async () => {
    const res = await request(app).get(`/api/bracket/${bracketId}/invite-link`);
    expect(res.status).toBe(401);
  });

  it('returns 200 with a shareLink when called by the bracket owner', async () => {
    const res = await request(app)
      .get(`/api/bracket/${bracketId}/invite-link`)
      .set('Authorization', `Bearer ${owner1Token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('shareLink');
    expect(res.body.shareLink).toContain(bracketId);
    expect(res.body.shareLink).toMatch(/share=/);
  });

  it('returns 403 when called by a user who is not an owner of this bracket', async () => {
    const res = await request(app)
      .get(`/api/bracket/${bracketId}/invite-link`)
      .set('Authorization', `Bearer ${unauthToken}`);

    expect(res.status).toBe(403);
  });
});

describe('POST /api/bracket/:id/invite', () => {
  it('returns 200 with invited count when valid emails are provided', async () => {
    const res = await request(app)
      .post(`/api/bracket/${bracketId}/invite`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({ emails: ['test+guest@amidonlabs.com'] });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('invited', 1);
    expect(res.body).toHaveProperty('shareLink');
  });

  it('returns 401 when no auth token is provided', async () => {
    const res = await request(app)
      .post(`/api/bracket/${bracketId}/invite`)
      .send({ emails: ['test+guest@amidonlabs.com'] });

    expect(res.status).toBe(401);
  });

  it('returns 400 when emails array is empty', async () => {
    const res = await request(app)
      .post(`/api/bracket/${bracketId}/invite`)
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({ emails: [] });

    expect(res.status).toBe(400);
  });
});
