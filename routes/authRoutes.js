const express = require('express');
const router = express.Router();
const { requestCode, verifyCode, setName, getMe, updateProfile, verifyEmailChange } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

router.post('/request-code', requestCode);
router.post('/verify-code', verifyCode);
router.post('/set-name', requireAuth, setName);
router.get('/me', requireAuth, getMe);
router.put('/profile', requireAuth, updateProfile);
router.post('/verify-email-change', requireAuth, verifyEmailChange);

module.exports = router;
