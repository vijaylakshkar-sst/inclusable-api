const express = require('express');
const bodyParser = require('body-parser');
const router = express.Router();

const webhookController = require('../controllers/webhookController');

// ✅ Stripe webhook requires RAW body
router.post(
  '/stripe/webhook',
  bodyParser.raw({ type: 'application/json' }),
  webhookController.handleStripeWebhook
);


module.exports = router;