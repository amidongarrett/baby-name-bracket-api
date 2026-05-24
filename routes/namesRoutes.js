'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { suggestNames, getPreferences, patchPreferences } = require('../controllers/namesController');

const router = express.Router();

router.post('/names/suggest',                           requireAuth, suggestNames);
router.get('/names/preferences/:bracketId',             requireAuth, getPreferences);
router.patch('/names/preferences/:bracketId',           requireAuth, patchPreferences);

module.exports = router;
