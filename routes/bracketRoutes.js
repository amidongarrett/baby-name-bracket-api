/**
 * Bracket Routes
 * Express routing table for bracket and name operations
 */

const express = require('express');
const router = express.Router();
const {
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
} = require('../controllers/bracketController');
const { requireAuth, optionalAuth } = require('../middleware/auth');

/**
 * POST /api/names
 * Add a new name to the bracket
 * 
 * Request body:
 * {
 *   name: string,
 *   owner: "Owner 1" | "Owner 2"
 * }
 * 
 * Business Rules:
 * - Case-insensitive duplicate checking
 * - Move duplicates to shared names list
 * - Maximum 16 names per owner
 * - Maximum 32 total names in bracket
 */
router.get('/baby-names', getNamesByGender);
router.post('/names', addName);

/**
 * GET /api/bracket/current
 * Fetch the current active or draft bracket
 *
 * Returns:
 * - Complete bracket structure with names and matchups
 * - Individual owner name lists (owner1Names, owner2Names, sharedNames)
 * - All unique names in a flat array (allNames)
 * - Tournament status and round information
 * - Matchups organized by round
 *
 * This is the primary endpoint used by the frontend to display the current bracket state.
 */
router.get('/bracket/current', getCurrentBracket);

/**
 * GET /api/bracket/owner-picks
 * Returns per-matchup owner picks for conflict detection.
 * Response: { ownerPicks: { [matchupId]: { owner1NameId, owner2NameId } } }
 */
router.get('/bracket/owner-picks', getOwnerPicks);

/**
 * GET /api/bracket/preview
 * Generate preview matchups for the current draft bracket
 *
 * Returns:
 * - canGenerate: boolean (true if exactly 32 names exist)
 * - preview: array of matchup objects with full name details
 * - totalNames: current name count
 *
 * This endpoint shows users what the bracket will look like before generating it.
 * Uses the same March Madness seeding algorithm as the actual generation.
 * Does NOT save matchups to the database (read-only preview).
 */
router.get('/bracket/preview', getPreviewMatchups);

/**
 * GET /api/bracket/:id/invite-link
 * Returns a stable shareable link for the bracket (lazily creates shareToken).
 * Requires Bearer JWT; owner only.
 */
router.get('/bracket/:id/invite-link', requireAuth, getInviteLink);

/**
 * POST /api/bracket/:id/invite
 * Sends invitation emails to the provided list of addresses.
 * Body: { emails: string[] }
 * Requires Bearer JWT; owner only.
 */
router.post('/bracket/:id/invite', requireAuth, sendInvites);
router.post('/bracket/:id/proceed-to-next-round', requireAuth, proceedToNextRound);
router.get('/bracket/:id/vote-tallies', getVoteTallies);
router.get('/bracket/:id/scores', getScores);

router.get('/bracket/:id/my-bracket',         requireAuth, getMyBracket);
router.get('/bracket/:id/owner-brackets',     requireAuth, getOwnerBrackets);
router.post('/bracket/:id/my-bracket/pick',   requireAuth, submitPick);
router.post('/bracket/:id/my-bracket/lock',       requireAuth, lockMyBracket);
router.post('/bracket/:id/my-bracket/reset',      requireAuth, resetMyBracket);
router.post('/bracket/:id/my-bracket/tiebreaker', requireAuth, saveTiebreakerPrediction);
router.post('/bracket/:id/join-share',            requireAuth, joinViaShareToken);

/**
 * PATCH /api/brackets/:id/names/reorder
 * Accept full replacement ordering for one owner (active + bank) and persist atomically.
 * Requires auth so only the owning parent can reorder.
 */
router.patch('/brackets/:id/names/reorder', requireAuth, reorderNames);

/**
 * GET /api/bracket/:sessionId
 * Fetch the bracket for a specific session
 *
 * Path Parameters:
 * - sessionId: Unique identifier for the bracket session
 *
 * Returns:
 * - Complete bracket structure with names and matchups
 * - Individual owner name lists
 * - Shared names list
 * - Tournament status and round information
 */
