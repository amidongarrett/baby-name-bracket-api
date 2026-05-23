/**
 * Bracket generation API integration tests
 * Covers POST /api/bracket/generate: happy path with 32 names and partial-name behavior.
 *
 * Note: generateBracket does NOT enforce exactly 32 names at a hard 400 — it generates
 * preview matchups with placeholders for any count. With exactly 32 names it sets
 * status to 'active'. The test for "fewer than 32" checks that isComplete is false
 * since the controller does not reject the request outright.
 */
const request = require('supertest');
const app = require('../../server');
const { connectTestDB, disconnectTestDB } = require('../helpers/db');
const { seedBracket, teardownBracket } = require('../helpers/seed');

let bracketId;
let owner1Token;

beforeAll(async () => {
  await connectTestDB();
  ({ bracketId, owner1Token } = await seedBracket());
});

afterAll(async () => {
  await teardownBracket(bracketId, owner1Token);
  await disconnectTestDB();
});

describe('POST /api/bracket/generate', () => {
  it('returns 201 with a 16-matchup array when exactly 32 names are present', async () => {
    const res = await request(app)
      .post('/api/bracket/generate')
      .send({ bracketId });

    expect(res.status).toBe(201);
    expect(Array.isArray(res.body.matchups)).toBe(true);
    expect(res.body.matchups).toHaveLength(16);
    expect(res.body.bracket.isComplete).toBe(true);
    expect(res.body.bracket.status).toBe('active');
  });

  it('returns 400 when the bracket is already active (already generated)', async () => {
    // Generate again on the same bracket — should be rejected
    const res = await request(app)
      .post('/api/bracket/generate')
      .send({ bracketId });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/bracket/generate — fewer than 32 names', () => {
  it('generates matchups (with placeholders) but marks isComplete as false', async () => {
    const { bracketId: freshId, owner1Token: freshToken } = await seedBracket({
      owner1Slug: 'gentest-partial',
      withNames: false,
    });

    try {
      // Add only 8 names (fewer than 32)
      for (let i = 1; i <= 4; i++) {
        await request(app)
          .post('/api/names')
          .send({ bracketId: freshId, name: `Partial-O1-${i}`, owner: 'Owner 1' });
      }
      for (let i = 1; i <= 4; i++) {
        await request(app)
          .post('/api/names')
          .send({ bracketId: freshId, name: `Partial-O2-${i}`, owner: 'Owner 2' });
      }

      const res = await request(app)
        .post('/api/bracket/generate')
        .send({ bracketId: freshId });

      expect(res.status).toBe(201);
      expect(res.body.bracket.isComplete).toBe(false);
    } finally {
      await teardownBracket(freshId, freshToken);
    }
  });
});
