const express = require('express');
const router = express.Router();
const { createBracket, listMyBrackets, joinBracket, acceptOwner2, resendOwner2Invite } = require('../controllers/lobbyController');
const { requireAuth } = require('../middleware/auth');

router.post('/brackets',                         requireAuth, createBracket);
router.get('/brackets/mine',                     requireAuth, listMyBrackets);
router.post('/brackets/join',                    requireAuth, joinBracket);
router.get('/brackets/:inviteCode/accept-owner', requireAuth, acceptOwner2);
router.post('/brackets/:id/invite-owner2',       requireAuth, resendOwner2Invite);

module.exports = router;
