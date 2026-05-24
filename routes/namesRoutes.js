'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { suggestNames } = require('../controllers/namesController');

const router = express.Router();

router.post('/names/suggest', requireAuth, suggestNames);

module.exports = router;
