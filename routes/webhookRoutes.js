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


router.post("/stripe/cab-booking-webhook", express.raw({ type: "application/json" }), webhookController.handleCabBookingWebhook);

module.exports = router;