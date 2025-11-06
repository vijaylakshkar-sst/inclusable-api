const express = require('express');
const router = express.Router();
const ndisController = require('../controllers/ndisController');
const auth = require('../middleware/auth');
const { checkFeatureAccess } = require('../middleware/checkPermission');

router.get('/ndis/values', ndisController.getDropdownValues);
router.post('/ndis/submit', auth, checkFeatureAccess('maxCategories'), ndisController.submitNdisInfo);

module.exports = router; 