router.get('/bracket/:sessionId', getBracket);

/**
 * DELETE /api/names/:nameId
 * Remove a name from the bracket and recalculate ranks
 *
 * Path Parameters:
 * - nameId: UUID of the name to delete
 *
 * Response:
 * - 200: Name deleted successfully with updated counts
 * - 404: Name not found in any list
 * - 500: Server error
 */
router.delete('/names/:nameId', deleteName);
router.delete('/shared-names/:id', removeSharedName);
router.delete('/pending-names/:id', removePendingName);

// More-specific sub-paths must be registered before the bare /:sessionId wildcard
router.delete('/bracket/:sessionId/guest', deleteGuestSession);
router.delete('/bracket/:sessionId/owner2', requireAuth, removeOwner2);
router.delete('/bracket/:sessionId', requireAuth, deleteBracket);

/**
 * POST /api/bracket/generate
 * Generate tournament matchups using March Madness seeding algorithm
 *
 * Requirements:
 * - Bracket must have exactly 32 names (16 from Owner 1, 16 from Owner 2, or distributed with shared names)
 * - Tournament cannot have already been generated
 *
 * Process:
 * 1. Validates bracket has exactly 32 names total
 * 2. Retrieves all names from owner1Names, owner2Names, and sharedNames lists
 * 3. Applies March Madness seeding pattern (Seed 1 vs 32, 2 vs 31, etc.)
 * 4. Creates 16 matchups for Round of 32
 * 5. Saves matchups to bracket.matchups.roundOf32
 * 6. Updates bracket status to 'active'
 *
 * Response:
 * - 201: Tournament generated successfully with matchups array
 * - 400: Validation error (not enough names, already generated, etc.)
 * - 500: Server error
 */
router.post('/bracket/generate', generateBracket);

/**
 * POST /api/bracket/lock
 * Lock the bracket and activate voting (Phase 1: Auto-Preview Architecture)
 *
 * This endpoint replaces the functionality of /api/bracket/generate by:
 * 1. Validating bracket has exactly 32 names
 * 2. Copying previewMatchups to permanent matchups.roundOf32
 * 3. Changing status from 'draft' to 'active'
 * 4. Locking the bracket (prevents further name changes)
 *
 * Requirements:
 * - Bracket must be in 'draft' status
 * - Must have exactly 32 names
 *
 * Response:
 * - 201: Bracket locked successfully, voting open
 * - 400: Validation error (wrong name count, already locked, etc.)
 * - 500: Server error
 */
router.post('/bracket/reset', resetBracket);
router.post('/bracket/lock', lockBracket);
router.post('/bracket/lock-in', lockInOwner);
router.post('/admin/set-winner', setMatchupWinner);
router.post('/admin/publish-round', publishRound);
router.post('/admin/reset-and-regenerate', resetAndRegenerate);
router.post('/admin/unlock-names', unlockNames);
router.post('/admin/unlock-lockin', unlockLockin);

/**
 * POST /api/bracket/advance
 * Advance winners from the current round to the next round
 *
 * Request Body:
 * {
 *   round: string ('roundOf32' | 'roundOf16' | 'elite8' | 'final4' | 'championship')
 * }
 *
 * Business Rules:
 * - Determines winner of each matchup based on vote tallies
 * - Advances winners to appropriate slots in next round
 * - Updates bracket.currentRound
 * - Championship round sets championNameId and completes tournament
 *
 * Response:
 * - 200: Round advanced successfully with updated bracket
 * - 400: Invalid round parameter or bracket not locked
 * - 404: No active bracket found
 * - 500: Server error
 */
router.post('/bracket/advance', advanceRound);

/**
 * POST /api/bracket/reset-round
 * Undo the most recent round advancement so parents can re-pick winners.
 *
 * No request body required — the bracket's currentRound field determines
 * which round is rolled back.
 *
 * Response:
 *   200: { message, currentRound, status }
 *   400: Bracket not in 'active' or 'completed' state
 *   500: Server error
 */
router.post('/bracket/reset-round', resetRound);

module.exports = router;
