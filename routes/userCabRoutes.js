const express = require('express');
const router = express.Router();
const userCabController = require('../controllers/userCabController');
const auth = require('../middleware/auth');

router.get('/cab-find',auth, userCabController.findAvailableRides);
router.get("/disability-features", auth, userCabController.getDisabilityFeaturs);
router.get('/cab-find-fares',auth, userCabController.findCabTypesWithFare);
router.post('/cab-booking',auth, userCabController.bookCab);
router.post('/cab-cancel/:booking_id', auth, userCabController.cancelBooking);
router.get('/cab-track/:booking_id', auth, userCabController.trackDriver);
router.get('/cab-types', auth, userCabController.cabTypes);
router.post("/rating-submit", auth, userCabController.submitDriverRating );

module.exports = router;