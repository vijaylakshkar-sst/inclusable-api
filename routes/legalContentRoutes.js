const express = require('express');
const router = express.Router();
const legalContentController = require('../controllers/legalContentController');
const auth = require('../middleware/auth');


router.get('/privacy-policy', legalContentController.getPrivacyPolicy);
router.get('/terms-and-conditions', legalContentController.getTermsConditions);
router.post('/help-and-support', auth, legalContentController.createSupportTicket);

module.exports = router;