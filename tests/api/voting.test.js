/**
 * Voting API integration tests
 * Covers POST /api/bracket/:id/my-bracket/pick
 */
const request = require('supertest');
const app = require('../../server');
const { connectTestDB, disconnectTestDB } = require('../helpers/db');
const { seedBracket, teardownBracket } = require('../helpers/seed');
const { getTestToken } = require('../helpers/auth');

let bracketId;
let owner1Token;
let guestToken;
let firstMatchup;

beforeAll(async () => {
  await connectTestDB();

  // Seed a full bracket and generate matchups so picks can be made
  ({ bracketId, owner1Token } = await seedBracket());

  const genRes = await request(app)
    .post('/api/bracket/generate')
    .send({ bracketId });

  firstMatchup = genRes.body.matchups[0];

  // Authenticate a guest voter
  guestToken = await getTestToken('voter-guest');
});

afterAll(async () => {
  await teardownBracket(bracketId, owner1Token);
  await disconnectTestDB();
});

describe('POST /api/bracket/:id/my-bracket/pick', () => {
  it('returns 401 when no auth token is provided', async () => {
    const res = await request(app)
      .post(`/api/bracket/${bracketId}/my-bracket/pick`)
      .send({
        round: 'roundOf32',
        position: 0,
        selectedNameId: firstMatchup.name1Id,
      });

    expect(res.status).toBe(401);
  });

  it('records a valid pick and returns 200 with the updated UserBracket', async () => {
    const res = await request(app)
      .post(`/api/bracket/${bracketId}/my-bracket/pick`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({
        round: 'roundOf32',
        position: 0,
        selectedNameId: firstMatchup.name1Id,
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('picks');
    expect(res.body.picks).toHaveProperty('roundOf32');
    // Position 0 should contain the selected name ID
    expect(res.body.picks.roundOf32[0]).toBe(firstMatchup.name1Id);
  });

  it('returns 400 for an invalid round string', async () => {
    const res = await request(app)
      .post(`/api/bracket/${bracketId}/my-bracket/pick`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({
        round: 'invalidRound',
        position: 0,
        selectedNameId: firstMatchup.name1Id,
      });

    expect(res.status).toBe(400);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post(`/api/bracket/${bracketId}/my-bracket/pick`)
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ round: 'roundOf32' }); // missing position and selectedNameId

    expect(res.status).toBe(400);
  });
});
