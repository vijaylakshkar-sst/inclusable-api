const express = require('express');
const router = express.Router();
const vehicleMakesController = require('../../controllers/admin/vehicleMakesController');
const auth = require('../../middleware/auth'); // your JWT auth middleware

router.post('/',auth, vehicleMakesController.createVehicleMake);
router.get('/', auth, vehicleMakesController.getAllVehicleMakes);
router.get('/:id', auth, vehicleMakesController.getVehicleMakeById);
router.put('/:id', auth, vehicleMakesController.updateVehicleMake);
router.delete('/:id', auth, vehicleMakesController.deleteVehicleMake);

module.exports = router;
