const express = require('express');
const router = express.Router();
const paymentController = require('./paymentController');
const authMiddleware = require('../middleware/auth');

router.get('/getUserTransaction', authMiddleware, paymentController.getUserTransaction);
router.post('/cancelUserTransaction', authMiddleware, paymentController.cancelUserTransaction);
router.post('/payUserTransaction', authMiddleware, paymentController.payUserTransaction);

module.exports = router;
  