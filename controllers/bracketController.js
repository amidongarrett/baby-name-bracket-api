const Bracket = require('../models/Bracket');
const BabyName = require('../models/BabyName');
const UserBracket = require('../models/UserBracket');
const User = require('../models/User');
const { v4: uuidv4 } = require('uuid');
const { generateDivisionMatchups, generateAllRoundStubs } = require('../utils/seedingAlgorithm');
const { advanceMatchupWinners } = require('../utils/bracketProgression');
const { sendBracketInviteEmail } = require('../utils/email');

const ROUND_MULTIPLIERS = { roundOf32: 1, roundOf16: 2, elite8: 4, final4: 8, championship: 16 };

const ROUND_ORDER     = ['roundOf32', 'roundOf16', 'elite8', 'final4', 'championship'];
const AGG_ROUND_SIZES = { roundOf32: 16, roundOf16: 8, elite8: 4, final4: 2, championship: 1 };

function computeMaxPossible(userBracket, bracket) {
  // Build the set of eliminated nameIds from completed matchups
  const eliminated = new Set();
  for (const roundKey of ROUND_ORDER) {
    for (const m of (bracket.matchups?.[roundKey] || [])) {
      if (!m.winnerId) continue;
      const w = m.winnerId.toString();
      if (m.name1Id && m.name1Id.toString() !== w) eliminated.add(m.name1Id.toString());
      if (m.name2Id && m.name2Id.toString() !== w) eliminated.add(m.name2Id.toString());
    }
  }
  // Sum multipliers for each unfinished matchup where the user's pick is still alive
  let maxPossible = userBracket.score || 0;
  for (const roundKey of ROUND_ORDER) {
    const multiplier = ROUND_MULTIPLIERS[roundKey];
    const roundSize  = AGG_ROUND_SIZES[roundKey];
    const matchups   = bracket.matchups?.[roundKey] || [];
    for (let pos = 0; pos < roundSize; pos++) {
      if (matchups[pos]?.winnerId) continue;   // already resolved, already in score
      const pick = userBracket.picks?.[roundKey]?.[pos];
      if (pick && !eliminated.has(pick.toString())) {
        maxPossible += multiplier;
      }
    }
  }
  return maxPossible;
}

async function fanOutScores(bracketId, roundKey, completedMatchups) {
  // Idempotency guard: skip if this round was already scored
  const bracketMeta = await Bracket.findById(bracketId).select('scoredRounds').lean();
  if (bracketMeta?.scoredRounds?.includes(roundKey)) {
    console.log(`[fanOutScores] ${roundKey} already scored for bracket ${bracketId} — skipping`);
    return;
  }

  const userBrackets = await UserBracket.find({ bracketId, lockedAt: { $ne: null } });
  if (!userBrackets.length) {
    // Still mark as scored so a later empty-then-populated run does not double-count
    await Bracket.updateOne({ _id: bracketId }, { $addToSet: { scoredRounds: roundKey } });
    return;
  }

  const multiplier = ROUND_MULTIPLIERS[roundKey] || 1;

  const ops = userBrackets.map(ub => {
    let delta = 0;
    completedMatchups.forEach((matchup, position) => {
      if (
        matchup.winnerId &&
        ub.picks[roundKey] &&
        ub.picks[roundKey][position] === matchup.winnerId
      ) delta += multiplier;
    });
    return {
      updateOne: {
        filter: { _id: ub._id },
        update: { $inc: { score: delta }, $set: { updatedAt: new Date() } },
      },
    };
  });

  await UserBracket.bulkWrite(ops);

  // Mark this round as scored so subsequent calls are no-ops
  await Bracket.updateOne({ _id: bracketId }, { $addToSet: { scoredRounds: roundKey } });
}

/**
 * Aggregate locked UserBracket picks into per-matchup vote tallies.
 * Returns a nested object: { [roundKey]: { [position]: { name1Votes, name2Votes } } }
 */
async function aggregateVoteTallies(bracketId, bracket) {
  const userBrackets = await UserBracket.find({ bracketId, lockedAt: { $ne: null } });
  const tallies = {};

  const VALID_ROUNDS_AGG = ['roundOf32', 'roundOf16', 'elite8', 'final4', 'championship'];
  const AGG_ROUND_SIZES = { roundOf32: 16, roundOf16: 8, elite8: 4, final4: 2, championship: 1 };

  for (const roundKey of VALID_ROUNDS_AGG) {
    const roundSize = AGG_ROUND_SIZES[roundKey];
    if (roundSize === undefined) continue;

    tallies[roundKey] = {};

    for (let position = 0; position < roundSize; position++) {
      const matchups = bracket.matchups[roundKey];
      const matchup = matchups && matchups[position];

      let name1Id, name2Id, name1Votes, name2Votes;

      if (roundKey === 'final4') {
        // final4 — simple direct read from picks.final4[position].
        const pickCounts = {};
        userBrackets.forEach(ub => {
          const pick = ub.picks?.final4?.[position];
          if (!pick) return;
          pickCounts[pick] = (pickCounts[pick] || 0) + 1;
        });

        if (matchup && matchup.name1Id && matchup.name2Id) {
          name1Id = matchup.name1Id;
          name2Id = matchup.name2Id;
          name1Votes = pickCounts[name1Id] || 0;
          name2Votes = pickCounts[name2Id] || 0;
        } else {
          const sorted = Object.entries(pickCounts).sort((a, b) => b[1] - a[1]);
          name1Id = sorted[0]?.[0] ?? null;
          name2Id = sorted[1]?.[0] ?? null;
          name1Votes = sorted[0]?.[1] ?? 0;
          name2Votes = sorted[1]?.[1] ?? 0;
        }
        tallies[roundKey][position] = { name1Id, name1Votes, name2Id, name2Votes, allVotes: { ...pickCounts } };
      } else if (roundKey === 'championship') {
        // championship — reads from picks.championship[position].
        const pickCounts = {};
        userBrackets.forEach(ub => {
          const pick = ub.picks?.championship?.[position];
          if (!pick) return;
          pickCounts[pick] = (pickCounts[pick] || 0) + 1;
        });

        if (matchup && matchup.name1Id && matchup.name2Id) {
          name1Id = matchup.name1Id;
          name2Id = matchup.name2Id;
          name1Votes = pickCounts[name1Id] || 0;
          name2Votes = pickCounts[name2Id] || 0;
        } else {
          const sorted = Object.entries(pickCounts).sort((a, b) => b[1] - a[1]);
          name1Id = sorted[0]?.[0] ?? null;
          name2Id = sorted[1]?.[0] ?? null;
          name1Votes = sorted[0]?.[1] ?? 0;
          name2Votes = sorted[1]?.[1] ?? 0;
        }
        tallies[roundKey][position] = { name1Id, name1Votes, name2Id, name2Votes, allVotes: { ...pickCounts } };
      } else if (roundKey === 'roundOf32') {
        // R32 is the base round — read its own pick slot directly.
        const pickCounts = {};
        userBrackets.forEach(ub => {
          const pick = ub.picks?.roundOf32?.[position];
          if (!pick) return;
          pickCounts[pick] = (pickCounts[pick] || 0) + 1;
        });

        if (matchup && matchup.name1Id && matchup.name2Id) {
          name1Id = matchup.name1Id;
          name2Id = matchup.name2Id;
          name1Votes = pickCounts[name1Id] || 0;
          name2Votes = pickCounts[name2Id] || 0;
        } else {
          const sorted = Object.entries(pickCounts).sort((a, b) => b[1] - a[1]);
          name1Id = sorted[0] ? sorted[0][0] : null;
          name2Id = sorted[1] ? sorted[1][0] : null;
          name1Votes = sorted[0] ? sorted[0][1] : 0;
          name2Votes = sorted[1] ? sorted[1][1] : 0;
        }
        tallies[roundKey][position] = { name1Id, name1Votes, name2Id, name2Votes, allVotes: { ...pickCounts } };
      } else {
        // roundOf16 and elite8: simple direct read from ub.picks[roundKey][position].
        const pickCounts = {};
        userBrackets.forEach(ub => {
          const pick = ub.picks?.[roundKey]?.[position];
          if (!pick) return;
          pickCounts[pick] = (pickCounts[pick] || 0) + 1;
        });

        if (matchup && matchup.name1Id && matchup.name2Id) {
          name1Id = matchup.name1Id;
          name2Id = matchup.name2Id;
          name1Votes = pickCounts[name1Id] || 0;
          name2Votes = pickCounts[name2Id] || 0;
        } else {
          const sorted = Object.entries(pickCounts).sort((a, b) => b[1] - a[1]);
          name1Id = sorted[0] ? sorted[0][0] : null;
          name2Id = sorted[1] ? sorted[1][0] : null;
          name1Votes = sorted[0] ? sorted[0][1] : 0;
          name2Votes = sorted[1] ? sorted[1][1] : 0;
        }
        tallies[roundKey][position] = { name1Id, name1Votes, name2Id, name2Votes, allVotes: { ...pickCounts } };
      }
    }
  }

  return tallies;
}

/**
 * Helper function to normalize name strings for case-insensitive comparison
 */
const normalizeName = (name) => {
  return name.trim().toLowerCase();
};

/**
 * Helper function to find or create the active bracket
 */
const getOrCreateBracket = async () => {
  let bracket = await Bracket.findOne({ status: { $in: ['draft', 'active'] } })
    .sort({ createdAt: -1 });

  if (!bracket) {
    bracket = new Bracket({
      name: 'Baby Name March Madness',
      status: 'draft',
      owner1Names: [],
      owner2Names: [],
      sharedNames: []
    });
    await bracket.save();
  }

  return bracket;
};

/**
 * Resolve which owner a set of name IDs belongs to.
 * Returns 'Owner 1', 'Owner 2', or null (mixed / not found).
 */
