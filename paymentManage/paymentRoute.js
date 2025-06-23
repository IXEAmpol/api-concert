const express = require('express');
const router = express.Router();
const paymentController = require('./paymentController');
const authMiddleware = require('../middleware/auth');

router.get('/getUserTransaction', authMiddleware, paymentController.getUserTransaction);
router.get('/getAllTransactions', authMiddleware, paymentController.getAllTransactions);
router.get('/getLogSeats', authMiddleware, paymentController.getSeatLogs);
router.post('/cancelUserTransaction', authMiddleware, paymentController.cancelUserTransaction);
router.post('/payUserTransaction', authMiddleware, paymentController.payUserTransaction);
router.post('/approveTransaction', authMiddleware, paymentController.approveUserTransaction);

module.exports = router;
