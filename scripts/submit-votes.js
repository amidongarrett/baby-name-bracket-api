#!/usr/bin/env node
/**
 * Script: submit-votes.js
 * Reads a JSON file containing a bracket ID and each persona's full set of picks,
 * authenticates each persona via the test-account bypass, and submits all picks.
 *
 * Usage: node scripts/submit-votes.js <path-to-json>
 *
 * Input shape (submit-votes.json):
 * {
 *   "bracketId": "string",
 *   "personas": [
 *     {
 *       "name": "string",
 *       "email": "test+persona@amidonlabs.com",
 *       "picks": {
 *         "roundOf32":    ["nameId or name value", ...],  // 16 entries
 *         "roundOf16":    ["nameId or name value", ...],  // 8 entries
 *         "elite8":       ["nameId or name value", ...],  // 4 entries
 *         "final4":       ["nameId or name value", ...],  // 2 entries
 *         "championship": ["nameId or name value"]        // 1 entry
 *       }
 *     }
 *   ]
 * }
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';

// Expected number of picks per round (matches submitPick controller constraints)
const ROUND_SIZES = {
  roundOf32:    16,
  roundOf16:    8,
  elite8:       4,
  final4:       2,
  championship: 1,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeName(s) {
  return s.trim().toLowerCase();
}

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
    const err = new Error(`HTTP ${res.status} [${method} ${path}]: ${errorMsg}`);
    err.status = res.status;
    err.body = parsed;
    throw err;
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

/**
 * Build a Map<normalizedValue, id> from the bracket's name lists.
 */
function buildValueToIdMap(bracket) {
  const map = new Map();
  const lists = [
    ...(bracket.owner1Names || []),
    ...(bracket.owner2Names || []),
    ...(bracket.sharedNames || []),
  ];
  for (const name of lists) {
    if (name && name.id && name.value) {
      map.set(normalizeName(name.value), name.id);
    }
  }
  return map;
}

/**
 * Resolve a pick value (UUID or display string) to a name ID.
 */
function resolvePick(value, valueToIdMap) {
  if (UUID_RE.test(value)) return value; // already a UUID
  const id = valueToIdMap.get(normalizeName(value));
  if (!id) {
    throw new Error(`Cannot resolve name '${value}' to an ID`);
  }
  return id;
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    process.stderr.write('Usage: node scripts/submit-votes.js <path-to-json>\n');
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

  const { bracketId, personas } = input;

  if (!bracketId || !Array.isArray(personas)) {
    process.stderr.write('ERROR: Input must have bracketId and personas array\n');
    process.exit(1);
  }

  // 2. Fetch bracket to build name-value → ID resolution map
  console.log(`Fetching bracket ${bracketId}...`);
  let bracket;
  try {
    bracket = await apiFetch('GET', `/api/bracket/${bracketId}`);
  } catch (err) {
    process.stderr.write(`ERROR: ${err.message}\n`);
    process.exit(1);
  }

  if (bracket.status !== 'active') {
    process.stderr.write(
      `ERROR: Bracket is not active (status: ${bracket.status}) — run create-bracket.js first\n`
    );
    process.exit(1);
  }

  const valueToIdMap = buildValueToIdMap(bracket);
  console.log(`Bracket "${bracket.name || bracketId}" is active. Resolved ${valueToIdMap.size} names.\n`);

  // 3. Process each persona
  const results = [];

  for (const persona of personas) {
    const { name: personaName, email, picks } = persona;
    let picksSubmitted = 0;
    let status = 'OK';
    let errorMsg = '';

    try {
      // a. Authenticate
      const { token: personaToken } = await auth(email);

      // b. Join bracket as guest (test-user bypass — bare bracketId, no inviteCode)
      try {
        await apiFetch('POST', '/api/brackets/join', { bracketId }, personaToken);
      } catch (joinErr) {
        const body = joinErr.body;
        const msg = (body && typeof body === 'object' && (body.error || body.message)) || joinErr.message;
        if (joinErr.status === 400 && /already joined/i.test(msg)) {
          // Non-fatal — persona already joined from a prior partial run
        } else if (joinErr.status === 403) {
          throw new Error('Bracket is not active — run create-bracket.js first');
        } else {
          throw joinErr;
        }
      }

      // c & d. Resolve and submit picks per round
      const totalExpected = Object.values(ROUND_SIZES).reduce((a, b) => a + b, 0);
      let bracketLocked = false;

      for (const [round, expectedCount] of Object.entries(ROUND_SIZES)) {
        const roundPicks = (picks && picks[round]) || [];
        for (let position = 0; position < expectedCount; position++) {
          const rawValue = roundPicks[position];
          if (rawValue == null) continue; // skip missing trailing entries

          const selectedNameId = resolvePick(rawValue, valueToIdMap);

          try {
            await apiFetch(
              'POST',
              `/api/bracket/${bracketId}/my-bracket/pick`,
              { round, position, selectedNameId },
              personaToken
            );
            picksSubmitted++;
          } catch (pickErr) {
            const body = pickErr.body;
            const msg = (body && typeof body === 'object' && (body.error || body.message)) || pickErr.message;
            if (pickErr.status === 400 && /locked/i.test(msg)) {
              // Per-persona warning — bracket already locked, continue with next persona
              bracketLocked = true;
              status = 'WARN (bracket locked)';
              errorMsg = msg;
              break;
            }
            throw pickErr;
          }
        }
        if (bracketLocked) break;
      }

      if (!bracketLocked) {
        // e. Lock the persona's bracket after all picks are submitted
        try {
          await apiFetch(
            'POST',
            `/api/bracket/${bracketId}/my-bracket/lock`,
            null,
            personaToken
          );
          console.log(`  [${personaName || email}] bracket locked successfully`);
          status = 'OK (locked)';
        } catch (lockErr) {
          const body = lockErr.body;
          const msg = (body && typeof body === 'object' && (body.error || body.message)) || lockErr.message;
          console.log(`  [${personaName || email}] bracket lock FAILED: ${msg}`);
          status = 'WARN (lock failed)';
          errorMsg = msg;
        }
      }
    } catch (err) {
      status = 'ERROR';
      errorMsg = err.message;
    }

    results.push({
      name: personaName || email,
      total: 31,
      submitted: picksSubmitted,
      status,
      errorMsg,
    });
  }

  // 4. Print per-persona confirmation table
  const col1 = Math.max(20, ...results.map(r => r.name.length)) + 2;
  const header = 'Persona'.padEnd(col1) + 'Picks'.padEnd(8) + 'Status';
  const divider = '─'.repeat(col1) + '─'.repeat(8) + '─'.repeat(20);
  console.log(header);
  console.log(divider);
  for (const r of results) {
    const picks = `${r.submitted}/${r.total}`;
    const line = r.name.padEnd(col1) + picks.padEnd(8) + r.status;
    console.log(line);
    if (r.errorMsg) console.log(' '.repeat(col1) + `  ${r.errorMsg}`);
  }

  // 5. Exit 1 if any persona errored
  const hasError = results.some(r => r.status === 'ERROR');
  if (hasError) {
    process.stderr.write('\nOne or more personas failed — see table above.\n');
    process.exit(1);
  }
}

main().catch(err => {
  process.stderr.write(`ERROR: ${err.message}\n`);
  process.exit(1);
});
