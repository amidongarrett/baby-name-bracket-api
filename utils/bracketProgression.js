const { v4: uuidv4 } = require('uuid');

/**
 * Advance Matchup Winners
 * 
 * Evaluates all matchups in a given round, determines winners based on vote counts,
 * and advances them to the appropriate slots in the next round.
 * 
 * @param {Object} bracket - Mongoose bracket document
 * @param {String} targetRound - The round to process (e.g., 'roundOf32', 'roundOf16')
 * @returns {Object} - Updated bracket document (not saved, caller must save)
 * 
 * Round Progression Logic:
 * - roundOf32 (16 matchups) → roundOf16 (8 matchups)
 * - roundOf16 (8 matchups) → elite8 (4 matchups)
 * - elite8 (4 matchups) → final4 (2 matchups)
 * - final4 (2 matchups) → championship (1 matchup)
 * - championship (1 matchup) → sets championNameId
 * 
 * Pairing Strategy:
 * Winners from matchups [0,1] advance to next round slot 0
 * Winners from matchups [2,3] advance to next round slot 1
 * Winners from matchups [4,5] advance to next round slot 2
 * And so on...
 */
function advanceMatchupWinners(bracket, targetRound) {
  // Normalize input: convert display names to camelCase property names
  const roundMapping = {
    'roundOf32': 'roundOf32',
    'Round of 32': 'roundOf32',
    'roundOf16': 'roundOf16',
    'Round of 16': 'roundOf16',
    'elite8': 'elite8',
    'Elite 8': 'elite8',
    'final4': 'final4',
    'Final 4': 'final4',
    'championship': 'championship',
    'Championship': 'championship'
  };

  const normalizedRound = roundMapping[targetRound];
  if (!normalizedRound) {
    throw new Error(`Invalid round specified: ${targetRound}`);
  }

  // Define next round mapping
  const nextRoundMap = {
    'roundOf32': 'roundOf16',
    'roundOf16': 'elite8',
    'elite8': 'final4',
    'final4': 'championship',
    'championship': null // Championship has no next round
  };

  // Define display names for round field in matchup schema
  const displayNameMap = {
    'roundOf32': 'Round of 32',
    'roundOf16': 'Round of 16',
    'elite8': 'Elite 8',
    'final4': 'Final 4',
    'championship': 'Championship'
  };

  const nextRound = nextRoundMap[normalizedRound];
  
  // Get matchups from the target round
  const currentMatchups = bracket.matchups[normalizedRound];
  if (!currentMatchups || currentMatchups.length === 0) {
    throw new Error(`No matchups found for round: ${normalizedRound}`);
  }

  // Array to store winners for next round
  const winners = [];

  // Process each matchup in the current round
  // Winners are pre-set by the admin via the set-winner endpoint; do not compute from votes.
  currentMatchups.forEach((matchup, index) => {
    if (!matchup.winnerId) {
      throw new Error(`Matchup ${matchup.id} has no winner set. Admin must set winners before advancing.`);
    }
    winners.push(matchup.winnerId);
  });

  // If this is the championship round, set the champion and return
  if (normalizedRound === 'championship') {
    bracket.championNameId = winners[0];
    bracket.status = 'completed';
    bracket.currentRound = 'Completed';
    return bracket;
  }

  // Initialize next round matchups array if it doesn't exist
  if (!bracket.matchups[nextRound]) {
    bracket.matchups[nextRound] = [];
  }

  // Clear existing next round matchups (in case of re-generation)
  bracket.matchups[nextRound] = [];

  // Pair winners into next round matchups
  // Pattern: matchups [0,1] → slot 0, matchups [2,3] → slot 1, etc.
  for (let i = 0; i < winners.length; i += 2) {
    const name1Id = winners[i];
    const name2Id = winners[i + 1] || null; // Handle odd number edge case

    const newMatchup = {
      id: uuidv4(),
      round: displayNameMap[nextRound],
      name1Id: name1Id,
      name2Id: name2Id,
      votes: {
        name1Votes: 0,
        name2Votes: 0
      },
      winnerId: null,
      createdAt: new Date()
    };

    bracket.matchups[nextRound].push(newMatchup);
  }

  // Update bracket current round
  bracket.currentRound = displayNameMap[nextRound];

  return bracket;
}

module.exports = {
  advanceMatchupWinners
};
