const express = require('express');
const router = express.Router();
const legalContentController = require('../controllers/legalContentController');

router.get('/privacy-policy', legalContentController.getPrivacyPolicy);
router.get('/terms-and-conditions', legalContentController.getTermsConditions);

module.exports = router;