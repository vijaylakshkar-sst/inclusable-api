const express = require('express');
const router = express.Router();
const locationAccessibilityController = require('../controllers/locationAccessibilityController');
const auth = require('../middleware/auth');

router.get('/location-accessibility/values', locationAccessibilityController.getDropdownValues);
router.post('/location-accessibility/submit', auth, locationAccessibilityController.submitLocationAccessibility);

module.exports = router; 