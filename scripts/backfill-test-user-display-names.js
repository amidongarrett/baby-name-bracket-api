/**
 * One-time backfill: update test users whose displayName is still the legacy
 * default 'Test User' to the slug derived from their email address.
 *
 * Matching is conservative — only records where displayName === 'Test User'
 * are touched; any record where a human already called setName is left alone.
 *
 * Run once: node scripts/backfill-test-user-display-names.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const { TEST_EMAIL_RE } = require('../utils/testEmail');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/babynames');

  const testUsers = await User.find({
    email: TEST_EMAIL_RE,
    displayName: 'Test User',
  });

  let updated = 0;
  for (const user of testUsers) {
    const match = user.email.match(/^test\+(.+)@amidonlabs\.com$/i);
    if (!match) continue;
    const slug = match[1];
    await User.updateOne({ _id: user._id }, { $set: { displayName: slug } });
    updated++;
    console.log(`Updated ${user.email} -> "${slug}"`);
  }

  console.log(`Done. Updated ${updated} of ${testUsers.length} matching test users.`);
  process.exit(0);
})();
