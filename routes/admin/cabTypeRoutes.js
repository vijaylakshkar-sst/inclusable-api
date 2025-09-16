const express = require('express');
const router = express.Router();
const cabTypeController = require('../../controllers/admin/cabTypeController');
const auth = require('../../middleware/auth'); // your JWT auth middleware
const upload = require('../../middleware/upload');

router.post('/', upload.single('thumbnail'), cabTypeController.createCabType);     // Create
router.get('/', auth, cabTypeController.getAllCabTypes);       // List all
router.get('/:id', auth, cabTypeController.getCabTypeById);   // Get one
router.put('/:id', upload.single('thumbnail'), cabTypeController.updateCabType);   // Update
router.delete('/:id', auth, cabTypeController.deleteCabType); // Delete

module.exports = router;
