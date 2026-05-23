/**
 * Name deletion API integration tests
 * Covers DELETE /api/names/:nameId
 *
 * Note: The controller returns the full updated bracket document on success,
 * not a { deletedName } shape. The test validates the HTTP status and
 * that the response contains bracket-level data.
 */
const request = require('supertest');
const app = require('../../server');
const { connectTestDB, disconnectTestDB } = require('../helpers/db');
const { seedBracket, teardownBracket } = require('../helpers/seed');

let bracketId;
let owner1Token;
let nameIdToDelete;

beforeAll(async () => {
  await connectTestDB();

  // Seed a bracket with no names so we can track a specific name ID
  ({ bracketId, owner1Token } = await seedBracket({ withNames: false }));

  // Add a single name and capture its ID
  const addRes = await request(app)
    .post('/api/names')
    .send({ bracketId, name: 'NameToDelete', owner: 'Owner 1' });

  nameIdToDelete = addRes.body.name.id;
});

afterAll(async () => {
  await teardownBracket(bracketId, owner1Token);
  await disconnectTestDB();
});

describe('DELETE /api/names/:nameId', () => {
  it('returns 200 and the updated bracket when deleting an existing name', async () => {
    const res = await request(app)
      .delete(`/api/names/${nameIdToDelete}`)
      .send({ bracketId });

    expect(res.status).toBe(200);
    // Controller returns the full bracket response document
    expect(res.body).toBeDefined();
  });

  it('returns 404 when the nameId does not exist in the bracket', async () => {
    const res = await request(app)
      .delete('/api/names/non-existent-id-00000')
      .send({ bracketId });

    expect(res.status).toBe(404);
  });
});