const resolveOwnerFromIds = (bracket, ids) => {
  const idSet = new Set(ids);
  const inOwner1 = [...bracket.owner1Names, ...bracket.owner1BankNames].some(n => idSet.has(n.id));
  const inOwner2 = [...bracket.owner2Names, ...bracket.owner2BankNames].some(n => idSet.has(n.id));
  if (inOwner1 && !inOwner2) return 'Owner 1';
  if (inOwner2 && !inOwner1) return 'Owner 2';
  return null; // mixed or not found
};

/**
 * Helper function to find a bracket by ID, or fall back to getOrCreateBracket.
 */
const findBracket = async (bracketId) => {
  if (bracketId) {
    const bracket = await Bracket.findById(bracketId);
    if (!bracket) throw new Error(`Bracket not found: ${bracketId}`);
    return bracket;
  }
  return getOrCreateBracket();
};

/**
 * POST /api/bracket/names
 * Add a new name to the bracket
 * 
 * Request body:
 * {
 *   name: string,
 *   owner: "Owner 1" | "Owner 2"
 * }
 * 
 * Business Rules:
 * - Case-insensitive duplicate checking against partner's list
 * - If duplicate found: move to sharedNames list with "First added by" preservation
 * - Maximum 16 names per owner (excluding shared names)
 * - Maximum 32 total names in bracket
 */
