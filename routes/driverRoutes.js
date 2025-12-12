const express = require('express');
const router = express.Router();
const driverController = require('../controllers/driverController');
const userController = require('../controllers/userController');
const auth = require('../middleware/auth');
const uploadFiles = require('../middleware/profileMulter');
const driverDocumentMulter = require('../middleware/driverDocumentsMulter');

router.post('/cab-register', uploadFiles, userController.registerCabOwner);

router.post('/profile/add',auth, driverDocumentMulter, driverController.addProfile);
router.get('/profile', auth, driverController.getProfile);
router.put('/profile/update', auth, driverDocumentMulter, driverController.updateProfile);

router.put('/status', auth, driverController.updateStatus);

// Accept booking
router.put('/bookings/:bookingId/accept', auth, driverController.acceptBooking);

// Ignore booking
router.put('/bookings/:bookingId/ignore', auth, driverController.ignoreBooking);
router.put('/bookings/:bookingId/verify-otp', auth, driverController.verifyBookingOtp);
router.put('/bookings/:bookingId/complete', auth, driverController.completeRide);
router.put('/bookings/:bookingId/cancel', auth, driverController.cancelRide);

// ✅ Driver ride history (date-wise)
router.get('/history', auth, driverController.getHistory);

router.put('/location', auth, driverController.updateLocation);
router.get('/bookings', auth, driverController.getBookings);

router.get("/makes", auth, driverController.getMakes);
router.get("/models/:make_id", auth, driverController.getModelsByMake);
router.get("/disability-features", auth, driverController.getDisabilityFeaturs);
router.get("/vehicle-types", auth, driverController.getVehicleTypes);

module.exports = router;