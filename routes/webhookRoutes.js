const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const bodyParser = require('body-parser');

router.post('/stripe/webhook', bodyParser.raw({ type: 'application/json' }), webhookController.handleStripeWebhook);

module.exports = router; // ✅ this is mandatory