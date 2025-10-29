const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const StripeConnectController = require('../controllers/StripeConnectController');
const uploadFiles = require('../middleware/profileMulter');
const auth = require('../middleware/auth');

router.post('/register', uploadFiles, userController.register);
router.post('/verify-email', userController.verifyEmail);
router.post('/resend-verification', userController.resendVerificationCode);
router.post('/login', userController.login);
router.post('/logout', userController.logout);
router.post('/users/additional-details', auth, uploadFiles, userController.addAdditionalDetails);
router.get('/users/onboarding-status', auth, userController.checkOnboardingCompletion);
router.get('/users/notifications', auth, userController.getNotifications);
router.post('/send-otp', userController.sendOTP);


router.get('/profile', auth, userController.getProfile);

router.put('/change-password', auth, userController.changePassword);

router.put('/update-password', userController.updatePassword);

router.delete('/delete-account', auth, userController.deleteUser);

router.put('/company-profile/update', auth, uploadFiles, userController.updateProfile );

router.put('/user-profile/update', auth, uploadFiles, userController.updateProfile );

router.post("/stripe/create-bank-link", userController.createBankLink);

router.post('/stripe/onboarding/connect', auth, StripeConnectController.createAccountLink);
router.post('/stripe/onboarding/complete', auth, StripeConnectController.completeOnboarding);

router.get("/stripe/web/onboarding_success", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Onboarding Success</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
      <style>
        .container ul { list-style-type: disc; }
        .page-content p { line-height: 30px; }
      </style>
    </head>
    <body>
      <section class="page-content">
        <div class="container">
          <div class="col-xl-12 col-lg-12 col-md-12">
            <div class="card-body mt-5">
              <div class="alert alert-success">
                <h3>Onboarding Complete <i class="fa fa-cc-stripe"></i></h3>
                <p>Thank you for completing your onboarding with Stripe. You can now proceed with your account.</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </body>
    </html>
  `);
});

// Onboarding Failed Page
router.get("/stripe/web/onboarding_failed", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Onboarding Failed</title>
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
      <style>
        .container ul { list-style-type: disc; }
        .page-content p { line-height: 30px; }
      </style>
    </head>
    <body>
      <section class="page-content">
        <div class="container">
          <div class="col-xl-12 col-lg-12 col-md-12">
            <div class="card-body mt-5">
              <div class="alert alert-warning">
                <h3>Onboarding Failed <i class="fa fa-cc-stripe"></i></h3>
                <p>It seems there was an issue with your onboarding process. Please try again or contact support for assistance.</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </body>
    </html>
  `);
});


module.exports = router; 