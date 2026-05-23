#!/usr/bin/env node
/**
 * Script: create-bracket.js
 * Reads a JSON file and orchestrates the full bracket creation flow:
 *   1. Authenticate both owners via test-account bypass
 *   2. Create the bracket as owner1
 *   3. Accept the owner2 seat
 *   4. Add all 32 names
 *   5. Lock the bracket (generate matchups, set status → active)
 *   6. Send guest invites
 *   7. Print summary
 *
 * Usage: node scripts/create-bracket.js <path-to-json>
 *
 * Input shape (create-bracket.json):
 * {
 *   "owner1": { "displayName": "string", "email": "test+owner1@amidonlabs.com" },
 *   "owner2": { "displayName": "string", "email": "test+owner2@amidonlabs.com" },
 *   "inviteEmails": ["string"],
 *   "names": [
 *     { "value": "string", "submittedBy": "Owner 1" },
 *     { "value": "string", "submittedBy": "Owner 2" }
 *   ]
 * }
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';

/**
 * Thin fetch wrapper. Throws on non-2xx with status + body in the error message.
 */
async function apiFetch(method, path, body, token) {
  const url = `${API_BASE_URL}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }

  if (!res.ok) {
    const errorMsg =
      (parsed && typeof parsed === 'object' && (parsed.error || parsed.message)) ||
      text;
    throw new Error(`HTTP ${res.status} [${method} ${path}]: ${errorMsg}`);
  }

  return parsed;
}

/**
 * Authenticates a test account via the two-step OTP-bypass flow.
 * Returns { token, userId }.
 */
async function auth(email) {
  await apiFetch('POST', '/api/auth/request-code', { email });

  const data = await apiFetch('POST', '/api/auth/verify-code', {
    email,
    code: '000000',
  });

  return { token: data.token, userId: data.user.id };
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    process.stderr.write('Usage: node scripts/create-bracket.js <path-to-json>\n');
    process.exit(1);
  }

  // 1. Read and parse input
  let input;
  try {
    input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch (err) {
    process.stderr.write(`ERROR: Could not read/parse input file: ${err.message}\n`);
    process.exit(1);
  }

  const { owner1, owner2, inviteEmails = [], names } = input;

  if (!owner1 || !owner2 || !Array.isArray(names)) {
    process.stderr.write('ERROR: Input must have owner1, owner2, and names array\n');
    process.exit(1);
  }

  // 2. Authenticate owner1
  console.log(`Authenticating owner1 (${owner1.email})...`);
  const { token: owner1Token } = await auth(owner1.email);

  // 3. Authenticate owner2
  console.log(`Authenticating owner2 (${owner2.email})...`);
  const { token: owner2Token } = await auth(owner2.email);

  // 4. Create bracket as owner1
  console.log('Creating bracket...');
  const createData = await apiFetch(
    'POST',
    '/api/brackets',
    {
      owner1Name: owner1.displayName,
      owner2Name: owner2.displayName,
      owner2Email: owner2.email,
    },
    owner1Token
  );

  const bracketId = createData.bracket.id;
  const inviteCode = createData.bracket.inviteCode;
  console.log(`Bracket created: ${bracketId}`);

  // 5. Accept the owner2 seat
  console.log(`Accepting owner2 seat (invite code: ${inviteCode})...`);
  await apiFetch('GET', `/api/brackets/${inviteCode}/accept-owner`, null, owner2Token);

  // 6. Add all names sequentially (must precede lock)
  console.log(`Adding ${names.length} names...`);
  let namesAdded = 0;
  for (const entry of names) {
    await apiFetch('POST', '/api/names', {
      name: entry.value,
      owner: entry.submittedBy,
      bracketId,
    });
    namesAdded++;
    process.stdout.write(`\r  Names added: ${namesAdded}/${names.length}`);
  }
  console.log(''); // newline after progress

  // 7. Lock bracket (generate matchups, activate voting)
  console.log('Locking bracket (generating matchups)...');
  const lockData = await apiFetch('POST', '/api/bracket/lock', { bracketId });
  const matchupsGenerated = lockData.bracket?.matchupsGenerated;

  // 8. Send guest invites as owner1
  let shareLink = '';
  let invitedCount = 0;
  if (inviteEmails.length > 0) {
    console.log(`Sending ${inviteEmails.length} invite(s)...`);
    const inviteData = await apiFetch(
      'POST',
      `/api/bracket/${bracketId}/invite`,
      { emails: inviteEmails },
      owner1Token
    );
    shareLink = inviteData.shareLink || '';
    invitedCount = inviteData.invited || inviteEmails.length;
  }

  // 9. Print summary
  console.log('');
  console.log(`Bracket created: ${bracketId}`);
  console.log(`Invite code:     ${inviteCode}`);
  console.log(`Share link:      ${shareLink}`);
  console.log(`Names added:     ${namesAdded}`);
  if (matchupsGenerated !== undefined) {
    console.log(`Matchups:        ${matchupsGenerated}`);
  }
  console.log(`Invites sent:    ${invitedCount}`);
}

main().catch(err => {
  process.stderr.write(`ERROR: ${err.message}\n`);
  process.exit(1);
});
