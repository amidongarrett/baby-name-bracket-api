/**
 * Tournament Seeding Algorithm — V2
 *
 * Two-division structure, cross-pollinated by rank:
 *   Division 1 (matchups 0–7):  Owner 1's top 8 vs Owner 2's bottom 8
 *   Division 2 (matchups 8–15): Owner 2's top 8 vs Owner 1's bottom 8
 *
 * Within each division the 8 matchup slots follow March Madness ordering so
 * the top two seeds in each division can only meet in the division final:
 *   Slot 0: seed1 vs seed16_equiv
 *   Slot 1: seed8 vs seed9_equiv
 *   Slot 2: seed4 vs seed13_equiv
 *   Slot 3: seed5 vs seed12_equiv
 *   Slot 4: seed2 vs seed15_equiv
 *   Slot 5: seed7 vs seed10_equiv
 *   Slot 6: seed3 vs seed14_equiv
 *   Slot 7: seed6 vs seed11_equiv
 */

const { v4: uuidv4 } = require('uuid');

// Seed pairs per division slot (March Madness ordering)
// name1 = top seed (owner's pick), name2 = cross-division opponent
const SLOT_SEEDS = [
  { seed1: 1,  seed2: 16 }, // Slot 0
  { seed1: 8,  seed2: 9  }, // Slot 1
  { seed1: 4,  seed2: 13 }, // Slot 2
  { seed1: 5,  seed2: 12 }, // Slot 3
  { seed1: 2,  seed2: 15 }, // Slot 4
  { seed1: 7,  seed2: 10 }, // Slot 5
  { seed1: 3,  seed2: 14 }, // Slot 6
  { seed1: 6,  seed2: 11 }, // Slot 7
];

/**
 * Helper — build a single Round-of-32 matchup object.
 * @param {Object|null} nameA
 * @param {Object|null} nameB
 * @param {number} slotIndex - 0–7, used to derive seed1/seed2
 */
const makeMatchup = (nameA, nameB, slotIndex) => {
  const seeds = SLOT_SEEDS[slotIndex] || { seed1: null, seed2: null };
  return {
    id: uuidv4(),
    round: 'Round of 32',
    name1Id: nameA?.id || null,
    name2Id: nameB?.id || null,
    seed1: seeds.seed1,
    seed2: seeds.seed2,
    winnerId: null,
    createdAt: new Date()
  };
};

/**
 * Generate Division Matchups
 *
 * Produces 16 Round-of-32 matchups (8 per division) from the two owner name
 * arrays.  Each array must be ordered by rank (index 0 = rank 1 = top pick).
 *
 * @param {Array} owner1Names - Owner 1's names sorted by rank (16 entries expected)
 * @param {Array} owner2Names - Owner 2's names sorted by rank (16 entries expected)
 * @returns {Array} 16 matchup objects: [div1_0..div1_7, div2_0..div2_7]
 */
const generateDivisionMatchups = (owner1Names, owner2Names) => {
  if (!Array.isArray(owner1Names) || !Array.isArray(owner2Names)) {
    throw new Error('owner1Names and owner2Names must be arrays');
  }

  const o1 = owner1Names; // alias — index 0 = rank 1 (top pick)
  const o2 = owner2Names; // alias — index 0 = rank 1 (top pick)

  // Division 1: Owner 1 top-8 seeds vs Owner 2 bottom-8 seeds
  // o1[0] = H#1, o2[15] = W#16, etc.
  const div1 = [
    makeMatchup(o1[0],  o2[15], 0),  // H#1  vs W#16
    makeMatchup(o1[7],  o2[8],  1),  // H#8  vs W#9
    makeMatchup(o1[3],  o2[12], 2),  // H#4  vs W#13
    makeMatchup(o1[4],  o2[11], 3),  // H#5  vs W#12
    makeMatchup(o1[1],  o2[14], 4),  // H#2  vs W#15
    makeMatchup(o1[6],  o2[9],  5),  // H#7  vs W#10
    makeMatchup(o1[2],  o2[13], 6),  // H#3  vs W#14
    makeMatchup(o1[5],  o2[10], 7),  // H#6  vs W#11
  ];

  // Division 2: Owner 2 top-8 seeds vs Owner 1 bottom-8 seeds
  const div2 = [
    makeMatchup(o2[0],  o1[15], 0),  // W#1  vs H#16
    makeMatchup(o2[7],  o1[8],  1),  // W#8  vs H#9
    makeMatchup(o2[3],  o1[12], 2),  // W#4  vs H#13
    makeMatchup(o2[4],  o1[11], 3),  // W#5  vs H#12
    makeMatchup(o2[1],  o1[14], 4),  // W#2  vs H#15
    makeMatchup(o2[6],  o1[9],  5),  // W#7  vs H#10
    makeMatchup(o2[2],  o1[13], 6),  // W#3  vs H#14
    makeMatchup(o2[5],  o1[10], 7),  // W#6  vs H#11
  ];

  return [...div1, ...div2];
};

/**
 * Generate stubs for all five tournament rounds at bracket creation time.
 * Uses the top-seed (name1Id) as the projected winner at each stage.
 *
 * @param {Array} owner1Names - Owner 1's names sorted by rank (16 entries expected)
 * @param {Array} owner2Names - Owner 2's names sorted by rank (16 entries expected)
 * @returns {{ roundOf32, roundOf16, elite8, final4, championship }}
 */
const generateAllRoundStubs = (owner1Names, owner2Names) => {
  const roundOf32 = generateDivisionMatchups(owner1Names, owner2Names);
  return {
    roundOf32,
    roundOf16:    [],
    elite8:       [],
    final4:       [],
    championship: [],
  };
};

module.exports = { generateDivisionMatchups, generateAllRoundStubs };
