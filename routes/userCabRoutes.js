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
router.post("/setup-intent", auth,  userCabController.createSetupIntent);
router.post("/payment-confirm", auth, userCabController.confirmSetupIntent);
router.get("/cards-list", auth, userCabController.getCardsList);
router.get("/my-rides", auth, userCabController.getMyRides);
router.get("/current-booking", auth, userCabController.getCurrentBooking);
router.delete("/card-remove/:paymentMethodId", auth, userCabController.removeCard);
router.post("/cards/:paymentMethodId/default", auth, userCabController.makeDefaultCard);

module.exports = router;