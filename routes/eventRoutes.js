const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');
const semanticSearch = require('../controllers/semanticSearch');

const optionalAuth = require('../middleware/optionalAuth');


router.get('/events/categories', optionalAuth, eventController.getCategories);
router.get('/events/by-category', eventController.getAllEventsByCategory);

// New personalized events endpoint (requires authentication)
router.get('/events/personalized', optionalAuth, eventController.getPersonalizedEvents);

router.get('/semantic-search', semanticSearch.semanticSearch);

module.exports = router; 