/**
 * Name submission API integration tests
 * Covers POST /api/names: happy path, duplicate detection, and owner limit.
 *
 * Note: The controller uses { name, owner, bracketId } — not { value, submittedBy }.
 * The response for a successful non-duplicate add is:
 *   { isDuplicate: false, name: { id, value, submittedBy, isShared, createdAt }, ... }
 * A duplicate returns isDuplicate: true with the sharedName entry.
 * Exceeding 16 names sends the name to the bank (isBanked: true, status 201) rather than 400.
 */
const request = require('supertest');
const app = require('../../server');
const { connectTestDB, disconnectTestDB } = require('../helpers/db');
const { seedBracket, teardownBracket } = require('../helpers/seed');

let bracketId;
let owner1Token;

beforeAll(async () => {
  await connectTestDB();
  // Seed a bracket with NO names so we control submissions in these tests
  ({ bracketId, owner1Token } = await seedBracket({ withNames: false }));
});

afterAll(async () => {
  await teardownBracket(bracketId, owner1Token);
  await disconnectTestDB();
});

describe('POST /api/names — happy path', () => {
  it('adds a name for Owner 1 and returns the name object', async () => {
    const res = await request(app)
      .post('/api/names')
      .send({ bracketId, name: 'Unique-Name-Alpha', owner: 'Owner 1' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('name');
    expect(res.body.name).toHaveProperty('id');
    expect(res.body.name).toHaveProperty('value', 'Unique-Name-Alpha');
    expect(res.body.name).toHaveProperty('submittedBy', 'Owner 1');
    expect(res.body.name).toHaveProperty('isShared', false);
    expect(res.body.isDuplicate).toBe(false);
  });
});

describe('POST /api/names — duplicate detection', () => {
  it('marks the name as shared when Owner 2 submits the same name as Owner 1', async () => {
    const sharedValue = 'SharedName-Beta';

    // Owner 1 submits first
    await request(app)
      .post('/api/names')
      .send({ bracketId, name: sharedValue, owner: 'Owner 1' });

    // Owner 2 submits the same name — should trigger duplicate rule
    const res = await request(app)
      .post('/api/names')
      .send({ bracketId, name: sharedValue, owner: 'Owner 2' });

    expect(res.status).toBe(200);
    expect(res.body.isDuplicate).toBe(true);
    expect(res.body).toHaveProperty('sharedName');
    expect(res.body.sharedName.isShared).toBe(true);
  });
});

describe('POST /api/names — bank overflow (exceeding 16 per owner)', () => {
  it('sends the name to the bank when owner already has 16 active names', async () => {
    // Fresh bracket so we have a clean count
    const { bracketId: freshId, owner1Token: freshToken } = await seedBracket({
      owner1Slug: 'nameseed-overflow',
      withNames: false,
    });

    try {
      // Fill Owner 1's 16 slots
      for (let i = 1; i <= 16; i++) {
        await request(app)
          .post('/api/names')
          .send({ bracketId: freshId, name: `OverflowName-${i}`, owner: 'Owner 1' });
      }

      // 17th name should go to the bank
      const res = await request(app)
        .post('/api/names')
        .send({ bracketId: freshId, name: 'BankedName-17', owner: 'Owner 1' });

      expect(res.status).toBe(201);
      expect(res.body.isBanked).toBe(true);
    } finally {
      await teardownBracket(freshId, freshToken);
    }
  });
});
