const express = require('express');
const router = express.Router();
const ndisController = require('../controllers/ndisController');
const auth = require('../middleware/auth');

router.get('/ndis/values', ndisController.getDropdownValues);
router.post('/ndis/submit', auth, ndisController.submitNdisInfo);

module.exports = router; 