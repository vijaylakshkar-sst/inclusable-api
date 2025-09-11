const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const auth = require('../middleware/auth');

router.get('/user-bookings', auth, bookingController.getUserBookings);
router.get('/user-bookings/:id', auth, bookingController.getUserBookingById);


module.exports = router; 