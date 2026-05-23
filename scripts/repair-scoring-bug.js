// Usage: node scripts/repair-scoring-bug.js
// Repairs inflated scores for bracket 6a0f17e4be56b076296af4c3 where roundOf32,
// roundOf16, elite8, and final4 were each scored twice via fanOutScores, adding
// 64 extra points to every locked UserBracket that had perfect picks.
//
// Safe to re-run: if scoredRounds is already populated the script exits early.

const mongoose = require('mongoose');
const UserBracket = require('../models/UserBracket');
const Bracket = require('../models/Bracket');
require('dotenv').config();

const BRACKET_ID = '6a0f17e4be56b076296af4c3';

// Championship was scored only once (correct). These four rounds were doubled.
const DOUBLED_ROUNDS = ['roundOf32', 'roundOf16', 'elite8', 'final4'];
const ROUND_MULTIPLIERS = { roundOf32: 1, roundOf16: 2, elite8: 4, final4: 8 };

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const bracket = await Bracket.findById(BRACKET_ID);
  if (!bracket) throw new Error(`Bracket ${BRACKET_ID} not found`);

  // Guard: if scoredRounds already populated this repair already ran
  if (bracket.scoredRounds && bracket.scoredRounds.length > 0) {
    console.log(`scoredRounds already set (${bracket.scoredRounds.join(', ')}) — repair already applied, exiting.`);
    await mongoose.disconnect();
    return;
  }

  const userBrackets = await UserBracket.find({ bracketId: BRACKET_ID, lockedAt: { $ne: null } });
  console.log(`Found ${userBrackets.length} locked UserBracket(s)`);

  for (const ub of userBrackets) {
    let overcount = 0;

    for (const roundKey of DOUBLED_ROUNDS) {
      const multiplier = ROUND_MULTIPLIERS[roundKey];
      const matchups = bracket.matchups[roundKey] || [];
      matchups.forEach((matchup, position) => {
        if (
          matchup.winnerId &&
          ub.picks[roundKey] &&
          ub.picks[roundKey][position] === matchup.winnerId
        ) {
          overcount += multiplier; // one extra copy was counted
        }
      });
    }

    const correctedScore = ub.score - overcount;
    console.log(
      `UserBracket ${ub._id} (userId: ${ub.userId}): ${ub.score} → ${correctedScore} (removed ${overcount})`
    );
    await UserBracket.updateOne({ _id: ub._id }, { $set: { score: correctedScore } });
  }

  // Populate scoredRounds so the idempotency guard in fanOutScores treats all
  // rounds as already processed — prevents any future re-scoring on this bracket.
  await Bracket.updateOne(
    { _id: BRACKET_ID },
    { $set: { scoredRounds: ['roundOf32', 'roundOf16', 'elite8', 'final4', 'championship'] } }
  );

  console.log('Done. Scores repaired and scoredRounds populated.');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
