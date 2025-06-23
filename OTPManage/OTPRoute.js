const express = require('express');
const router = express.Router();
const OTPController = require('./OTPController');

router.post('/sendOTP', OTPController.sendOtp);
router.post('/verifyOTP', OTPController.verifyOtp);
router.post('/registerConfirm', OTPController.registerConfirm);
router.post('/registerUser', OTPController.register);
router.post('/loginUser', OTPController.login);
router.post('/loginConfirm', OTPController.loginConfirm);
 
module.exports = router;
