const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const auth = require('../middleware/auth');

router.get('/user-bookings', auth, bookingController.getUserBookings);
router.get('/user-bookings/:id', auth, bookingController.getUserBookingById);
router.get('/events/:eventId/availability', auth, bookingController.getEventSeatAvailability);
router.post('/scan-qrcode', auth, bookingController.scanQrCode);
router.post('/check-in-tickets', auth, bookingController.checkInAttendees);

module.exports = router; 