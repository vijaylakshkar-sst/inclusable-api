const express = require('express');
const router = express.Router();
const vehicleModelsController = require('../../controllers/admin/vehicleModelsController');
const auth = require('../../middleware/auth'); // if you have authentication

// CREATE
router.post('/', auth, vehicleModelsController.createVehicleModel);

// READ ALL
router.get('/', auth, vehicleModelsController.getAllVehicleModels);

// READ BY ID
router.get('/:id', auth, vehicleModelsController.getVehicleModelById);

// UPDATE
router.put('/:id', auth, vehicleModelsController.updateVehicleModel);

// DELETE
router.delete('/:id', auth, vehicleModelsController.deleteVehicleModel);

module.exports = router;
