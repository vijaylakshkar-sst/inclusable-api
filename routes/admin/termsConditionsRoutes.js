const express = require('express');
const router = express.Router();
const termsController = require('../../controllers/admin/termsConditionsController');
const auth = require('../../middleware/auth'); // your JWT auth middleware

router.post('/', auth, termsController.createTerms);      // Create
router.get('/', auth, termsController.getAllTerms);       // List all
router.get('/:id', auth, termsController.getTermById);    // Get one
router.put('/:id', auth, termsController.updateTerm);     // Update
router.delete('/:id', auth, termsController.deleteTerm);  // Delete

module.exports = router;
