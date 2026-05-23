/**
 * Bracket creation API integration tests
 * Covers POST /api/brackets auth guards, happy path, and validation errors.
 */
const request = require('supertest');
const app = require('../../server');
const { connectTestDB, disconnectTestDB } = require('../helpers/db');
const { getTestToken } = require('../helpers/auth');
const { teardownBracket } = require('../helpers/seed');

let owner1Token;
const createdBracketIds = [];

beforeAll(async () => {
  await connectTestDB();
  owner1Token = await getTestToken('bracketcreate');
});

afterAll(async () => {
  for (const id of createdBracketIds) {
    await teardownBracket(id, owner1Token);
  }
  await disconnectTestDB();
});

describe('POST /api/brackets', () => {
  it('returns 401 when no auth token is provided', async () => {
    const res = await request(app)
      .post('/api/brackets')
      .send({
        owner1Name: 'Alice',
        owner2Name: 'Bob',
        owner2Email: 'test+bob@amidonlabs.com',
      });

    expect(res.status).toBe(401);
  });

  it('returns 201 with bracket data for a valid authenticated request', async () => {
    const res = await request(app)
      .post('/api/brackets')
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({
        owner1Name: 'Alice',
        owner2Name: 'Bob',
        owner2Email: 'test+bob@amidonlabs.com',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('bracket');
    expect(res.body.bracket).toHaveProperty('id');
    expect(res.body.bracket).toHaveProperty('inviteCode');
    expect(res.body.bracket).toHaveProperty('status', 'draft');
    expect(res.body.bracket).toHaveProperty('owner1Name', 'Alice');
    expect(res.body.bracket).toHaveProperty('owner2Name', 'Bob');

    createdBracketIds.push(res.body.bracket.id.toString());
  });

  it('returns 400 when owner2Email is missing', async () => {
    const res = await request(app)
      .post('/api/brackets')
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({
        owner1Name: 'Alice',
        owner2Name: 'Bob',
      });

    expect(res.status).toBe(400);
  });

  it('returns 400 when owner1Name is missing', async () => {
    const res = await request(app)
      .post('/api/brackets')
      .set('Authorization', `Bearer ${owner1Token}`)
      .send({
        owner2Name: 'Bob',
        owner2Email: 'test+bob@amidonlabs.com',
      });

    expect(res.status).toBe(400);
  });
});
