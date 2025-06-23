const express = require('express');
const router = express.Router();
const userController = require('./userController');
const authMiddleware = require('../middleware/auth');

router.get('/getUser', authMiddleware, userController.getUserData);
router.post('/updateUser', authMiddleware, userController.updateUserData);

module.exports = router;
