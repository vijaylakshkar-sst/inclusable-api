const express = require('express');
const router = express.Router();
const upload = require('../middleware/multerConfig');
const auth = require('../middleware/auth'); // your JWT auth middleware
const companyEventsController = require('../controllers/companyEventsController');
const { checkFeatureAccess } = require('../middleware/checkPermission');
const { checkCompanyEventLimit } = require('../middleware/checkCompanyEventLimit');

// Form-data upload with image fields
router.post(
  '/company-events/create',
  auth,
  // checkFeatureAccess('canPostEvents'),  
  // checkCompanyEventLimit,
  upload.fields([
    { name: 'event_thumbnail', maxCount: 1 },
    { name: 'event_images', maxCount: 10 }
  ]),
  companyEventsController.createCompanyEvent
);

router.get('/company-events', auth, companyEventsController.getCompanyEvents); // list with filters
router.get('/company-events/:id',auth, companyEventsController.getEventById); // details
router.delete('/company-events/:id',auth, companyEventsController.deleteCompanyEvent);

router.put(
  '/company-events/:id',
  auth,
  upload.fields([
    { name: 'event_thumbnail', maxCount: 1 },
    { name: 'event_images', maxCount: 10 }
  ]),
  companyEventsController.updateCompanyEvent
);
router.get('/company-events-bookings', auth, companyEventsController.getBookingsByCompany);
router.get('/company-events-bookings/:id', auth, companyEventsController.getBookingById);
router.delete('/company-events/:id/image', auth,companyEventsController.deleteCompanyEventImage);

router.post('/partner-events',  companyEventsController.getEvents);
router.get('/partner-events/:id', companyEventsController.getEventById); // details
router.post('/events/book', auth, checkFeatureAccess('canBookTickets'), companyEventsController.createEventBooking);
router.post('/events/book/cancel/:bookingId', auth, companyEventsController.cancelBooking);

module.exports = router;
