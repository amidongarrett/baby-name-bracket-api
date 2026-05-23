/**
 * Script: add-25-votes.js
 * Adds 25 locked UserBracket votes to bracket ID 6a0a8ec08679e0aba2bc6b89
 * by creating 25 unique test users, having each make all 16 Round of 32 picks,
 * then locking their bracket.
 *
 * Usage: node scripts/add-25-votes.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const BASE_URL = 'http://localhost:3001';
const BRACKET_ID = '6a0a8ec08679e0aba2bc6b89';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function loginTestUser(alias) {
  const email = `test+${alias}@amidonlabs.com`;

  // Step 1: request code (no-op for test emails, just upserts user)
  const reqRes = await fetch(`${BASE_URL}/api/auth/request-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!reqRes.ok) {
    throw new Error(`request-code failed for ${email}: ${reqRes.status}`);
  }

  // Step 2: verify code with any 6-digit code (test emails bypass OTP)
  const verRes = await fetch(`${BASE_URL}/api/auth/verify-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code: '000000' }),
  });
  if (!verRes.ok) {
    throw new Error(`verify-code failed for ${email}: ${verRes.status} ${await verRes.text()}`);
  }
  const { token } = await verRes.json();
  return { email, token };
}

async function fetchBracket() {
  const res = await fetch(`${BASE_URL}/api/bracket/${BRACKET_ID}`);
  if (!res.ok) throw new Error(`Failed to fetch bracket: ${res.status}`);
  return res.json();
}

async function submitPick(token, round, position, selectedNameId) {
  const res = await fetch(`${BASE_URL}/api/bracket/${BRACKET_ID}/my-bracket/pick`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ round, position, selectedNameId }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`submitPick failed pos=${position}: ${res.status} ${body}`);
  }
  return res.json();
}

async function lockBracket(token) {
  const res = await fetch(`${BASE_URL}/api/bracket/${BRACKET_ID}/my-bracket/lock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const body = await res.text();
    // "Already locked" is fine — treat as success
    if (body.includes('Already locked')) return { alreadyLocked: true };
    throw new Error(`lockBracket failed: ${res.status} ${body}`);
  }
  return res.json();
}

async function getMyBracket(token) {
  const res = await fetch(`${BASE_URL}/api/bracket/${BRACKET_ID}/my-bracket`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`getMyBracket failed: ${res.status}`);
  return res.json();
}

/**
 * Build all 31 picks needed to lock a bracket:
 * - R32: 16 picks (random 50/50 between name1 and name2 per matchup)
 * - R16: 8 picks (derived from R32 winners, random 50/50 per pair)
 * - E8:  4 picks
 * - F4:  2 picks
 * - CH:  1 pick
 */
function buildAllPicks(matchups) {
  const coin = () => Math.random() < 0.5;

  // R32: randomly pick name1 or name2 for each matchup
  const r32 = matchups.map(m => coin() ? m.name1Id : m.name2Id);

  // R16: pair up R32 winners (0+1, 2+3, etc.), randomly pick one
  const r16 = [];
  for (let i = 0; i < 16; i += 2) r16.push(coin() ? r32[i] : r32[i + 1]);

  // E8: pair up R16 winners, randomly pick one
  const e8 = [];
  for (let i = 0; i < 8; i += 2) e8.push(coin() ? r16[i] : r16[i + 1]);

  // F4: pair up E8 winners, randomly pick one
  const f4 = [];
  for (let i = 0; i < 4; i += 2) f4.push(coin() ? e8[i] : e8[i + 1]);

  // Championship: randomly pick one of the F4 winners
  const ch = [coin() ? f4[0] : f4[1]];

  return { r32, r16, e8, f4, ch };
}

async function castVotesForUser(alias, matchups) {
  const { email, token } = await loginTestUser(alias);

  // Check if already locked
  const existing = await getMyBracket(token);
  if (existing.lockedAt) {
    return { email, status: 'already_locked' };
  }

  const { r32, r16, e8, f4, ch } = buildAllPicks(matchups);

  // Submit all 31 picks across all rounds
  const allPicks = [
    ...r32.map((nameId, i) => ({ round: 'roundOf32', position: i, selectedNameId: nameId })),
    ...r16.map((nameId, i) => ({ round: 'roundOf16', position: i, selectedNameId: nameId })),
    ...e8.map((nameId, i)  => ({ round: 'elite8',    position: i, selectedNameId: nameId })),
    ...f4.map((nameId, i)  => ({ round: 'final4',    position: i, selectedNameId: nameId })),
    ...ch.map((nameId, i)  => ({ round: 'championship', position: i, selectedNameId: nameId })),
  ];

  for (const pick of allPicks) {
    await submitPick(token, pick.round, pick.position, pick.selectedNameId);
    await sleep(30);
  }

  // Lock the bracket
  const lockResult = await lockBracket(token);
  return {
    email,
    status: lockResult.alreadyLocked ? 'already_locked' : 'locked',
    lockedAt: lockResult.lockedAt,
  };
}

async function main() {
  console.log(`Fetching bracket ${BRACKET_ID}...`);
  const bracket = await fetchBracket();
  const matchups = bracket.matchups.roundOf32;

  if (!matchups || matchups.length !== 16) {
    throw new Error(`Expected 16 Round of 32 matchups, got ${matchups?.length}`);
  }

  console.log(`Bracket: "${bracket.name}" | Round: ${bracket.currentRound} | Status: ${bracket.status}`);
  console.log(`Found ${matchups.length} matchups. Casting 25 votes...\n`);

  const results = [];
  let successCount = 0;

  for (let i = 1; i <= 25; i++) {
    const alias = `voter${i}-v${Date.now().toString(36).slice(-4)}`;
    try {
      const result = await castVotesForUser(alias, matchups);
      results.push({ ...result, alias });
      if (result.status === 'locked' || result.status === 'already_locked') {
        successCount++;
        console.log(`[${i}/25] ${result.email} — ${result.status}`);
      }
    } catch (err) {
      console.error(`[${i}/25] ${alias} — ERROR: ${err.message}`);
      results.push({ alias, status: 'error', error: err.message });
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Total attempted: 25`);
  console.log(`Successfully voted (locked): ${successCount}`);
  console.log(`Errors: ${results.filter(r => r.status === 'error').length}`);

  // Verify final tally
  const tallyRes = await fetch(`${BASE_URL}/api/bracket/${BRACKET_ID}/vote-tallies`);
  const tallyData = await tallyRes.json();
  let totalVotes = 0;
  for (const pos of Object.values(tallyData.tallies.roundOf32)) {
    totalVotes += (pos.name1Votes || 0) + (pos.name2Votes || 0);
  }
  const impliedLocked = totalVotes / 16;
  console.log(`\nPost-run vote tally: ${totalVotes} total votes across all positions`);
  console.log(`Implied locked brackets: ${impliedLocked}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
