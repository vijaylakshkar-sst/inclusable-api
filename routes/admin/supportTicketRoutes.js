const express = require('express');
const router = express.Router();
const supportTicketController = require('../../controllers/admin/supportTicketController');
const auth = require('../../middleware/auth'); // your JWT auth middleware

router.get('/', auth, supportTicketController.getAllSupportTickets);       // List all
router.put('/:id/status', auth, supportTicketController.updateTicketStatus);    // Update

module.exports = router;
