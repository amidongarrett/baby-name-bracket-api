const Bracket = require('../models/Bracket');
const BabyName = require('../models/BabyName');
const { v4: uuidv4 } = require('uuid');
const { generateDivisionMatchups, generateAllRoundStubs } = require('../utils/seedingAlgorithm');
const { advanceMatchupWinners } = require('../utils/bracketProgression');
const { sendBracketInviteEmail } = require('../utils/email');

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

    // No duplicate found - add to current owner's list
    // Check owner's individual submission limit (16 names)
    if (currentOwnerList.length >= 16) {
      return res.status(400).json({
        error: `${owner} has reached the maximum submission limit of 16 names`,
        currentCount: currentOwnerList.length,
        maxLimit: 16
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

    return res.status(200).json(buildCurrentBracketResponse(bracket));

  } catch (error) {
    console.error('Error in getBracket controller:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
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
    owner2Name:    bracket.owner2Name    || '',
    inviteCode:    bracket.inviteCode    || null,

    // Name lists (flat structure for frontend compatibility)
    owner1Names: bracket.owner1Names,
    owner2Names: bracket.owner2Names,
    sharedNames: bracket.sharedNames,
    owner1PendingNames: bracket.owner1PendingNames,
    owner2PendingNames: bracket.owner2PendingNames,
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

    // Clear all matchups and votes
    bracket.matchups.roundOf32 = [];
    bracket.matchups.roundOf16 = [];
    bracket.matchups.elite8 = [];
    bracket.matchups.final4 = [];
    bracket.matchups.championship = [];
    bracket.votes = [];
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
 * POST /api/votes/:matchupId
 * Cast a vote for a specific matchup in the bracket
 *
 * Path Parameters:
 * - matchupId: UUID of the matchup to vote on
 *
 * Request Body:
 * {
 *   voterId: string (guest user identifier),
 *   selectedNameId: string (UUID of the chosen name)
 * }
 *
 * Business Rules:
 * - Prevents duplicate votes: each voterId can only vote once per matchupId
 * - Validates the selectedNameId is one of the two names in the matchup
 * - Increments the appropriate vote counter (name1Votes or name2Votes)
 * - Stores complete vote metadata for audit trail
 */
// If both owners have now voted on this matchup, auto-set winnerId when they agree
// or clear it when they conflict. No-op for guest votes (role is null).
function resolveOwnerWinner(bracket, matchup, role) {
  if (role !== 'Owner 1' && role !== 'Owner 2') return;
  const o1Vote = bracket.votes.find(v => v.matchupId === matchup.id && v.role === 'Owner 1');
  const o2Vote = bracket.votes.find(v => v.matchupId === matchup.id && v.role === 'Owner 2');
  if (o1Vote && o2Vote) {
    matchup.winnerId = (o1Vote.selectedNameId === o2Vote.selectedNameId)
      ? o1Vote.selectedNameId
      : null;
  }
}

const castVote = async (req, res) => {
  try {
    const { matchupId } = req.params;
    const { voterId, selectedNameId, role = null } = req.body;

    // Validation
    if (!matchupId || typeof matchupId !== 'string') {
      return res.status(400).json({
        error: 'Valid matchupId is required'
      });
    }

    if (!voterId || typeof voterId !== 'string' || voterId.trim() === '') {
      return res.status(400).json({
        error: 'voterId is required and must be a non-empty string'
      });
    }

    if (!selectedNameId || typeof selectedNameId !== 'string') {
      return res.status(400).json({
        error: 'selectedNameId is required and must be a valid UUID'
      });
    }

    // Get the active bracket
    const bracketId = req.query.bracketId || req.body.bracketId;
    const bracket = await findBracket(bracketId);

    if (!bracket) {
      return res.status(404).json({
        error: 'No active bracket found. Tournament may not have started yet.'
      });
    }

    // Find the matchup across all rounds
    let matchup = null;
    let roundKey = null;
    
    for (const [key, matchups] of Object.entries(bracket.matchups)) {
      const found = matchups.find(
        m => m.id === matchupId || m._id?.toString() === matchupId
      );
      if (found) {
        matchup = found;
        roundKey = key;
        break;
      }
    }

    if (!matchup) {
      return res.status(404).json({
        error: 'Matchup not found',
        matchupId
      });
    }

    // Validate selectedNameId is one of the two names in this matchup
    if (selectedNameId !== matchup.name1Id && selectedNameId !== matchup.name2Id) {
      return res.status(400).json({
        error: 'selectedNameId must be one of the names in this matchup',
        validOptions: {
          name1Id: matchup.name1Id,
          name2Id: matchup.name2Id
        }
      });
    }

    // Check for duplicate vote: owners deduplicate by role (so both can vote independently
    // even on the same device); guests deduplicate by voterId.
    const existingVote = (role === 'Owner 1' || role === 'Owner 2')
      ? bracket.votes.find(v => v.matchupId === matchup.id && v.role === role)
      : bracket.votes.find(v => v.matchupId === matchupId && v.voterId === voterId);

    if (existingVote) {
      // Get the name details for response (needed in all branches)
      const selectedName = bracket.findNameById(selectedNameId);
      const matchupResponse = {
        id: matchup.id,
        round: matchup.round,
        name1Id: matchup.name1Id,
        name2Id: matchup.name2Id,
        votes: {
          name1Votes: matchup.votes.name1Votes,
          name2Votes: matchup.votes.name2Votes,
          total: matchup.votes.name1Votes + matchup.votes.name2Votes
        }
      };

      // No change — same name selected again
      if (existingVote.selectedNameId === selectedNameId) {
        return res.status(200).json({
          message: 'Vote unchanged',
          vote: existingVote,
          matchup: matchupResponse,
          selectedName: selectedName ? { id: selectedName.id, value: selectedName.value } : null
        });
      }

      // Different name — decrement old tally, update record, increment new tally
      if (existingVote.selectedNameId === matchup.name1Id) {
        matchup.votes.name1Votes = Math.max(0, matchup.votes.name1Votes - 1);
      } else {
        matchup.votes.name2Votes = Math.max(0, matchup.votes.name2Votes - 1);
      }

      existingVote.selectedNameId = selectedNameId;
      existingVote.role = role;
      existingVote.createdAt = new Date();

      if (selectedNameId === matchup.name1Id) {
        matchup.votes.name1Votes += 1;
      } else {
        matchup.votes.name2Votes += 1;
      }

      resolveOwnerWinner(bracket, matchup, role);
      await bracket.save();

      matchupResponse.votes = {
        name1Votes: matchup.votes.name1Votes,
        name2Votes: matchup.votes.name2Votes,
        total: matchup.votes.name1Votes + matchup.votes.name2Votes
      };

      return res.status(200).json({
        message: 'Vote updated successfully',
        vote: existingVote,
        matchup: matchupResponse,
        selectedName: selectedName ? { id: selectedName.id, value: selectedName.value } : null
      });
    }

    // Create vote metadata — always key by the matchup's UUID (not the URL param,
    // which could be a MongoDB ObjectId string) so voteMap lookups are consistent.
    const voteRecord = {
      id: uuidv4(),
      matchupId: matchup.id,
      voterId,
      selectedNameId,
      role,
      createdAt: new Date()
    };

    // Add vote to bracket's votes array
    bracket.votes.push(voteRecord);

    // Increment the appropriate vote tally in the matchup
    if (selectedNameId === matchup.name1Id) {
      matchup.votes.name1Votes += 1;
    } else {
      matchup.votes.name2Votes += 1;
    }

    resolveOwnerWinner(bracket, matchup, role);

    // Save the updated bracket
    await bracket.save();

    // Get the name details for response
    const selectedName = bracket.findNameById(selectedNameId);

    return res.status(201).json({
      message: 'Vote cast successfully',
      vote: voteRecord,
      matchup: {
        id: matchup.id,
        round: matchup.round,
        name1Id: matchup.name1Id,
        name2Id: matchup.name2Id,
        votes: {
          name1Votes: matchup.votes.name1Votes,
          name2Votes: matchup.votes.name2Votes,
          total: matchup.votes.name1Votes + matchup.votes.name2Votes
        }
      },
      selectedName: selectedName ? {
        id: selectedName.id,
        value: selectedName.value
      } : null
    });

  } catch (error) {
    console.error('Error in castVote controller:', error);
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

    // Use the utility function to advance winners
    const updatedBracket = advanceMatchupWinners(bracket, round);

    // Save the updated bracket
    await updatedBracket.save();

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

/**
 * GET /api/votes/user/:voterId
 * Return all matchup IDs the given voter has already voted on.
 * Used by the frontend to disable vote buttons on page load.
 *
 * Response: { voterId, votedMatchupIds: string[] }
 */
const getUserVotes = async (req, res) => {
  try {
    const { voterId } = req.params;
    if (!voterId) return res.status(400).json({ error: 'voterId is required' });

    const bracket = await Bracket.findOne({ status: { $in: ['active', 'completed'] } }).sort({ createdAt: -1 });
    if (!bracket) return res.status(200).json({ voterId, votedMatchupIds: [], voteMap: {}, lockedRounds: [] });

    const userVotes = bracket.votes.filter(v => v.voterId === voterId);

    // Map of matchupId → selectedNameId
    const voteMap = {};
    userVotes.forEach(v => { voteMap[v.matchupId] = v.selectedNameId; });

    // Rounds this guest has locked in
    const lockedRounds = bracket.guestLockIns
      .filter(li => li.voterId === voterId)
      .map(li => li.round);

    return res.status(200).json({
      voterId,
      votedMatchupIds: userVotes.map(v => v.matchupId),
      voteMap,
      lockedRounds
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to get user votes' });
  }
};

// POST /api/bracket/guest-lock-in
// Body: { voterId, round }
// Marks the guest as locked in for that round. Cannot lock in twice for the same round.
const guestLockIn = async (req, res) => {
  try {
    const { voterId, round } = req.body;
    if (!voterId || !round) {
      return res.status(400).json({ error: 'voterId and round are required' });
    }

    const bracketId = req.query.bracketId || req.body.bracketId;
    const bracket = await findBracket(bracketId);
    if (!bracket) return res.status(404).json({ error: 'No active bracket found' });

    // Prevent duplicate lock-in for same round
    const alreadyLocked = bracket.guestLockIns.some(li => li.voterId === voterId && li.round === round);
    if (alreadyLocked) {
      const lockedRounds = bracket.guestLockIns.filter(li => li.voterId === voterId).map(li => li.round);
      return res.status(200).json({ success: true, alreadyLocked: true, lockedRounds });
    }

    bracket.guestLockIns.push({ voterId, round, lockedAt: new Date() });
    await bracket.save();

    const lockedRounds = bracket.guestLockIns.filter(li => li.voterId === voterId).map(li => li.round);
    return res.status(201).json({ success: true, lockedRounds });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to lock in guest picks' });
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
// Clears all matchups, votes, guestLockIns, publishedRounds, and championNameId,
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
    bracket.votes          = [];
    bracket.guestLockIns   = [];
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
// Clears all matchups, votes, guestLockIns, publishedRounds, and championNameId,
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
    bracket.votes          = [];
    bracket.guestLockIns   = [];
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

/**
 * GET /api/bracket/owner-picks
 * Returns per-matchup owner picks across ALL rounds.
 * Response: { ownerPicks: { [matchupId]: { owner1NameId, owner2NameId } } }
 */
const getOwnerPicks = async (req, res) => {
  try {
    const bracketId = req.query.bracketId || req.body.bracketId;
    const bracket = await findBracket(bracketId);
    const ownerPicks = {};

    bracket.votes
      .filter(v => v.role === 'Owner 1' || v.role === 'Owner 2')
      .forEach(v => {
        if (!ownerPicks[v.matchupId]) {
          ownerPicks[v.matchupId] = { owner1NameId: null, owner2NameId: null };
        }
        if (v.role === 'Owner 1') ownerPicks[v.matchupId].owner1NameId = v.selectedNameId;
        if (v.role === 'Owner 2') ownerPicks[v.matchupId].owner2NameId = v.selectedNameId;
      });

    return res.status(200).json({ ownerPicks });
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
    // Remove all votes by this guest
    const before = bracket.votes.length;
    bracket.votes = bracket.votes.filter(v => v.voterId !== guestId);
    // Remove guest lock-in entries for this guest
    bracket.guestLockIns = bracket.guestLockIns.filter(li => li.voterId !== guestId);
    await bracket.save();
    const votesRemoved = before - bracket.votes.length;
    return res.status(200).json({ removed: true, votesRemoved });
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

    // 2. Remove sharedNames entries where submittedBy === 'Owner 2'
    bracket.sharedNames = bracket.sharedNames.filter(n => n.submittedBy !== 'Owner 2');

    // 3. Clear isShared flags on all owner1Names (no partner list = no duplicates)
    bracket.owner1Names = bracket.owner1Names.map(n => {
      n.isShared = false;
      return n;
    });

    // 4. Clear all matchup rounds and votes, reset bracket state
    bracket.matchups.roundOf32 = [];
    bracket.matchups.roundOf16 = [];
    bracket.matchups.elite8 = [];
    bracket.matchups.final4 = [];
    bracket.matchups.championship = [];
    bracket.votes = [];
    bracket.guestLockIns = [];
    bracket.publishedRounds = [];
    bracket.championNameId = null;
    bracket.status = 'draft';
    bracket.currentRound = 'Round of 32';
    bracket.owner1LockedIn = false;
    bracket.owner2LockedIn = false;

    await bracket.save();
    return res.status(200).json({ reset: true, bracket: buildCurrentBracketResponse(bracket) });
  } catch (error) {
    console.error('Error in removeOwner2 controller:', error);
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
};

module.exports = {
  addName,
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
  castVote,
  getUserVotes,
  advanceRound,
  resetRound,
  getOwnerPicks,
  guestLockIn,
  setMatchupWinner,
  publishRound,
  resetAndRegenerate,
  unlockNames,
  getNamesByGender,
  getInviteLink,
  sendInvites,
  deleteBracket,
  deleteGuestSession,
  removeOwner2
};
