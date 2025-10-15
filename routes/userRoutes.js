const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const uploadFiles = require('../middleware/profileMulter');
const auth = require('../middleware/auth');

router.post('/register', uploadFiles, userController.register);
router.post('/verify-email', userController.verifyEmail);
router.post('/resend-verification', userController.resendVerificationCode);
router.post('/login', userController.login);
router.post('/logout', userController.logout);
router.post('/users/additional-details', auth, uploadFiles, userController.addAdditionalDetails);
router.get('/users/onboarding-status', auth, userController.checkOnboardingCompletion);
router.post('/send-otp', userController.sendOTP);


router.get('/profile', auth, userController.getProfile);

router.put('/change-password', auth, userController.changePassword);

router.put('/update-password', userController.updatePassword);

router.put('/company-profile/update', auth, uploadFiles, userController.updateProfile );

router.put('/user-profile/update', auth, uploadFiles, userController.updateProfile );


module.exports = router; 