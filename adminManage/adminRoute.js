const express = require('express');
const router = express.Router();
const adminController = require('./adminController');
const authMiddleware = require('../middleware/auth');

router.get('/getAllTransactions', authMiddleware, adminController.getAllTransactions);
router.get('/getLogSeats', authMiddleware, adminController.getSeatLogs);
router.get('/getTaxTransactions', authMiddleware, adminController.downloadTaxTransactions);
router.post('/approveTransaction', authMiddleware, adminController.approveUserTransaction);
router.post('/approveTaxInvoice', authMiddleware, adminController.approveTaxInvoice);
router.post('/uploadBackImage', authMiddleware, adminController.uploadBackImage);

module.exports = router;
  