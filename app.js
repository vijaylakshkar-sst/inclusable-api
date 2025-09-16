const express = require('express');
const cors = require('cors');
require('dotenv').config();

const eventRoutes = require('./routes/eventRoutes');
const userRoutes = require('./routes/userRoutes');
const ndisRoutes = require('./routes/ndisRoutes');
const locationAccessibilityRoutes = require('./routes/locationAccessibilityRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const legalContentRoutes = require('./routes/legalContentRoutes');
const companyEventsRoutes = require('./routes/companyEventsRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const userCanBookRoutes = require('./routes/userCabRoutes');

// =============Admin Routes==========================
const termsConditionsRoutes = require('./routes/admin/termsConditionsRoutes');
const privacyPolicyRoutes = require('./routes/admin/privacyPolicyRoutes');
const dashboardRoutes = require('./routes/admin/dashboardRoutes');
const userAdminRoutes = require('./routes/admin/userRoutes');
const cabTypeRoutes = require('./routes/admin/cabTypeRoutes');


//================Driver API==============================

const driverRoutes = require('./routes/driverRoutes');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/v1', eventRoutes);
app.use('/api/v1', userRoutes);
app.use('/api/v1', ndisRoutes);
app.use('/api/v1', locationAccessibilityRoutes);
app.use('/api/v1', bookingRoutes);
app.use('/api/v1', legalContentRoutes);
app.use('/api/v1', webhookRoutes);
app.use('/api/v1', userCanBookRoutes);

app.use('/api/v1', companyEventsRoutes);
// Serve images statically
app.use('/uploads', express.static(__dirname + '/uploads'));

//=====================Admin==============================
app.use('/api/v1/admin/terms-conditions', termsConditionsRoutes);
app.use('/api/v1/admin/privacy-policy', privacyPolicyRoutes);
app.use('/api/v1/admin/dashboard', dashboardRoutes);
app.use('/api/v1/admin/users', userAdminRoutes);
app.use('/api/v1/admin/cab-types', cabTypeRoutes);


//================Driver API==============================
app.use('/api/v1/driver', driverRoutes);



module.exports = app;
