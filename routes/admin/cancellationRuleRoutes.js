const express = require('express');
const router = express.Router();
const cancellationRuleController = require('../../controllers/admin/cancellationRuleController');
const auth = require('../../middleware/auth'); 

router.post('/', auth, cancellationRuleController.createRule);     // Create
router.get('/', auth, cancellationRuleController.getAllRules);       // List all
router.get('/:id', auth, cancellationRuleController.getRuleById);   // Get one
router.put('/:id', auth, cancellationRuleController.updateRule);   // Update
router.delete('/:id', auth, cancellationRuleController.deleteRule); // Delete

module.exports = router;
