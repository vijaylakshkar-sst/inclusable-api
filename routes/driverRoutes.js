const express = require('express');
const router = express.Router();
const driverController = require('../controllers/driverController');
const auth = require('../middleware/auth');

router.post('/create',auth, driverController.createDriver);
router.put('/update/:id',auth, driverController.updateDriver);

module.exports = router;