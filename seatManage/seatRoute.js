const express = require('express');
const router = express.Router();
const seatController = require('./seatController');
const authMiddleware = require('../middleware/auth');

router.post('/getSeats', authMiddleware, seatController.getSeats);
router.get('/getEmptySeats', authMiddleware, seatController.getEmptySeats);
router.post('/bookSeats', authMiddleware, seatController.bookSeats);

module.exports = router;
     