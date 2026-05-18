/**
 * One-time cleanup script: remove orphaned bracket documents that have no owner1UserId.
 *
 * Before multi-bracket support was added, brackets were created without an owner1UserId
 * field. Those documents are now orphaned and interfere with the new system. This script
 * finds them, prints a summary, asks for confirmation, then deletes them.
 *
 * Usage (from baby-name-bracket-api/):
 *   node scripts/clean-orphaned-brackets.js
 */

require('dotenv').config();

const readline = require('readline');
const { connectDB } = require('../config/database');
const Bracket = require('../models/Bracket');

async function findOrphanedBrackets() {
  return Bracket.find({
    $or: [
      { owner1UserId: null },
      { owner1UserId: { $exists: false } },
      { owner1UserId: '' },
    ],
  }).lean();
}

function promptConfirmation(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    process.stdout.write(question);

    rl.once('line', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function cleanOrphanedBrackets() {
  await connectDB();

  console.log('\nScanning for orphaned brackets (no owner1UserId)...\n');

  const orphans = await findOrphanedBrackets();

  if (orphans.length === 0) {
    console.log('No orphaned brackets found. Nothing to do.\n');
    return;
  }

  console.log(`Found ${orphans.length} orphaned bracket(s):\n`);

  for (const doc of orphans) {
    const nameCount =
      (doc.owner1Names ? doc.owner1Names.length : 0) +
      (doc.owner2Names ? doc.owner2Names.length : 0) +
      (doc.sharedNames ? doc.sharedNames.length : 0);

    console.log(`  _id:       ${doc._id}`);
    console.log(`  name:      ${doc.name || '(none)'}`);
    console.log(`  status:    ${doc.status || '(none)'}`);
    console.log(`  createdAt: ${doc.createdAt ? doc.createdAt.toISOString() : '(none)'}`);
    console.log(`  names:     ${nameCount} total`);
    console.log('');
  }

  const answer = await promptConfirmation(
    `Found ${orphans.length} orphaned bracket(s). Delete them? (yes/no): `
  );

  if (answer !== 'yes') {
    console.log('\nAborted. No documents were deleted.\n');
    return;
  }

  const result = await Bracket.deleteMany({
    $or: [
      { owner1UserId: null },
      { owner1UserId: { $exists: false } },
      { owner1UserId: '' },
    ],
  });

  console.log(`\nDeleted ${result.deletedCount} orphaned bracket(s).\n`);
}

cleanOrphanedBrackets()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Cleanup failed:', err.message);
    process.exit(1);
  });