const addName = async (req, res) => {
  try {
    const { name, owner, bracketId } = req.body;

    // Validation
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({
        error: 'Name is required and must be a non-empty string'
      });
    }

    if (!owner || !['Owner 1', 'Owner 2'].includes(owner)) {
      return res.status(400).json({
        error: 'Owner must be either "Owner 1" or "Owner 2"'
      });
    }

    const trimmedName = name.trim();
    const normalizedName = normalizeName(trimmedName);

    // Get or create the active bracket (or find specific bracket by ID)
    const bracket = await findBracket(bracketId);

    // Check if bracket is full (32 names total)
    if (bracket.isFull()) {
      return res.status(400).json({
        error: 'Bracket is full. Cannot add more names.',
        maxCapacity: 32,
        currentCount: bracket.getTotalNameCount()
      });
    }

    // Determine current owner's list and partner's list
    const currentOwnerList = owner === 'Owner 1' ? bracket.owner1Names : bracket.owner2Names;
    const partnerOwnerList = owner === 'Owner 1' ? bracket.owner2Names : bracket.owner1Names;
    const partnerOwner = owner === 'Owner 1' ? 'Owner 2' : 'Owner 1';

    // Check if name already exists in current owner's list
    const existsInCurrentList = currentOwnerList.some(
      n => normalizeName(n.value) === normalizedName
    );

    if (existsInCurrentList) {
      return res.status(400).json({
        error: 'You have already submitted this name',
        name: trimmedName
      });
    }

    // Check if name already exists in shared names
    const existsInSharedList = bracket.sharedNames.some(
      n => normalizeName(n.value) === normalizedName
    );

    if (existsInSharedList) {
      return res.status(400).json({
        error: 'This name is already in the shared favorites list',
        name: trimmedName
      });
    }

    // Check for case-insensitive duplicate in partner's list (THE DUPLICATE RULE)
    const duplicateInPartnerList = partnerOwnerList.find(
      n => normalizeName(n.value) === normalizedName
    );

    if (duplicateInPartnerList) {
      // Apply "The Duplicate Rule": Keep ONLY in original owner's list and add to shared list
      
      // Mark the existing name in partner's list as shared and move to top rank (index 0)
      const partnerListArray = owner === 'Owner 1' ? bracket.owner2Names : bracket.owner1Names;
      const partnerIndex = partnerListArray.findIndex(
        n => n.id === duplicateInPartnerList.id
      );
      
      if (partnerIndex !== -1) {
        // Mark as shared
        partnerListArray[partnerIndex].isShared = true;
        
        // Move to top rank if not already there (unshift to beginning)
        if (partnerIndex > 0) {
          const nameToMove = partnerListArray.splice(partnerIndex, 1)[0];
          partnerListArray.unshift(nameToMove);
        }
      }

      // DO NOT add to current owner's list - name stays only in original owner's list

      // Create the shared name entry preserving "First added by" (original submitter)
      const sharedNameEntry = {
        id: duplicateInPartnerList.id, // Use original ID
        value: duplicateInPartnerList.value, // Preserve original casing
        submittedBy: duplicateInPartnerList.submittedBy, // First added by (partner)
        isShared: true,
        createdAt: duplicateInPartnerList.createdAt // Preserve original timestamp
      };

      bracket.sharedNames.push(sharedNameEntry);

      // Auto-calculate preview matchups if bracket is in draft mode
      if (bracket.status === 'draft') {
        const totalNames = bracket.getTotalNameCount();
        
        if (totalNames === 32) {
          // Exactly 32 names: generate preview matchups
          const allNames = bracket.getAllNames();
          bracket.previewMatchups = generateRoundOf32Matchups(allNames);
        } else {
          // Less than 32 names: clear preview matchups
          bracket.previewMatchups = [];
        }
      }

      // Save the bracket
      await bracket.save();

      return res.status(200).json({
        message: `Duplicate detected! "${trimmedName}" is already on ${partnerOwner}'s list and has been added to Shared Favorites.`,
        isDuplicate: true,
        name: trimmedName,
        firstAddedBy: partnerOwner,
        sharedName: sharedNameEntry,
        bracket: {
          owner1Count: bracket.owner1Names.length,
          owner2Count: bracket.owner2Names.length,
          sharedCount: bracket.sharedNames.length,
          totalCount: bracket.getTotalNameCount()
        }
      });
    }

    // No duplicate found — if owner already has 16 active names, send to bank instead of erroring
    if (currentOwnerList.length >= 16) {
      const bankKey = owner === 'Owner 1' ? 'owner1BankNames' : 'owner2BankNames';
      const bankName = {
        id: uuidv4(),
        value: trimmedName,
        submittedBy: owner,
        isShared: false,
        status: 'bank',
        createdAt: new Date()
      };
      bracket[bankKey].push(bankName);
      await bracket.save();
      return res.status(201).json({
        message: 'Name added to your Name Bank (active list is full)',
        isBanked: true,
        name: bankName,
        bracket: {
          owner1Count: bracket.owner1Names.length,
          owner2Count: bracket.owner2Names.length
        }
      });
    }

    const newName = {
      id: uuidv4(),
      value: trimmedName,
      submittedBy: owner,
      isShared: false,
      createdAt: new Date()
    };

    currentOwnerList.push(newName);

    // Auto-calculate preview matchups if bracket is in draft mode
    if (bracket.status === 'draft') {
      const totalNames = bracket.getTotalNameCount();
      
      if (totalNames === 32) {
        // Exactly 32 names: generate preview matchups
        bracket.previewMatchups = generateDivisionMatchups(bracket.owner1Names, bracket.owner2Names);
      } else {
        // Less than 32 names: clear preview matchups
        bracket.previewMatchups = [];
      }
    }

    // Save the bracket
    await bracket.save();

    return res.status(201).json({
      message: 'Name added successfully',
      isDuplicate: false,
      name: newName,
      bracket: {
        owner1Count: bracket.owner1Names.length,
        owner2Count: bracket.owner2Names.length,
        sharedCount: bracket.sharedNames.length,
        totalCount: bracket.getTotalNameCount()
      }
    });

  } catch (error) {
    console.error('Error in addName controller:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * PATCH /api/brackets/:id/names/reorder
 * Accept a full replacement ordering (active + bank) for one owner and persist atomically.
 * Body: { updates: Array<{ id: string, rank: number|null, status: 'active'|'bank' }> }
 * Response: { success: true }
 */
const reorderNames = async (req, res) => {
  try {
    const { id } = req.params;
    const { updates } = req.body;
    // updates: Array<{ id: string, rank: number|null, status: 'active'|'bank' }>
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: 'updates array is required' });
    }
    const bracket = await findBracket(id);
    if (!bracket) return res.status(404).json({ error: 'Bracket not found' });

    // Determine owner from the submitted IDs
    const owner = resolveOwnerFromIds(bracket, updates.map(u => u.id));
    if (!owner) return res.status(400).json({ error: 'Could not resolve owner from name IDs' });

    const activeKey = owner === 'Owner 1' ? 'owner1Names'     : 'owner2Names';
    const bankKey   = owner === 'Owner 1' ? 'owner1BankNames' : 'owner2BankNames';

    // Build lookup map of all this owner's names (active + bank)
    const allOwnerNames = [...bracket[activeKey], ...bracket[bankKey]];
    const nameMap = Object.fromEntries(allOwnerNames.map(n => [n.id, n]));

    // Validate all IDs belong to this owner
    for (const u of updates) {
      if (!nameMap[u.id]) return res.status(400).json({ error: `Unknown name id: ${u.id}` });
    }

    // Partition updates into active (sorted by rank asc) and bank
    const activeUpdates = updates
      .filter(u => u.status === 'active')
      .sort((a, b) => a.rank - b.rank);
    const bankUpdates = updates.filter(u => u.status === 'bank');

    if (activeUpdates.length > 16) {
      return res.status(400).json({ error: 'Cannot have more than 16 active names' });
    }

    // Reconstruct arrays preserving all name fields
    bracket[activeKey] = activeUpdates.map(u => ({ ...nameMap[u.id].toObject(), status: 'active' }));
    bracket[bankKey]   = bankUpdates.map(u  => ({ ...nameMap[u.id].toObject(), status: 'bank', rank: null }));

    // Regenerate preview matchups if in draft mode and exactly 32 active names total
    if (bracket.status === 'draft') {
      const totalNames = bracket.getTotalNameCount();
      if (totalNames === 32) {
        bracket.previewMatchups = generateDivisionMatchups(bracket.owner1Names, bracket.owner2Names);
      } else {
        bracket.previewMatchups = [];
      }
    }

    await bracket.save();
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error in reorderNames:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

/**
 * GET /api/bracket/:sessionId
 * Fetch the bracket for a specific session
 *
 * Returns the complete bracket structure including:
 * - Individual owner name lists
 * - Shared names list
 * - Matchups organized by round
 * - Current tournament status and round
 */
const getBracket = async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Find bracket by session ID
    const bracket = await Bracket.findById(sessionId);

    if (!bracket) {
      return res.status(404).json({
        error: 'Bracket not found',
        sessionId
      });
    }

    const response = buildCurrentBracketResponse(bracket);
    const { owner1Icon, owner2Icon } = await resolveOwnerIcons(bracket);
    response.owner1Icon = owner1Icon;
    response.owner2Icon = owner2Icon;
    return res.status(200).json(response);

  } catch (error) {
    console.error('Error in getBracket controller:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

const resolveOwnerIcons = async (bracket) => {
  const ids = [bracket.owner1UserId, bracket.owner2UserId].filter(Boolean);
  if (!ids.length) return { owner1Icon: bracket.owner1Icon || '👤', owner2Icon: bracket.owner2Icon || '👤' };
  const users = await User.find({ id: { $in: ids } }).select('id icon').lean();
  const byId = Object.fromEntries(users.map(u => [u.id, u.icon]));
  return {
    owner1Icon: (bracket.owner1UserId && byId[bracket.owner1UserId]) || bracket.owner1Icon || '👤',
    owner2Icon: (bracket.owner2UserId && byId[bracket.owner2UserId]) || bracket.owner2Icon || '👤',
  };
};

/**
 * Build the standard response object for the current bracket.
 * Shared by getCurrentBracket, deleteName, removeSharedName, and removePendingName.
 */
const buildCurrentBracketResponse = (bracket) => {
  const allNames = bracket.getAllNames();
  return {
    id: bracket._id,
    name: bracket.name,
    status: bracket.status,
    currentRound: bracket.currentRound,
    owner1LockedIn: bracket.owner1LockedIn,
    owner2LockedIn: bracket.owner2LockedIn,

    // Ownership & invite
    owner1UserId:  bracket.owner1UserId  || null,
    owner2UserId:  bracket.owner2UserId  || null,
    owner1Name:    bracket.owner1Name    || '',
    owner1Icon:    bracket.owner1Icon    || '👤',
    owner2Name:    bracket.owner2Name    || '',
    owner2Icon:    bracket.owner2Icon    || '👤',
    inviteCode:    bracket.inviteCode    || null,

    // Name lists (flat structure for frontend compatibility)
    owner1Names: bracket.owner1Names,
    owner2Names: bracket.owner2Names,
    sharedNames: bracket.sharedNames,
    owner1PendingNames: bracket.owner1PendingNames,
    owner2PendingNames: bracket.owner2PendingNames,
    owner1BankNames: bracket.owner1BankNames,
    owner2BankNames: bracket.owner2BankNames,
    allNames: allNames,

    // Counts for UI display
    owner1Count: bracket.owner1Names.length,
    owner2Count: bracket.owner2Names.length,
    sharedCount: bracket.sharedNames.length,
    totalNames: bracket.getTotalNameCount(),
    remaining: 32 - bracket.getTotalNameCount(),

    // Matchups organized by round
    matchups: {
      roundOf32: bracket.matchups.roundOf32,
      roundOf16: bracket.matchups.roundOf16,
      elite8: bracket.matchups.elite8,
      final4: bracket.matchups.final4,
      championship: bracket.matchups.championship
    },

    // Champion (if tournament is complete)
    champion: bracket.championNameId ? {
      nameId: bracket.championNameId,
      name: bracket.findNameById(bracket.championNameId)
    } : null,

    // Admin-published rounds (guests see winner highlights only for these)
    publishedRounds: bracket.publishedRounds || [],

    // Timestamps
    createdAt: bracket.createdAt,
    updatedAt: bracket.updatedAt
  };
};

/**
 * GET /api/bracket/current
 * Fetch the current active bracket with all names and matchups
 *
 * This endpoint returns the most recent draft or active bracket.
 * Frontend uses this to display the current tournament state.
 *
 * Returns:
 * - All name lists (owner1Names, owner2Names, sharedNames)
 * - All matchups organized by round
 * - Current tournament status and metadata
 */
const getCurrentBracket = async (req, res) => {
  try {
    // Find the most recent active or draft bracket
    const bracket = await Bracket.findOne({ status: { $in: ['draft', 'active'] } })
      .sort({ createdAt: -1 });

    if (!bracket) {
      // Return an empty bracket structure if none exists
      return res.status(200).json({
        message: 'No active bracket found',
        status: 'draft',
        owner1Names: [],
        owner2Names: [],
        sharedNames: [],
        owner1PendingNames: [],
        owner2PendingNames: [],
        allNames: [],
        totalNames: 0,
        matchups: null
      });
    }

    return res.status(200).json(buildCurrentBracketResponse(bracket));

  } catch (error) {
    console.error('Error in getCurrentBracket controller:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * GET /api/bracket/preview
 * Generate preview matchups for the current draft bracket
 *
 * This endpoint generates preview matchups using the same seeding algorithm
 * as the actual tournament generation, but does NOT save them to the database.
 * This allows users to see what the bracket will look like before locking it in.
 *
 * Returns:
 * - canGenerate: boolean (true if exactly 32 names exist)
 * - preview: array of matchup objects with name details (includes placeholders if < 32 names)
 * - totalNames: current name count
 */
const getPreviewMatchups = async (req, res) => {
  try {
    // Get the active bracket (or find specific bracket by ID)
    const bracketId = req.query.bracketId || req.body.bracketId;
    const bracket = await findBracket(bracketId);

    // Get all names (can be < 32)
    const totalNames = bracket.getTotalNameCount();

    // Generate preview matchups using the same algorithm as generateBracket (handles < 32 names)
    const previewMatchups = generateDivisionMatchups(bracket.owner1Names, bracket.owner2Names);

    // Enrich matchups with full name details for the frontend
    const enrichedMatchups = previewMatchups.map((matchup, index) => {
      const name1 = matchup.name1Id ? bracket.findNameById(matchup.name1Id) : null;
      const name2 = matchup.name2Id ? bracket.findNameById(matchup.name2Id) : null;

      return {
        _id: matchup.id,
        id: matchup.id,
        round: matchup.round,
        name1Id: matchup.name1Id,
        name2Id: matchup.name2Id,
        name1: name1 ? {
          value: name1.value,
          seed: index * 2 + 1, // Calculate seed based on matchup position
          submittedBy: name1.submittedBy,
          isPlaceholder: false
        } : {
          value: 'TBD - Waiting for name submission',
          seed: 0,
          submittedBy: null,
          isPlaceholder: true
        },
        name2: name2 ? {
          value: name2.value,
          seed: index * 2 + 2, // Calculate seed based on matchup position
          submittedBy: name2.submittedBy,
          isPlaceholder: false
        } : {
          value: 'TBD - Waiting for name submission',
          seed: 0,
          submittedBy: null,
          isPlaceholder: true
        },
        votes: {
          name1Votes: 0,
          name2Votes: 0
        }
      };
    });

    return res.status(200).json({
      canGenerate: totalNames === 32,
      preview: enrichedMatchups,
      totalNames,
      message: totalNames === 32
        ? 'Preview matchups generated successfully'
        : `Preview generated with ${totalNames}/32 names (placeholders shown for missing slots)`
    });

  } catch (error) {
    console.error('Error in getPreviewMatchups controller:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * DELETE /api/names/:nameId
 * Remove a name from the bracket
 *
 * Automatically removes from the correct list (owner1Names, owner2Names, or sharedNames)
 * and returns updated bracket state.
 *
 * Sequential ranks are maintained via array position - no manual recalculation needed
 * in the backend as MongoDB arrays preserve order and the frontend calculates ranks
 * from array index.
 *
 * Path Parameters:
 * - nameId: UUID of the name to delete
 */
const deleteName = async (req, res) => {
  try {
    const { nameId } = req.params;
    const bracketId = req.body.bracketId || req.query.bracketId;

    // Validation
    if (!nameId || typeof nameId !== 'string') {
      return res.status(400).json({
        error: 'Valid nameId is required'
      });
    }

    // Get the active bracket (or find specific bracket by ID)
    const bracket = await findBracket(bracketId);

    // Track which lists the name was found in and the name details
    const foundInLists = [];
    let nameToDelete = null;

    // Check owner1Names
    const owner1Index = bracket.owner1Names.findIndex(n => n.id === nameId);
    if (owner1Index !== -1) {
      foundInLists.push('owner1Names');
      nameToDelete = bracket.owner1Names[owner1Index];
      bracket.owner1Names.splice(owner1Index, 1);
    }

    // Check owner2Names
    const owner2Index = bracket.owner2Names.findIndex(n => n.id === nameId);
    if (owner2Index !== -1) {
      foundInLists.push('owner2Names');
      if (!nameToDelete) {
        nameToDelete = bracket.owner2Names[owner2Index];
      }
      bracket.owner2Names.splice(owner2Index, 1);
    }

    // Check sharedNames
    const sharedIndex = bracket.sharedNames.findIndex(n => n.id === nameId);
    if (sharedIndex !== -1) {
      foundInLists.push('sharedNames');
      if (!nameToDelete) {
        nameToDelete = bracket.sharedNames[sharedIndex];
      }
      bracket.sharedNames.splice(sharedIndex, 1);
    }

    // If name not found in any list
    if (foundInLists.length === 0) {
      return res.status(404).json({
        error: 'Name not found in bracket',
        nameId
      });
    }

    // Auto-calculate preview matchups if bracket is in draft mode
    if (bracket.status === 'draft') {
      const totalNames = bracket.getTotalNameCount();

      if (totalNames === 32) {
        // Exactly 32 names: generate preview matchups
        const allNames = bracket.getAllNames();
        bracket.previewMatchups = generateRoundOf32Matchups(allNames);
      } else {
        // Less than 32 names: clear preview matchups
        bracket.previewMatchups = [];
      }
    }

    // Save the updated bracket
    // MongoDB automatically maintains array order, so ranks are preserved sequentially
    await bracket.save();

    // Auto-promote the oldest pending name if the affected owner's list is now below 16
    if (foundInLists.includes('owner1Names') && bracket.owner1PendingNames.length > 0 && bracket.owner1Names.length < 16) {
      const promoted = bracket.owner1PendingNames.shift();
      bracket.owner1Names.push(promoted);
      await bracket.save();
    } else if (foundInLists.includes('owner2Names') && bracket.owner2PendingNames.length > 0 && bracket.owner2Names.length < 16) {
      const promoted = bracket.owner2PendingNames.shift();
      bracket.owner2Names.push(promoted);
      await bracket.save();
    }

    return res.status(200).json(buildCurrentBracketResponse(bracket));

  } catch (error) {
    console.error('Error in deleteName controller:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * DELETE /api/shared-names/:id
 * Remove a name from sharedNames.
 * If the original adder is removing it, the name is transferred to the other owner's
 * active list (if below 16) or their pending queue (if at 16).
 */
const removeSharedName = async (req, res) => {
  try {
    const { id: nameId } = req.params;
    const { removedBy, bracketId } = req.body;

    if (!nameId || !removedBy || !['Owner 1', 'Owner 2'].includes(removedBy)) {
      return res.status(400).json({ error: 'nameId param and removedBy body field ("Owner 1" or "Owner 2") are required' });
    }

    const bracket = await findBracket(bracketId || req.query.bracketId);
    const sharedIndex = bracket.sharedNames.findIndex(n => n.id === nameId);
    if (sharedIndex === -1) return res.status(404).json({ error: 'Shared name not found' });

    const sharedItem = bracket.sharedNames[sharedIndex];
    bracket.sharedNames.splice(sharedIndex, 1);

    const isOriginalAdder = sharedItem.submittedBy === removedBy;
    if (isOriginalAdder) {
      const otherOwnerList   = removedBy === 'Owner 1' ? bracket.owner2Names        : bracket.owner1Names;
      const otherPendingList = removedBy === 'Owner 1' ? bracket.owner2PendingNames : bracket.owner1PendingNames;
      const transferEntry = {
        id: uuidv4(),
        value: sharedItem.value,
        submittedBy: sharedItem.submittedBy,
        isShared: false,
        createdAt: new Date()
      };
      if (otherOwnerList.length < 16) {
        otherOwnerList.push(transferEntry);
      } else {
        otherPendingList.push(transferEntry);
      }
    }

    await bracket.save();
    return res.status(200).json(buildCurrentBracketResponse(bracket));
  } catch (err) {
    console.error('Error removing shared name:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * DELETE /api/pending-names/:id
 * Remove a name from either owner's pending queue.
 */
const removePendingName = async (req, res) => {
  try {
    const { id: nameId } = req.params;
    const bracketId = req.body.bracketId || req.query.bracketId;
    if (!nameId) return res.status(400).json({ error: 'nameId param required' });

    const bracket = await findBracket(bracketId);

    const idx1 = bracket.owner1PendingNames.findIndex(n => n.id === nameId);
    if (idx1 !== -1) {
      bracket.owner1PendingNames.splice(idx1, 1);
    } else {
      const idx2 = bracket.owner2PendingNames.findIndex(n => n.id === nameId);
      if (idx2 !== -1) {
        bracket.owner2PendingNames.splice(idx2, 1);
      } else {
        return res.status(404).json({ error: 'Pending name not found' });
      }
    }

    await bracket.save();
    return res.status(200).json(buildCurrentBracketResponse(bracket));
  } catch (err) {
    console.error('Error removing pending name:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /api/bracket/generate
 * Generate tournament matchups using March Madness seeding algorithm
 *
 * This endpoint:
 * 1. Retrieves all names from the three lists (can be < 32)
 * 2. Runs the seeding algorithm to create 16 matchups (with placeholders if needed)
 * 3. Saves matchups to bracket.matchups.roundOf32
 * 4. Updates bracket status to 'active' only if 32 names are present
 *
 * NOTE: Empty slots will show as null IDs with placeholder text in the frontend
 */
const generateBracket = async (req, res) => {
  try {
    // Get the active bracket
    const bracketId = req.query.bracketId || req.body.bracketId;
    const bracket = await findBracket(bracketId);

    // Check if tournament has already been generated
    if (bracket.matchups.roundOf32.length > 0 && bracket.status === 'active') {
      return res.status(400).json({
        error: 'Tournament has already been generated and is active. Cannot regenerate matchups.',
        bracket: {
          status: bracket.status,
          currentRound: bracket.currentRound,
          totalNames: bracket.getTotalNameCount()
        }
      });
    }

    // Get all names from the three lists (can be < 32)
    const totalNames = bracket.getTotalNameCount();

    // Generate Round of 32 matchups using March Madness seeding (handles < 32 names)
    const roundOf32Matchups = generateDivisionMatchups(bracket.owner1Names, bracket.owner2Names);

    // Save matchups to the bracket
    bracket.matchups.roundOf32 = roundOf32Matchups;
    
    // Update bracket status to active only if we have exactly 32 names
    if (totalNames === 32) {
      bracket.status = 'active';
      bracket.currentRound = 'Round of 32';
    }

    // Save the updated bracket
    await bracket.save();

    return res.status(201).json({
      message: totalNames === 32
        ? 'Tournament bracket generated successfully'
        : `Matchups recalculated with ${totalNames}/32 names (placeholders used for missing slots)`,
      bracket: {
        id: bracket._id,
        status: bracket.status,
        currentRound: bracket.currentRound,
        matchupsGenerated: roundOf32Matchups.length,
        totalNames: totalNames,
        isComplete: totalNames === 32
      },
      matchups: roundOf32Matchups
    });

  } catch (error) {
    console.error('Error in generateBracket controller:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

// POST /api/bracket/reset
// Clears generated matchups and resets bracket to draft state so it can be
// regenerated. USE WITH CAUTION — this destroys all votes and matchup data.
const resetBracket = async (req, res) => {
  try {
    const bracket = await getOrCreateBracket();

    // Clear all matchups
    bracket.matchups.roundOf32 = [];
    bracket.matchups.roundOf16 = [];
    bracket.matchups.elite8 = [];
    bracket.matchups.final4 = [];
    bracket.matchups.championship = [];
    bracket.championNameId = null;

    // Reset status and round
    bracket.status = 'draft';
    bracket.currentRound = 'Round of 32';
    bracket.owner1LockedIn = false;
    bracket.owner2LockedIn = false;

    await bracket.save();

    return res.status(200).json({
      message: 'Bracket reset to draft. Names are preserved — regenerate to apply new seeding.',
      status: bracket.status,
    });
  } catch (err) {
    console.error('Error resetting bracket:', err);
    return res.status(500).json({ error: 'Failed to reset bracket' });
  }
};

/**
 * POST /api/bracket/lock
 * Lock the bracket and copy preview matchups to permanent tournament structure
 *
 * This endpoint replaces the old POST /api/bracket/generate endpoint.
 * It implements Phase 1 of the Auto-Preview Architecture:
 * - Validates bracket has exactly 32 names
 * - Copies previewMatchups to matchups.roundOf32 (permanent)
 * - Changes status from 'draft' to 'active'
 * - Locks the bracket (prevents further name changes)
 *
 * Requirements:
 * - Bracket must have exactly 32 names
 * - Bracket status must be 'draft' (not already locked)
 * - previewMatchups must be populated
 *
 * Response:
 * - 201: Bracket locked successfully, voting can begin
 * - 400: Validation error (not 32 names, already active, etc.)
 * - 500: Server error
 */
const lockBracket = async (req, res) => {
  try {
    // Get the active bracket
    const bracketId = req.query.bracketId || req.body.bracketId;
    const bracket = await findBracket(bracketId);

    // Validate bracket status
    if (bracket.status === 'active') {
      return res.status(400).json({
        error: 'Bracket is already locked and active. Cannot lock again.',
        bracket: {
          status: bracket.status,
          currentRound: bracket.currentRound
        }
      });
    }

    if (bracket.status === 'completed') {
      return res.status(400).json({
        error: 'Tournament is already completed. Cannot lock bracket.',
        bracket: {
          status: bracket.status,
          championNameId: bracket.championNameId
        }
      });
    }

    // Validate bracket has exactly 32 names
    const totalNames = bracket.getTotalNameCount();
    if (totalNames !== 32) {
      return res.status(400).json({
        error: 'Cannot lock bracket. Must have exactly 32 names.',
        currentCount: totalNames,
        required: 32,
        remaining: 32 - totalNames
      });
    }

    // Generate all round stubs upfront so future rounds are immediately visible
    const allStubs = generateAllRoundStubs(bracket.owner1Names, bracket.owner2Names);
    bracket.matchups.roundOf32    = allStubs.roundOf32;
    bracket.matchups.roundOf16    = allStubs.roundOf16;
    bracket.matchups.elite8       = allStubs.elite8;
    bracket.matchups.final4       = allStubs.final4;
    bracket.matchups.championship = allStubs.championship;

    // Change status to 'active' and set current round
    bracket.status = 'active';
    bracket.currentRound = 'Round of 32';

    // Save the locked bracket
    await bracket.save();

    return res.status(201).json({
      message: 'Bracket locked successfully! Voting is now open.',
      bracket: {
        id: bracket._id,
        status: bracket.status,
        currentRound: bracket.currentRound,
        totalNames: totalNames,
        matchupsGenerated: bracket.matchups.roundOf32.length
      },
      matchups: bracket.matchups.roundOf32
    });

  } catch (error) {
    console.error('Error in lockBracket controller:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * Advance Round
 * Processes the current round, determines winners, and advances them to the next round
 *
 * POST /api/bracket/advance
 *
 * Business Logic:
 * - Determines winner of each matchup based on vote counts
 * - Advances winners to the next round (e.g., Round of 32 → Round of 16)
 * - Updates bracket.currentRound to the new round
 * - Championship round sets bracket.championNameId and status to 'completed'
 *
 * @param {Object} req.body - { round: 'roundOf32' | 'roundOf16' | 'elite8' | 'final4' | 'championship' }
 * @returns {Object} Updated bracket with winners advanced to next round
 */
const advanceRound = async (req, res) => {
  try {
    const { round, bracketId } = req.body;

    // Validate round parameter
    if (!round) {
      return res.status(400).json({
        success: false,
        error: 'Round parameter is required'
      });
    }

    const validRounds = ['roundOf32', 'Round of 32', 'roundOf16', 'Round of 16', 'elite8', 'Elite 8', 'final4', 'Final 4', 'championship', 'Championship'];
    if (!validRounds.includes(round)) {
      return res.status(400).json({
        success: false,
        error: `Invalid round specified. Must be one of: ${validRounds.join(', ')}`
      });
    }

    // Get the active bracket (or find specific bracket by ID)
    const bracket = bracketId
      ? await findBracket(bracketId)
      : await Bracket.findOne({ status: { $in: ['active', 'completed'] } }).sort({ createdAt: -1 });

    if (!bracket) {
      return res.status(404).json({
        success: false,
        error: 'No active bracket found. Please generate a bracket first.'
      });
    }

    // Validate bracket is not in draft status
    if (bracket.status === 'draft') {
      return res.status(400).json({
        success: false,
        error: 'Cannot advance rounds on a draft bracket. Please lock the bracket first.'
      });
    }

    // Normalize round to camelCase key for fanOutScores
    const roundNormMap = {
      'roundOf32': 'roundOf32', 'Round of 32': 'roundOf32',
      'roundOf16': 'roundOf16', 'Round of 16': 'roundOf16',
      'elite8': 'elite8',       'Elite 8': 'elite8',
      'final4': 'final4',       'Final 4': 'final4',
      'championship': 'championship', 'Championship': 'championship',
    };
    const normalizedRoundKey = roundNormMap[round];

    // Auto-resolve winnerId for any matchup that doesn't already have one,
    // using owner1's UserBracket picks as the authoritative source.
    const roundMatchups = bracket.matchups[normalizedRoundKey];
    const hasUnresolved = roundMatchups && roundMatchups.some(m => !m.winnerId);

    if (hasUnresolved) {
      // Fetch owner1's UserBracket — no lockedAt filter; owners may not have locked.
      const owner1UB = bracket.owner1UserId
        ? await UserBracket.findOne({ bracketId: bracket._id, userId: bracket.owner1UserId })
        : null;

      // Collect vote tallies only if at least one position still needs a fallback.
      let tallies = null;

      for (let position = 0; position < roundMatchups.length; position++) {
        const matchup = roundMatchups[position];
        if (matchup.winnerId) continue; // already set — never overwrite

        // Primary source: owner1's pick for this position.
        const owner1Pick = owner1UB?.picks?.[normalizedRoundKey]?.[position];
        if (owner1Pick) {
          matchup.winnerId = owner1Pick;
          continue;
        }

        // Fallback: vote-tally leader among locked UserBrackets.
        if (!tallies) {
          tallies = await aggregateVoteTallies(bracket._id, bracket);
        }
        const positionTallies = tallies?.[normalizedRoundKey]?.[position];
        if (positionTallies) {
          const { name1Votes, name2Votes } = positionTallies;
          // name1Id wins on tie (mirrors proceedToNextRound tiebreaker convention).
          matchup.winnerId = name1Votes >= name2Votes ? matchup.name1Id : matchup.name2Id;
        }
        // If no votes exist at all, matchup.winnerId stays null and
        // advanceMatchupWinners will throw its original error — intentional.
      }

      bracket.markModified('matchups');
    }

    // Use the utility function to advance winners
    const updatedBracket = advanceMatchupWinners(bracket, round);

    // Mark matchups modified so Mongoose persists the subdocument array replacement
    updatedBracket.markModified('matchups');

    // Save the updated bracket
    await updatedBracket.save();

    // Fan out scores to locked-in user brackets (parity with proceedToNextRound)
    await fanOutScores(updatedBracket._id, normalizedRoundKey, updatedBracket.matchups[normalizedRoundKey]);

    res.status(200).json({
      success: true,
      message: `Successfully advanced winners from ${round} to the next round`,
      bracket: updatedBracket,
      status: updatedBracket.status,
      currentRound: updatedBracket.currentRound,
      championNameId: updatedBracket.championNameId
    });

  } catch (error) {
    console.error('Error advancing round:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to advance round',
      message: error.message
    });
  }
};

/**
 * Proceed to Next Round
 * Automatically picks vote-leaders as winners for the current round and advances to the next round.
 *
 * POST /api/bracket/:id/proceed-to-next-round
 *
 * @param {string} req.params.id - Bracket ID
 * @returns {Object} { advanced: true, bracket: <updated> }
 */
const proceedToNextRound = async (req, res) => {
  try {
    const bracketId = req.params.id;

    let bracket = await findBracket(bracketId);
    if (!bracket) {
      return res.status(404).json({ error: 'Bracket not found' });
    }

    if (bracket.status !== 'active') {
      return res.status(400).json({ error: 'Bracket is not active' });
    }

    const displayToCamel = {
      'Round of 32':  'roundOf32',
      'Round of 16':  'roundOf16',
      'Elite 8':      'elite8',
      'Final 4':      'final4',
      'Championship': 'championship',
    };
    const currentRoundKey = displayToCamel[bracket.currentRound];
    if (!currentRoundKey) {
      return res.status(400).json({ error: `Unrecognised round: ${bracket.currentRound}` });
    }

    const matchups = bracket.matchups[currentRoundKey];
    if (!matchups || matchups.length === 0) {
      return res.status(400).json({ error: 'No matchups found for the current round' });
    }

    const allHaveWinners = matchups.every(m => m.winnerId);
    if (!allHaveWinners) {
      return res.status(400).json({ error: 'All matchups must have a winner set before advancing' });
    }

    bracket = advanceMatchupWinners(bracket, currentRoundKey);

    await bracket.save();

    await fanOutScores(bracket._id, currentRoundKey, bracket.matchups[currentRoundKey]);

    return res.status(200).json({ advanced: true, bracket: buildCurrentBracketResponse(bracket) });

  } catch (error) {
    console.error('Error in proceedToNextRound:', error);
    return res.status(500).json({ error: 'Failed to proceed to next round', message: error.message });
  }
};

const VALID_ROUNDS = ['roundOf32', 'roundOf16', 'elite8', 'final4', 'championship'];
const ROUND_SIZES  = { roundOf32: 16, roundOf16: 8, elite8: 4, final4: 2, championship: 1 };

const defaultPicks = () => ({
  roundOf32:    Array(16).fill(null),
  roundOf16:    Array(8).fill(null),
  elite8:       Array(4).fill(null),
  final4:       Array(2).fill(null),
  championship: Array(1).fill(null),
});

/**
 * GET /api/bracket/:id/my-bracket
 * Fetch or initialize the caller's UserBracket for a given bracket.
 * Query param: userId (the voterId string)
 */
const getMyBracket = async (req, res) => {
  try {
    const bracketId = req.params.id;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    let userBracket = await UserBracket.findOne({ bracketId, userId });

    if (!userBracket) {
      return res.status(200).json({
        bracketId,
        userId,
        picks: defaultPicks(),
        score: 0,
        lockedAt: null,
      });
    }

    return res.status(200).json(userBracket);
  } catch (error) {
    console.error('Error in getMyBracket controller:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

/**
 * GET /api/bracket/:id/owner-brackets
 * Returns both owner UserBrackets. Requires the caller to be owner1 or owner2.
 */
const getOwnerBrackets = async (req, res) => {
  try {
    const bracketId = req.params.id;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const parentBracket = await Bracket.findById(bracketId).lean();
    if (!parentBracket) {
      return res.status(404).json({ error: 'Bracket not found' });
    }

    const { owner1UserId, owner2UserId } = parentBracket;
    const isOwner =
      (owner1UserId && owner1UserId.toString() === userId) ||
      (owner2UserId && owner2UserId.toString() === userId);

    if (!isOwner) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [owner1UB, owner2UB] = await Promise.all([
      owner1UserId ? UserBracket.findOne({ bracketId, userId: owner1UserId }) : null,
      owner2UserId ? UserBracket.findOne({ bracketId, userId: owner2UserId }) : null,
    ]);

    return res.json({ owner1Bracket: owner1UB || null, owner2Bracket: owner2UB || null });
  } catch (error) {
    console.error('Error in getOwnerBrackets controller:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

/**
 * POST /api/bracket/:id/my-bracket/pick
 * Upsert a single pick for the caller's UserBracket.
 * Body: { userId, round, position, selectedNameId }
 */
const submitPick = async (req, res) => {
  try {
    const bracketId = req.params.id;
    const { round, position, selectedNameId } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!round || position === undefined || !selectedNameId) {
      return res.status(400).json({ error: 'round, position, and selectedNameId are required' });
    }

    if (!VALID_ROUNDS.includes(round)) {
      return res.status(400).json({ error: `round must be one of: ${VALID_ROUNDS.join(', ')}` });
    }

    const roundSize = ROUND_SIZES[round];
    if (typeof position !== 'number' || position < 0 || position >= roundSize) {
      return res.status(400).json({ error: `position must be between 0 and ${roundSize - 1} for round ${round}` });
    }

    let userBracket = await UserBracket.findOneAndUpdate(
      { bracketId, userId },
      { $setOnInsert: { picks: defaultPicks(), score: 0, lockedAt: null } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (userBracket.lockedAt) {
      const parentBracket = await Bracket.findById(bracketId).lean();
      const isOwner = parentBracket &&
        (parentBracket.owner1UserId?.toString() === userId ||
         parentBracket.owner2UserId?.toString() === userId);
      if (!isOwner) {
        return res.status(400).json({ error: 'Bracket is locked' });
      }
      // Owner is allowed to update picks even when personally locked
    }

    const updated = await UserBracket.findOneAndUpdate(
      { bracketId, userId },
      { $set: { [`picks.${round}.${position}`]: selectedNameId } },
      { new: true }
    );

    return res.status(200).json(updated);
  } catch (error) {
    console.error('Error in submitPick controller:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

/**
 * POST /api/bracket/:id/my-bracket/lock
 * Lock the caller's UserBracket. Requires all 31 pick slots to be non-null.
 * Body: { userId }
 */
const lockMyBracket = async (req, res) => {
  try {
    const bracketId = req.params.id;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userBracket = await UserBracket.findOne({ bracketId, userId });
    if (!userBracket) {
      return res.status(404).json({ error: 'UserBracket not found' });
    }

    if (userBracket.lockedAt) {
      return res.status(400).json({ error: 'Already locked' });
    }

    const allFilled = Object.values(userBracket.picks.toObject
      ? userBracket.picks.toObject()
      : userBracket.picks
    ).flat().every(p => p !== null);

    if (!allFilled) {
      return res.status(400).json({ error: 'All 31 pick slots must be filled before locking' });
    }

    userBracket.lockedAt = new Date();
    await userBracket.save();

    return res.status(200).json(userBracket);
  } catch (error) {
    console.error('Error in lockMyBracket controller:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

/**
 * POST /api/bracket/:id/my-bracket/reset
 * Clear all picks for the caller's UserBracket and unset lockedAt.
 * Returns 403 if the bracket is already locked.
 * Body: { userId }
 */
const resetMyBracket = async (req, res) => {
  try {
    const bracketId = req.params.id;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userBracket = await UserBracket.findOne({ bracketId, userId });
    if (!userBracket) {
      return res.status(404).json({ error: 'UserBracket not found' });
    }

    if (userBracket.lockedAt) {
      return res.status(403).json({ error: 'Cannot reset a locked bracket' });
    }

    userBracket.picks = defaultPicks();
    userBracket.lockedAt = null;
    await userBracket.save();

    return res.status(200).json(userBracket);
  } catch (error) {
    console.error('Error in resetMyBracket controller:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

/**
 * POST /api/bracket/lock-in
 * Per-owner lock-in. Once both owners lock in and 32 names exist,
 * the bracket is automatically activated using the same logic as lockBracket.
 *
 * Body: { owner: "Owner 1" | "Owner 2" }
 *
 * Response: { owner1LockedIn, owner2LockedIn, status }
 */
const lockInOwner = async (req, res) => {
  try {
    const { owner, bracketId } = req.body;

    if (owner !== 'Owner 1' && owner !== 'Owner 2') {
      return res.status(400).json({
        error: 'Invalid owner value. Must be "Owner 1" or "Owner 2".'
      });
    }

    const bracket = await findBracket(bracketId);

    if (bracket.status === 'active') {
      return res.status(400).json({
        error: 'Bracket is already locked and active.',
        owner1LockedIn: bracket.owner1LockedIn,
        owner2LockedIn: bracket.owner2LockedIn,
        status: bracket.status
      });
    }

    // Set the appropriate lock-in flag
    if (owner === 'Owner 1') {
      bracket.owner1LockedIn = true;
    } else {
      bracket.owner2LockedIn = true;
    }

    // If both owners are locked in and there are exactly 32 names, activate the bracket
    const totalNames = bracket.getTotalNameCount();
    if (bracket.owner1LockedIn && bracket.owner2LockedIn && totalNames === 32) {
      // Generate all round stubs upfront so future rounds are immediately visible
      const allStubs = generateAllRoundStubs(bracket.owner1Names, bracket.owner2Names);
      bracket.matchups.roundOf32    = allStubs.roundOf32;
      bracket.matchups.roundOf16    = allStubs.roundOf16;
      bracket.matchups.elite8       = allStubs.elite8;
      bracket.matchups.final4       = allStubs.final4;
      bracket.matchups.championship = allStubs.championship;

      bracket.status = 'active';
      bracket.currentRound = 'Round of 32';
    }

    await bracket.save();

    return res.status(200).json({
      owner1LockedIn: bracket.owner1LockedIn,
      owner2LockedIn: bracket.owner2LockedIn,
      status: bracket.status
    });

  } catch (error) {
    console.error('Error in lockInOwner controller:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

/**
 * POST /api/bracket/reset-round
 * Undo the most recent round advancement so parents can re-pick winners.
 *
 * Round rollback map (currentRound → what to undo):
 *   "Round of 16"  → clear roundOf32 winnerId fields,  empty roundOf16 matchups
 *   "Elite 8"      → clear roundOf16 winnerId fields,  empty elite8 matchups
 *   "Final 4"      → clear elite8 winnerId fields,     empty final4 matchups
 *   "Championship" → clear final4 winnerId fields,     empty championship matchups
 *   "Completed"    → clear championship winnerId fields, clear championNameId, reset status to 'active'
 *   "Round of 32"  → edge case: just clear any winnerId already set on roundOf32 matchups
 *
 * Response:
 *   200: { message, currentRound, status }
 *   400: bracket not in 'active' or 'completed' state
 *   500: server error
 */
const resetRound = async (req, res) => {
  try {
    const bracketId = (req.body && req.body.bracketId) || req.query.bracketId;

    let activeBracket;
    if (bracketId) {
      activeBracket = await findBracket(bracketId);
    } else {
      const bracket = await getOrCreateBracket();
      activeBracket = bracket;
      // Also look for a completed bracket since getOrCreateBracket only finds draft/active
      if (bracket.status === 'draft') {
        const found = await require('../models/Bracket').findOne({ status: { $in: ['active', 'completed'] } })
          .sort({ createdAt: -1 });
        if (found) {
          activeBracket = found;
        }
      }
    }

    if (activeBracket.status !== 'active' && activeBracket.status !== 'completed') {
      return res.status(400).json({
        error: 'Cannot reset round. Bracket must be active or completed.',
        status: activeBracket.status
      });
    }

    const ROLLBACK_MAP = {
      'Round of 16':  { prevLabel: 'Round of 32', prevKey: 'roundOf32',  currentKey: 'roundOf16'    },
      'Elite 8':      { prevLabel: 'Round of 16', prevKey: 'roundOf16',  currentKey: 'elite8'       },
      'Final 4':      { prevLabel: 'Elite 8',     prevKey: 'elite8',     currentKey: 'final4'       },
      'Championship': { prevLabel: 'Final 4',     prevKey: 'final4',     currentKey: 'championship' },
      'Completed':    { prevLabel: 'Championship', prevKey: 'championship', currentKey: null         }
    };

    const currentRound = activeBracket.currentRound;

    if (currentRound === 'Round of 32') {
      // Edge case: clear any winnerId already set on roundOf32 matchups
      activeBracket.matchups.roundOf32.forEach(m => { m.winnerId = null; });
      await activeBracket.save();
      return res.status(200).json({
        message: 'Round of 32 winner selections cleared. This is the first round — no previous round to roll back to.',
        currentRound: activeBracket.currentRound,
        status: activeBracket.status
      });
    }

    const rollback = ROLLBACK_MAP[currentRound];
    if (!rollback) {
      return res.status(400).json({
        error: `Unrecognized currentRound value: "${currentRound}"`,
        status: activeBracket.status
      });
    }

    // 1. Clear winnerId on all matchups in the previous round
    activeBracket.matchups[rollback.prevKey].forEach(m => { m.winnerId = null; });

    // 2. Restore the rolled-back round's stubs to their seeded state so future-round
    //    cards remain visible (rather than clearing the array to empty).
    if (rollback.currentKey) {
      const freshStubs = generateAllRoundStubs(activeBracket.owner1Names, activeBracket.owner2Names);
      activeBracket.matchups[rollback.currentKey] = freshStubs[rollback.currentKey];
    }

    // 3. Roll currentRound back to the previous round label
    activeBracket.currentRound = rollback.prevLabel;

    // 4. If we were at "Completed", also clear champion fields and restore active status
    if (currentRound === 'Completed') {
      activeBracket.championNameId = null;
      activeBracket.status = 'active';
    }

    await activeBracket.save();

    return res.status(200).json({
      message: `Round reset successful. Rolled back from "${currentRound}" to "${rollback.prevLabel}".`,
      currentRound: activeBracket.currentRound,
      status: activeBracket.status
    });

  } catch (error) {
    console.error('Error in resetRound controller:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
};

// POST /api/admin/set-winner
// Body: { matchupId, winnerId }
const setMatchupWinner = async (req, res) => {
  try {
    const { matchupId, winnerId } = req.body;
    if (!matchupId || !winnerId) {
      return res.status(400).json({ error: 'matchupId and winnerId are required' });
    }

    const bracketId = req.query.bracketId || req.body.bracketId;
    const bracket = await findBracket(bracketId);
    if (!bracket) return res.status(404).json({ error: 'No active bracket found' });

    // Search all rounds for this matchup
    const allRoundKeys = ['roundOf32', 'roundOf16', 'elite8', 'final4', 'championship'];
    let found = false;
    for (const roundKey of allRoundKeys) {
      const matchup = bracket.matchups[roundKey].find(m => m.id === matchupId);
      if (matchup) {
        matchup.winnerId = winnerId;
        found = true;
        break;
      }
    }

    if (!found) return res.status(404).json({ error: 'Matchup not found' });

    await bracket.save();
    return res.status(200).json({ success: true, matchupId, winnerId });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to set matchup winner' });
  }
};

// POST /api/admin/publish-round
// Body: { round }  e.g. 'roundOf32'
const publishRound = async (req, res) => {
  try {
    const { round } = req.body;
    if (!round) return res.status(400).json({ error: 'round is required' });

    const bracketId = req.query.bracketId || req.body.bracketId;
    const bracket = await findBracket(bracketId);
    if (!bracket) return res.status(404).json({ error: 'No active bracket found' });

    if (!bracket.publishedRounds.includes(round)) {
      bracket.publishedRounds.push(round);
    }

    await bracket.save();
    return res.status(200).json({ success: true, publishedRounds: bracket.publishedRounds });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to publish round' });
  }
};

// POST /api/admin/reset-and-regenerate
// Clears all matchups, publishedRounds, and championNameId,
// resets status to 'draft', then immediately regenerates roundOf32 with the current
// seeding algorithm if 32 names are present. Names are preserved through both steps.
const resetAndRegenerate = async (req, res) => {
  try {
    const bracketId = req.query.bracketId || req.body.bracketId;
    const bracket = await findBracket(bracketId);

    // 1. Clear everything except names
    bracket.matchups.roundOf32    = [];
    bracket.matchups.roundOf16    = [];
    bracket.matchups.elite8       = [];
    bracket.matchups.final4       = [];
    bracket.matchups.championship = [];
    bracket.publishedRounds = [];
    bracket.championNameId = null;
    bracket.status         = 'draft';
    bracket.currentRound   = 'Round of 32';
    bracket.owner1LockedIn = false;
    bracket.owner2LockedIn = false;

    // 2. Validate we have 32 names
    const totalNames = bracket.getTotalNameCount();
    if (totalNames !== 32) {
      await bracket.save();
      return res.status(400).json({
        error: `Reset to draft — need 32 names to regenerate. Currently ${totalNames}/32.`,
        status: bracket.status
      });
    }

    // 3. Generate all round stubs upfront so future rounds are immediately visible
    const allStubs = generateAllRoundStubs(bracket.owner1Names, bracket.owner2Names);
    bracket.matchups.roundOf32    = allStubs.roundOf32;
    bracket.matchups.roundOf16    = allStubs.roundOf16;
    bracket.matchups.elite8       = allStubs.elite8;
    bracket.matchups.final4       = allStubs.final4;
    bracket.matchups.championship = allStubs.championship;
    bracket.status = 'active';
    bracket.currentRound = 'Round of 32';

    await bracket.save();

    return res.status(200).json({
      success: true,
      message: 'Bracket reset and regenerated with new seeding. All votes cleared.',
      status: bracket.status,
      currentRound: bracket.currentRound,
    });
  } catch (err) {
    console.error('Error in resetAndRegenerate controller:', err);
    return res.status(500).json({ error: 'Failed to reset and regenerate' });
  }
};

// POST /api/admin/unlock-names
// Clears all matchups, publishedRounds, and championNameId,
// resets status to 'draft' and currentRound to 'Round of 32'.
// Names (owner1Names, owner2Names, sharedNames) are preserved.
// Returns 400 if bracket is already in draft status.
const unlockNames = async (req, res) => {
  try {
    const bracketId = req.query.bracketId || req.body.bracketId;
    const bracket = await findBracket(bracketId);

    if (bracket.status === 'draft') {
      return res.status(400).json({
        error: 'Bracket is already in draft status. Nothing to unlock.'
      });
    }

    bracket.matchups.roundOf32    = [];
    bracket.matchups.roundOf16    = [];
    bracket.matchups.elite8       = [];
    bracket.matchups.final4       = [];
    bracket.matchups.championship = [];
    bracket.publishedRounds = [];
    bracket.championNameId = null;
    bracket.status         = 'draft';
    bracket.currentRound   = 'Round of 32';
    bracket.owner1LockedIn = false;
    bracket.owner2LockedIn = false;

    await bracket.save();

    return res.status(200).json({
      success: true,
      bracket: {
        status: bracket.status,
        currentRound: bracket.currentRound,
      }
    });
  } catch (err) {
    console.error('Error in unlockNames controller:', err);
    return res.status(500).json({ error: 'Failed to unlock names' });
  }
};

const unlockLockin = async (req, res) => {
  try {
    const bracketId = req.query.bracketId || req.body.bracketId;
    const bracket = await findBracket(bracketId);

    // Guard: nothing to unlock if neither owner is locked in
    if (!bracket.owner1LockedIn && !bracket.owner2LockedIn) {
      return res.status(400).json({ error: 'Neither owner is locked in. Nothing to unlock.' });
    }

    bracket.owner1LockedIn = false;
    bracket.owner2LockedIn = false;
    bracket.matchups.roundOf32    = [];
    bracket.matchups.roundOf16    = [];
    bracket.matchups.elite8       = [];
    bracket.matchups.final4       = [];
    bracket.matchups.championship = [];
    bracket.previewMatchups = [];
    bracket.status       = 'draft';
    bracket.currentRound = 'Round of 32';
    bracket.publishedRounds = [];
    bracket.championNameId  = null;

    await UserBracket.deleteMany({ bracketId: bracket._id });
    await bracket.save();

    return res.status(200).json({
      success: true,
      owner1LockedIn: false,
      owner2LockedIn: false,
      status: 'draft',
    });
  } catch (err) {
    console.error('Error in unlockLockin controller:', err);
    return res.status(500).json({ error: 'Failed to unlock lock-in' });
  }
};

/**
 * GET /api/bracket/owner-picks
 * Returns per-matchup owner picks across ALL rounds.
 * Response: { ownerPicks: { [matchupId]: { owner1NameId, owner2NameId } } }
 */
const getOwnerPicks = async (req, res) => {
  try {
    // Owner picks are now derived from UserBracket documents (owner role support is a future extension).
    return res.status(200).json({ ownerPicks: {} });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch owner picks' });
  }
};

/**
 * GET /api/baby-names?gender=girl|boy|neutral
 * Returns curated baby names filtered by gender.
 * girl    → girl + neutral names
 * boy     → boy + neutral names
 * neutral → neutral names only
 */
const getNamesByGender = async (req, res) => {
  const { gender } = req.query;
  const valid = ['girl', 'boy', 'neutral'];
  if (!gender || !valid.includes(gender)) {
    return res.status(400).json({ error: 'gender query param must be girl, boy, or neutral' });
  }
  const filter = gender === 'girl'    ? { gender: { $in: ['girl', 'neutral'] } }
               : gender === 'boy'     ? { gender: { $in: ['boy', 'neutral'] } }
               : /* neutral */          { gender: 'neutral' };
  const names = await BabyName.find(filter).lean();
  return res.json({ names: names.map(n => ({ id: n.id, name: n.name, gender: n.gender })) });
};

/**
 * GET /api/bracket/:id/invite-link
 * Returns a stable shareable link for the bracket.
 * Lazily generates shareToken on first call if not yet set.
 * Requires auth; only the bracket owner (owner1 or owner2) may access.
 */
const getInviteLink = async (req, res) => {
  try {
    const bracket = await findBracket(req.params.id);

    const isOwner =
      bracket.owner1UserId === req.userId ||
      bracket.owner2UserId === req.userId;
    if (!isOwner) {
      return res.status(403).json({ error: 'Forbidden: you are not an owner of this bracket' });
    }

    if (!bracket.shareToken) {
      bracket.shareToken = uuidv4();
      await bracket.save();
    }

    const APP_URL = process.env.APP_URL || 'http://localhost:3000';
    const shareLink = `${APP_URL}/bracket/${bracket._id}?share=${bracket.shareToken}`;

    return res.status(200).json({ shareLink });
  } catch (error) {
    console.error('Error in getInviteLink controller:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

/**
 * POST /api/bracket/:id/join-share
 * Accept a share-token invite link and register the authenticated user as a guest participant.
 * Idempotent — safe to call multiple times for the same user/bracket pair.
 * Body: { shareToken: string }
 * Response: { bracketId } or { bracketId, alreadyOwner: true }
 */
const joinViaShareToken = async (req, res) => {
  try {
    const { id } = req.params;
    const { shareToken } = req.body;
    const userId = req.userId;

    if (!shareToken) {
      return res.status(400).json({ error: 'shareToken is required' });
    }

    const bracket = await Bracket.findOne({ _id: id, shareToken });
    if (!bracket) {
      return res.status(404).json({ error: 'Invalid share token' });
    }

    // Owners do not need to join as guests
    if (bracket.owner1UserId === userId || bracket.owner2UserId === userId) {
      return res.status(200).json({ bracketId: bracket._id, alreadyOwner: true });
    }

    // Idempotent — only push if not already present
    if (!bracket.guestUserIds.includes(userId)) {
      bracket.guestUserIds.push(userId);
      await bracket.save();
    }

    // Eagerly create the UserBracket so getMyBracket returns a real document
    await UserBracket.findOneAndUpdate(
      { bracketId: bracket._id, userId },
      { $setOnInsert: { picks: defaultPicks(), score: 0, lockedAt: null } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({ bracketId: bracket._id });
  } catch (error) {
    console.error('Error in joinViaShareToken:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

/**
 * POST /api/bracket/:id/invite
 * Sends invitation emails to the provided list of addresses.
 * Lazily generates shareToken on first call if not yet set.
 * Requires auth; only the bracket owner (owner1 or owner2) may access.
 *
 * Body: { emails: string[] }
 * Response: { invited: number, shareLink: string }
 */
const sendInvites = async (req, res) => {
  try {
    const { emails } = req.body;

    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ error: 'emails must be a non-empty array' });
    }

    const bracket = await findBracket(req.params.id);

    const isOwner =
      bracket.owner1UserId === req.userId ||
      bracket.owner2UserId === req.userId;
    if (!isOwner) {
      return res.status(403).json({ error: 'Forbidden: you are not an owner of this bracket' });
    }

    if (!bracket.shareToken) {
      bracket.shareToken = uuidv4();
      await bracket.save();
    }

    const APP_URL = process.env.APP_URL || 'http://localhost:3000';
    const shareLink = `${APP_URL}/bracket/${bracket._id}?share=${bracket.shareToken}`;

    await Promise.all(
      emails.map(email => sendBracketInviteEmail(email, shareLink, bracket.name))
    );

    return res.status(200).json({ invited: emails.length, shareLink });
  } catch (error) {
    console.error('Error in sendInvites controller:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

const deleteBracket = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const bracket = await Bracket.findById(sessionId);
    if (!bracket) return res.status(404).json({ error: 'Bracket not found' });
    const bracketId = bracket._id.toString();
    await Bracket.deleteOne({ _id: sessionId });
    return res.status(200).json({ deleted: true, bracketId });
  } catch (error) {
    console.error('Error in deleteBracket controller:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

const deleteGuestSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { guestId } = req.body;
    if (!guestId) return res.status(400).json({ error: 'guestId is required' });
    const bracket = await Bracket.findById(sessionId);
    if (!bracket) return res.status(404).json({ error: 'Guest session not found' });
    // Remove UserBracket for this guest
    const result = await UserBracket.deleteOne({ bracketId: sessionId, userId: guestId });
    return res.status(200).json({ removed: true, userBracketDeleted: result.deletedCount > 0 });
  } catch (error) {
    console.error('Error in deleteGuestSession controller:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

const removeOwner2 = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const bracket = await Bracket.findById(sessionId);
    if (!bracket) return res.status(404).json({ error: 'Bracket not found' });

    // 1. Clear owner2Names entirely
    bracket.owner2Names = [];
    bracket.owner2PendingNames = [];

    // 2. Clear all sharedNames (removing Owner 2 invalidates all shared pairs)
    bracket.sharedNames = [];

    // 3. Clear isShared flags on all owner1Names (no partner list = no duplicates)
    bracket.owner1Names = bracket.owner1Names.map(n => {
      n.isShared = false;
      return n;
    });

    // 4. Clear all matchup rounds, reset bracket state
    bracket.matchups.roundOf32 = [];
    bracket.matchups.roundOf16 = [];
    bracket.matchups.elite8 = [];
    bracket.matchups.final4 = [];
    bracket.matchups.championship = [];
    bracket.publishedRounds = [];
    bracket.championNameId = null;
    bracket.status = 'draft';
    bracket.currentRound = 'Round of 32';
    bracket.owner1LockedIn = false;
    bracket.owner2LockedIn = false;

    // 5. Delete all UserBracket prediction documents for this bracket
    //    (covers Owner 1, Owner 2, and every guest — all must re-pick fresh)
    await UserBracket.deleteMany({ bracketId: bracket._id });

    // 6. Clear guest participant list
    bracket.guestUserIds = [];

    // 7. Clear Owner 2 identity so a new Owner 2 can be invited
    bracket.owner2UserId = null;
    bracket.owner2Name   = '';
    bracket.owner2Icon   = '👤';
    bracket.owner2Email  = '';
    bracket.inviteCode   = null;   // will be regenerated when a new Owner 2 is invited

    await bracket.save();
    return res.status(200).json({ reset: true, bracket: buildCurrentBracketResponse(bracket) });
  } catch (error) {
    console.error('Error in removeOwner2 controller:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

/**
 * GET /api/bracket/:id/vote-tallies
 * Returns per-matchup vote tallies aggregated from all locked UserBracket documents.
 * Response: { tallies: { [roundKey]: { [position]: { name1Votes, name2Votes } } } }
 */
const getVoteTallies = async (req, res) => {
  try {
    const bracketId = req.params.id;
    const bracket = await findBracket(bracketId);
    if (!bracket) return res.status(404).json({ error: 'Bracket not found' });

    const tallies = await aggregateVoteTallies(bracketId, bracket);
    return res.status(200).json({ tallies });
  } catch (error) {
    console.error('Error in getVoteTallies:', error);
    return res.status(500).json({ error: 'Failed to fetch vote tallies', message: error.message });
  }
};

const ROUND_PROGRESSION = ['roundOf32', 'roundOf16', 'elite8', 'final4', 'championship'];

/**
 * GET /api/bracket/:id/scores
 * Returns all locked UserBrackets for a bracket with computed score, maxPossible,
 * and tiebreakerDelta, sorted by score desc then tiebreakerDelta asc.
 */
const getScores = async (req, res) => {
  try {
    const bracketId = req.params.id;

    const [userBrackets, bracket] = await Promise.all([
      UserBracket.find({ bracketId, lockedAt: { $ne: null } }).lean(),
      findBracket(bracketId),
    ]);

    if (!bracket) return res.status(404).json({ error: 'Bracket not found' });

    // Compute championship actual vote percentage if championship is resolved
    let championshipActualPct = null;
    if (bracket.championNameId) {
      const champMatchups = bracket.matchups.championship;
      if (champMatchups && champMatchups.length > 0) {
        const cm = champMatchups[0];
        if (cm.winnerId) {
          // Use raw tallies from locked UserBrackets for the championship position
          const allLocked = await UserBracket.find({ bracketId, lockedAt: { $ne: null } }).lean();
          let winnerVotes = 0;
          let totalVotes = 0;
          allLocked.forEach(ub => {
            const pick = ub.picks?.championship?.[0];
            if (!pick) return;
            totalVotes++;
            if (pick === cm.winnerId) winnerVotes++;
          });
          championshipActualPct = totalVotes > 0 ? (winnerVotes / totalVotes) * 100 : null;
        }
      }
    }

    // Collect unique userIds for display name/icon lookup
    const userIds = [...new Set(userBrackets.map(ub => ub.userId))];
    const users = await User.find({ id: { $in: userIds } }).select('id displayName icon').lean();
    const userMap = Object.fromEntries(users.map(u => [u.id, u]));

    const results = userBrackets.map(ub => {
      // maxPossible: current score + points from alive picks in unresolved rounds
      const maxPossible = computeMaxPossible(ub, bracket);

      // tiebreakerDelta
      let tiebreakerDelta = null;
      if (championshipActualPct !== null && ub.tiebreakerPrediction != null) {
        tiebreakerDelta = Math.abs(championshipActualPct - ub.tiebreakerPrediction);
      }

      const user = userMap[ub.userId] || {};

      return {
        userId: ub.userId,
        displayName: user.displayName || null,
        icon: user.icon || null,
        score: ub.score,
        maxPossible,
        tiebreakerPrediction: ub.tiebreakerPrediction ?? null,
        tiebreakerDelta,
      };
    });

    // Sort: score desc, then tiebreakerDelta asc (nulls last)
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.tiebreakerDelta === null && b.tiebreakerDelta === null) return 0;
      if (a.tiebreakerDelta === null) return 1;
      if (b.tiebreakerDelta === null) return -1;
      return a.tiebreakerDelta - b.tiebreakerDelta;
    });

    return res.status(200).json(results);
  } catch (error) {
    console.error('Error in getScores:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

/**
 * POST /api/bracket/:id/my-bracket/tiebreaker
 * Save the authenticated user's championship vote-split prediction.
 * Body: { prediction: Number (0-100) }
 */
const saveTiebreakerPrediction = async (req, res) => {
  try {
    const bracketId = req.params.id;
    const userId = req.userId;
    const { prediction } = req.body;

    if (typeof prediction !== 'number' || prediction < 0 || prediction > 100) {
      return res.status(400).json({ error: 'prediction must be a number between 0 and 100' });
    }

    const updated = await UserBracket.findOneAndUpdate(
      { bracketId, userId },
      { $set: { tiebreakerPrediction: prediction } },
      { new: true, upsert: false }
    );

    if (!updated) {
      return res.status(404).json({ error: 'UserBracket not found' });
    }

    return res.status(200).json(updated);
  } catch (error) {
    console.error('Error in saveTiebreakerPrediction:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

module.exports = {
  addName,
  reorderNames,
  getBracket,
  getCurrentBracket,
  getPreviewMatchups,
  deleteName,
  removeSharedName,
  removePendingName,
  generateBracket,
  resetBracket,
  lockBracket,
  lockInOwner,
  advanceRound,
  resetRound,
  getOwnerPicks,
  setMatchupWinner,
  publishRound,
  resetAndRegenerate,
  unlockNames,
  unlockLockin,
  getNamesByGender,
  getInviteLink,
  joinViaShareToken,
  sendInvites,
  deleteBracket,
  deleteGuestSession,
  removeOwner2,
  proceedToNextRound,
  getMyBracket,
  getOwnerBrackets,
  submitPick,
  lockMyBracket,
  resetMyBracket,
  getVoteTallies,
  getScores,
  saveTiebreakerPrediction
};
