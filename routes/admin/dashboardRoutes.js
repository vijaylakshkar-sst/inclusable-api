const express = require('express');
const router = express.Router();
const dashboardController = require('../../controllers/admin/dashboardController');
const auth = require('../../middleware/auth'); // your JWT auth middleware

router.get('/counts', auth, dashboardController.getCardsCount);   
router.get('/monthly-role-counts', auth, dashboardController.getMonthlyRoleCounts);
router.get('/recent-users', auth, dashboardController.getRecentUsers);
router.get('/monthly-revenue', auth, dashboardController.getMonthlyBookingRevenue);
router.get('/stats', auth, dashboardController.getBookingDashboardStats);

module.exports = router;
