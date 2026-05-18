/**
 * One-time migration script: drop all stale sub-document indexes from the brackets collection.
 *
 * Fetches every index currently in MongoDB, drops any that are NOT in the known-good set
 * (i.e. indexes that exist in the current schema definition), and leaves the rest untouched.
 * Mongoose will recreate the correct indexes on next server start.
 *
 * Usage (from baby-name-bracket-api/):
 *   node scripts/drop-stale-indexes.js
 */

require('dotenv').config();

const mongoose = require('mongoose');
const { connectDB } = require('../config/database');

// These are the indexes the current schema actually defines — leave them alone.
const KNOWN_GOOD_INDEXES = new Set([
  '_id_',
  'status_1_createdAt_-1',
  'owner1Names.id_1',
  'owner2Names.id_1',
  'sharedNames.id_1',
  'votes.voterId_1',
  'owner1PendingNames.id_1',
  'owner2PendingNames.id_1',
  'inviteCode_1',
  'owner1UserId_1',
  'owner2UserId_1',
  'guestUserIds_1',
]);

async function dropStaleIndexes() {
  await connectDB();

  const collection = mongoose.connection.db.collection('brackets');

  console.log('\nScanning indexes on "brackets" collection...\n');

  const indexes = await collection.indexes();

  console.log(`  Found ${indexes.length} index(es) total.\n`);

  let dropped = 0;
  let skipped = 0;

  for (const index of indexes) {
    const name = index.name;

    if (KNOWN_GOOD_INDEXES.has(name)) {
      console.log(`  [keep]     ${name}`);
      skipped++;
      continue;
    }

    try {
      await collection.dropIndex(name);
      console.log(`  [dropped]  ${name}`);
      dropped++;
    } catch (err) {
      if (err.code === 27) {
        console.log(`  [skipped]  ${name} — already gone`);
      } else {
        console.error(`  [error]    ${name} — ${err.message}`);
        throw err;
      }
    }
  }

  console.log(`\nDone. Dropped ${dropped} stale index(es), kept ${skipped}.\n`);
  console.log('Restart the API server — Mongoose will recreate any missing indexes automatically.\n');
}

dropStaleIndexes()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
