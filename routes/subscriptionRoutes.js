// routes/subscriptionRoutes.js
const express = require('express');
const router = express.Router();
const { getSubscriptionPlans, startFreeTrial, getCurrentSubscription } = require('../controllers/subscriptionController');
const auth = require('../middleware/auth');

// Example: /api/subscriptions/Company or /api/subscriptions/NDIS Members
router.get('/',auth, getSubscriptionPlans);

router.get('/current',auth, getCurrentSubscription);

router.post('/start-trial', auth, startFreeTrial);

module.exports = router;
