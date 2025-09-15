const express = require('express');
const router = express.Router();
const userController = require('../../controllers/admin/userController');
const auth = require('../../middleware/auth'); // your JWT auth middleware

router.delete('/:id',auth, userController.deleteUser);
router.get('/ndis-members',auth, userController.getNdisMembers);
router.get('/business-members',auth, userController.getBusinessMembers);
router.get('/events-by-business/:id', auth, userController.getEventsByBusiness);
router.get('/user-bookings/:id', auth, userController.getUserEventBookings);
router.delete('/event/:id', auth, userController.deleteEvent);


module.exports = router;
