const express = require('express');
const router = express.Router();
const privacyPolicyController = require('../../controllers/admin/privacyPolicyController');
const auth = require('../../middleware/auth'); // your JWT auth middleware

router.post('/', auth, privacyPolicyController.createPrivacy);      // Create
router.get('/', auth, privacyPolicyController.getAllPrivacy);       // List all
router.get('/:id', auth, privacyPolicyController.getPrivacyById);   // Get one
router.put('/:id', auth, privacyPolicyController.updatePrivacy);    // Update
router.delete('/:id', auth, privacyPolicyController.deletePrivacy); // Delete

module.exports = router;
