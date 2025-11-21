const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();

const { handleInAppWebhook, AppleWebhook, GoogleWebhook } = require('../controllers/inAppWebhookController');

// ✅ IAP webhook just needs normal JSON
router.post('/in-app-webhook/iap', express.json({ limit: '2mb' }), handleInAppWebhook);

router.post('/apple/app-store-webhook', express.json({ limit: '2mb' }), AppleWebhook);

router.post('/google/app-store-webhook', express.json({ limit: '2mb' }), GoogleWebhook);

module.exports = router;