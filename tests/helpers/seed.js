/**
 * Seed helper for API integration tests.
 *
 * seedBracket({ owner1Slug?, owner2Slug? })
 *   1. Authenticates as owner1 (test account)
 *   2. Creates a bracket via POST /api/brackets
 *   3. Submits 32 names (16 per owner) via POST /api/names
 *   4. Fetches and returns the full bracket document
 *
 * teardownBracket(bracketId, owner1Token)
 *   Issues DELETE /api/bracket/:id (authenticated) to clean up.
 */
const request = require('supertest');
const app = require('../../server');
const { getTestToken } = require('./auth');

async function seedBracket({ owner1Slug = 'owner1', owner2Slug = 'owner2', withNames = true } = {}) {
  const owner1Token = await getTestToken(owner1Slug);

  // Create bracket
  const createRes = await request(app)
    .post('/api/brackets')
    .set('Authorization', `Bearer ${owner1Token}`)
    .send({
      owner1Name: 'Test Owner 1',
      owner2Name: 'Test Owner 2',
      owner2Email: `test+${owner2Slug}@amidonlabs.com`,
    })
    .expect(201);

  const bracketId = createRes.body.bracket.id.toString();

  if (withNames) {
    // Submit 16 names for Owner 1
    for (let i = 1; i <= 16; i++) {
      await request(app)
        .post('/api/names')
        .send({
          bracketId,
          name: `Name-O1-${String(i).padStart(2, '0')}`,
          owner: 'Owner 1',
        });
    }

    // Submit 16 names for Owner 2
    for (let i = 1; i <= 16; i++) {
      await request(app)
        .post('/api/names')
        .send({
          bracketId,
          name: `Name-O2-${String(i).padStart(2, '0')}`,
          owner: 'Owner 2',
        });
    }
  }

  // Fetch full bracket
  const bracketRes = await request(app)
    .get(`/api/bracket/${bracketId}`)
    .expect(200);

  return { bracketId, owner1Token, bracket: bracketRes.body };
}

async function teardownBracket(bracketId, owner1Token) {
  if (!bracketId) return;
  try {
    await request(app)
      .delete(`/api/bracket/${bracketId}`)
      .set('Authorization', `Bearer ${owner1Token}`);
  } catch {
    // Best-effort cleanup — ignore errors in teardown
  }
}

module.exports = { seedBracket, teardownBracket };
