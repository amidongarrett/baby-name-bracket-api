/**
 * Tournament Seeding Algorithm
 * Implements March Madness-style bracket seeding for 32 names
 * 
 * Seeding Pattern:
 * - Matchup 1: Seed 1 vs Seed 32
 * - Matchup 2: Seed 16 vs Seed 17
 * - Matchup 3: Seed 8 vs Seed 25
 * - Matchup 4: Seed 9 vs Seed 24
 * - Matchup 5: Seed 5 vs Seed 28
 * - Matchup 6: Seed 12 vs Seed 21
 * - Matchup 7: Seed 4 vs Seed 29
 * - Matchup 8: Seed 13 vs Seed 20
 * - Matchup 9: Seed 6 vs Seed 27
 * - Matchup 10: Seed 11 vs Seed 22
 * - Matchup 11: Seed 3 vs Seed 30
 * - Matchup 12: Seed 14 vs Seed 19
 * - Matchup 13: Seed 7 vs Seed 26
 * - Matchup 14: Seed 10 vs Seed 23
 * - Matchup 15: Seed 2 vs Seed 31
 * - Matchup 16: Seed 15 vs Seed 18
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Traditional March Madness seeding pairs
 * Each pair represents [higherSeed, lowerSeed] for optimal bracket balance
 */
const SEEDING_PAIRS = [
  [1, 32],   // Matchup 1
  [16, 17],  // Matchup 2
  [8, 25],   // Matchup 3
  [9, 24],   // Matchup 4
  [5, 28],   // Matchup 5
  [12, 21],  // Matchup 6
  [4, 29],   // Matchup 7
  [13, 20],  // Matchup 8
  [6, 27],   // Matchup 9
  [11, 22],  // Matchup 10
  [3, 30],   // Matchup 11
  [14, 19],  // Matchup 12
  [7, 26],   // Matchup 13
  [10, 23],  // Matchup 14
  [2, 31],   // Matchup 15
  [15, 18]   // Matchup 16
];

/**
 * Generate Round of 32 matchups using March Madness seeding algorithm
 *
 * @param {Array} names - Array of name objects with id and value properties (can be < 32)
 * @returns {Array} Array of 16 matchup objects for Round of 32
 * @throws {Error} If names array is invalid
 *
 * Each matchup object contains:
 * - id: Unique UUID for the matchup
 * - round: "Round of 32"
 * - name1Id: ID of the higher seed or null for placeholder
 * - name2Id: ID of the lower seed or null for placeholder
 * - votes: { name1Votes: 0, name2Votes: 0 }
 * - winnerId: null (no winner yet)
 * - createdAt: timestamp
 *
 * NOTE: If fewer than 32 names are provided, remaining slots will use null IDs
 * with placeholder text like "TBD - Waiting for name submission"
 */
const generateRoundOf32Matchups = (names) => {
  // Validation
  if (!Array.isArray(names)) {
    throw new Error('Names must be an array');
  }

  // Validate each provided name has required properties
  names.forEach((name, index) => {
    if (!name.id || !name.value) {
      throw new Error(`Name at index ${index} is missing required properties (id, value)`);
    }
  });

  // Pad names array to 32 with null placeholders
  const paddedNames = [...names];
  while (paddedNames.length < 32) {
    paddedNames.push(null);
  }

  // Generate matchups using seeding pairs
  const matchups = SEEDING_PAIRS.map(([seed1, seed2], matchupIndex) => {
    // Convert seed numbers to array indices (seeds are 1-based, arrays are 0-based)
    const name1 = paddedNames[seed1 - 1];
    const name2 = paddedNames[seed2 - 1];

    return {
      id: uuidv4(),
      round: 'Round of 32',
      name1Id: name1 ? name1.id : null,
      name2Id: name2 ? name2.id : null,
      votes: {
        name1Votes: 0,
        name2Votes: 0
      },
      winnerId: null,
      createdAt: new Date()
    };
  });

  return matchups;
};

/**
 * Validate that all 32 names are ready for tournament generation
 * 
 * @param {Object} bracket - Bracket document from MongoDB
 * @returns {Object} Validation result with isValid boolean and error message if invalid
 */
const validateBracketForSeeding = (bracket) => {
  const totalNames = bracket.getTotalNameCount();

  if (totalNames < 32) {
    return {
      isValid: false,
      error: `Bracket is not full. Current count: ${totalNames}/32. Need ${32 - totalNames} more names.`
    };
  }

  if (totalNames > 32) {
    return {
      isValid: false,
      error: `Bracket has too many names: ${totalNames}/32. This should not happen.`
    };
  }

  // Check if tournament has already been generated
  if (bracket.matchups.roundOf32.length > 0) {
    return {
      isValid: false,
      error: 'Tournament has already been generated. Cannot regenerate matchups.'
    };
  }

  return {
    isValid: true,
    error: null
  };
};

module.exports = {
  generateRoundOf32Matchups,
  validateBracketForSeeding,
  SEEDING_PAIRS
};
