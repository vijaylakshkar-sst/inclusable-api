const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const auth = require('../middleware/auth');

router.post('/register', userController.upload.single('business_logo'), userController.register);
router.post('/verify-email', userController.verifyEmail);
router.post('/resend-verification', userController.resendVerificationCode);
router.post('/login', userController.login);
router.post('/logout', userController.logout);
router.post('/users/additional-details', auth, userController.upload.single('profile_image'), userController.addAdditionalDetails);
router.get('/users/onboarding-status', auth, userController.checkOnboardingCompletion);

router.get('/profile', auth, userController.getProfile);

router.put('/change-password', auth, userController.changePassword);

router.put('/company-profile/update', auth, userController.upload.single('business_logo'), userController.updateProfile );

router.put('/user-profile/update', auth, userController.upload.single('profile_image'), userController.updateProfile );


module.exports = router; 