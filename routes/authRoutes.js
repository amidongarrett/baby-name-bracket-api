const express = require('express');
const router = express.Router();
const { requestCode, verifyCode, setName, getMe } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

router.post('/request-code', requestCode);
router.post('/verify-code', verifyCode);
router.post('/set-name', requireAuth, setName);
router.get('/me', requireAuth, getMe);

module.exports = router;
