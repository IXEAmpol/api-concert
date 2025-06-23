const { sql, bcrypt, dbConfig } = require('../imports/shared');

exports.getUserTransaction = async (req, res) => {
  try {
    await sql.connect(dbConfig);
    const request = new sql.Request();
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ status: 'fail', message: 'Unauthorized: user not found in token' });
    }

    // Step 1: Get all unpaid transactions
    const transactionsResult = await request.query(`
      SELECT [ID], Booking, TotalAmount, Status
      FROM Transactions
      WHERE User_ID = ${userId}
    `);

    const transactions = transactionsResult.recordset;

    // Step 2: Extract all seat IDs
    const allSeatIds = new Set();
    const transMap = transactions.map(tx => {
      const ids = tx.Booking.split('|').filter(Boolean).map(Number);
      ids.forEach(id => allSeatIds.add(id));
      return { ...tx, seatIds: ids };
    });

    if (allSeatIds.size === 0) {
      return res.json([]);
    }

    // Step 3: Query seat info for all IDs
    const seatIdList = Array.from(allSeatIds).join(',');
    const seatRequest = new sql.Request();
    const seatDataResult = await seatRequest.query(`
      SELECT [ID], [ZONE], [ROW], [COLUMN], [DISPLAY]
      FROM Seats_data
      WHERE ID IN (${seatIdList})
    `);

    const seatMap = new Map();
    seatDataResult.recordset.forEach(seat => {
      seatMap.set(seat.ID, {
        zone: seat.ZONE,
        row: seat.ROW,
        column: seat.COLUMN,
        display: seat.DISPLAY
      });
    });

    // Step 4: Map seat data to each transaction
    const formatted = transMap.map(tx => ({
      transactionId :tx.ID,
      totalAmount: tx.TotalAmount,
      Status: tx.Status,
      seats_data: tx.seatIds.map(id => seatMap.get(id)).filter(Boolean)
    }));

    return res.json(formatted);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'fail', message: 'Database error', error: err.message });
  }
};

exports.cancelUserTransaction = async (req, res) => {
  const { transactionId } = req.body;
  const requesterId = req.user?.id;
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => Number(id.trim()));

  if (!transactionId) {
    return res.status(400).json({ status: 'fail', message: 'Transaction ID is required' });
  }

  try {
    await sql.connect(dbConfig);
    const request = new sql.Request();
    request.input('TransactionID', sql.Int, transactionId);

    // Step 1: Get transaction info
    const result = await request.query(`
      SELECT User_ID, Booking FROM Transactions WHERE ID = @TransactionID
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ status: 'fail', message: 'Transaction not found' });
    }

    const { User_ID, Booking } = result.recordset[0];

    // Step 2: Authorization check
    const isOwner = requesterId === User_ID;
    const isAdmin = adminIds.includes(Number(requesterId));

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ status: 'fail', message: 'You are not allowed to cancel this transaction' });
    }

    const seatIds = Booking.split('|').filter(Boolean).map(Number);
    const idList = seatIds.join(',');

    if (seatIds.length > 0) {
      // Step 3: Set seat status back to available
      await request.query(`
        UPDATE Seats_data
        SET STATUS = 0, UPDATED_AT = GETDATE()
        WHERE ID IN (${idList})
      `);
    }

    // Step 4: Delete the transaction
    await request.query(`
      DELETE FROM Transactions WHERE ID = @TransactionID
    `);

    const logRequest = new sql.Request();
    logRequest.input('User_ID', sql.Int, requesterId);
    logRequest.input('Bookings', sql.NVarChar(sql.MAX), Booking);
    logRequest.input('Message', sql.NVarChar(sql.MAX), 'Canceled transaction/seats');

    await logRequest.query(`
      INSERT INTO Seat_Logs (User_ID, Bookings, Message)
      VALUES (@User_ID, @Bookings, @Message)
    `);

    return res.json({ status: 'success', message: 'Transaction canceled and seats released' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'fail', message: 'Server error', error: err.message });
  }
};

exports.payUserTransaction = async (req, res) => {
  const { transactionId, billUrl } = req.body;
  const requesterId = req.user?.id;
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => Number(id.trim()));

  if (!transactionId || !billUrl) {
    return res.status(400).json({ status: 'fail', message: 'Transaction ID and Bill URL are required' });
  }

  try {
    await sql.connect(dbConfig);
    const request = new sql.Request();
    request.input('TransactionID', sql.Int, transactionId);

    // Step 1: Get transaction info
    const result = await request.query(`
      SELECT User_ID, Status FROM Transactions WHERE ID = @TransactionID
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ status: 'fail', message: 'Transaction not found' });
    }

    const { User_ID, Status } = result.recordset[0];
    const isOwner = requesterId === User_ID;
    const isAdmin = adminIds.includes(Number(requesterId));

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ status: 'fail', message: 'You are not allowed to mark this transaction as paid' });
    }

    if (Status !== 1) {
      return res.status(400).json({ status: 'fail', message: 'Transaction is not in a payable state (Status must be 1)' });
    }

    // Step 2: Update the transaction
    const updateRequest = new sql.Request();
    updateRequest.input('TransactionID', sql.Int, transactionId);
    updateRequest.input('BillURL', sql.NVarChar(sql.MAX), billUrl);

    await updateRequest.query(`
      UPDATE Transactions
      SET Status = 2, BillURL = @BillURL
      WHERE ID = @TransactionID
    `);

    return res.json({ status: 'success', message: 'Transaction marked as paid successfully' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'fail', message: 'Server error', error: err.message });
  }
};


exports.approveUserTransaction = async (req, res) => {
  const { transactionId } = req.body;
  const requesterId = req.user?.id;
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => Number(id.trim()));

  if (!transactionId) {
    return res.status(400).json({ status: 'fail', message: 'Transaction ID is required' });
  }

  if (!adminIds.includes(Number(requesterId))) {
    return res.status(403).json({ status: 'fail', message: 'Only admins can approve transactions' });
  }

  try {
    await sql.connect(dbConfig);
    const request = new sql.Request();
    request.input('TransactionID', sql.Int, transactionId);

    // Step 1: Get transaction info
    const result = await request.query(`
      SELECT Booking, Status FROM Transactions WHERE ID = @TransactionID
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ status: 'fail', message: 'Transaction not found' });
    }

    const { Booking, Status } = result.recordset[0];

    if (Status !== 2) {
      return res.status(400).json({ status: 'fail', message: 'Only transactions with status = 2 (paid) can be approved' });
    }

    const seatIds = Booking.split('|').filter(Boolean).map(Number);
    const idList = seatIds.join(',');

    if (seatIds.length > 0) {
      // Step 2: Update seat status to 2 (paid)
      await request.query(`
        UPDATE Seats_data
        SET STATUS = 2, UPDATED_AT = GETDATE()
        WHERE ID IN (${idList})
      `);
    }

    // Step 3: Update transaction status to 3 (approved)
    await request.query(`
      UPDATE Transactions SET Status = 3 WHERE ID = @TransactionID
    `);

    const logRequest = new sql.Request();
    logRequest.input('User_ID', sql.Int, requesterId);
    logRequest.input('Bookings', sql.NVarChar(sql.MAX), Booking);
    logRequest.input('Message', sql.NVarChar(sql.MAX), 'Approved transaction/seats');

    await logRequest.query(`
      INSERT INTO Seat_Logs (User_ID, Bookings, Message)
      VALUES (@User_ID, @Bookings, @Message)
    `);

    return res.json({ status: 'success', message: 'Transaction approved and seats marked as paid' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'fail', message: 'Server error', error: err.message });
  }
};


exports.getAllTransactions = async (req, res) => {
  try {
    const requesterId = req.user?.id;
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => Number(id.trim()));
    const isAdmin = adminIds.includes(Number(requesterId));

    if (!isAdmin) {
      return res.status(403).json({ status: 'fail', message: 'Only admin can access this endpoint' });
    }

    await sql.connect(dbConfig);
    const request = new sql.Request();

    // Step 1: Get transactions with user data
    const result = await request.query(`
      SELECT 
        T.ID as transactionId,
        T.User_ID as userId,
        T.Booking,
        T.TotalAmount,
        T.BillURL,
        T.Status,
        T.CreatedAt,
        U.FirstName,
        U.LastName,
        U.Tel as Phone,
        U.Email,
        U.Addr
      FROM Transactions T
      INNER JOIN UserData U ON T.User_ID = U.ID
      ORDER BY T.CreatedAt DESC
    `);
 
    const transactions = result.recordset;

    // Step 2: Extract all unique seat IDs
    const allSeatIds = new Set();
    const transactionsMapped = transactions.map(tx => {
      const ids = tx.Booking.split('|').filter(Boolean).map(Number);
      ids.forEach(id => allSeatIds.add(id));
      return { ...tx, seatIds: ids };
    });

    if (allSeatIds.size === 0) {
      return res.json({ status: 'success', data: [] });
    }

    const seatIdList = Array.from(allSeatIds).join(',');
    const seatRequest = new sql.Request();

    const seatResult = await seatRequest.query(`
      SELECT ID, ZONE, ROW, [COLUMN], DISPLAY
      FROM Seats_data
      WHERE ID IN (${seatIdList})
    `);

    const seatMap = new Map();
    seatResult.recordset.forEach(seat => {
      seatMap.set(seat.ID, {
        zone: seat.ZONE,
        row: seat.ROW,
        column: seat.COLUMN,
        display: seat.DISPLAY
      });
    });

    // Step 3: Combine seat data into the result
    const formatted = transactionsMapped.map(tx => ({
      transactionId: tx.transactionId,
      userId: tx.userId,
      FirstName: tx.FirstName,
      LastName: tx.LastName,
      Phone: tx.Phone,
      Email: tx.Email,
      Address: tx.Addr,
      TotalAmount: tx.TotalAmount,
      BillURL: tx.BillURL,
      Status: tx.Status,
      CreatedAt: tx.CreatedAt,
      seats_data: tx.seatIds.map(id => seatMap.get(id)).filter(Boolean)
    }));

    return res.json({ status: 'success', data: formatted });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'fail', message: 'Database error', error: err.message });
  }
};

exports.getSeatLogs = async (req, res) => {
  try {
    const requesterId = req.user?.id;
    const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => Number(id.trim()));
    const isAdmin = adminIds.includes(Number(requesterId));

    if (!isAdmin) {
      return res.status(403).json({ status: 'fail', message: 'Only admin can access this endpoint' });
    }

    await sql.connect(dbConfig);
    const request = new sql.Request();

    // Step 1: Get logs with user info
    const logResult = await request.query(`
      SELECT 
        L.ID as logId,
        L.User_ID,
        L.Bookings,
        L.Message,
        L.Created_At,
        U.FirstName,
        U.LastName
      FROM Seat_Logs L
      INNER JOIN UserData U ON L.User_ID = U.ID
      ORDER BY L.Created_At DESC
    `);

    const logs = logResult.recordset;

    // Step 2: Collect all unique seat IDs
    const allSeatIds = new Set();
    const logsMapped = logs.map(log => {
      const seatIds = log.Bookings.split('|').filter(Boolean).map(Number);
      seatIds.forEach(id => allSeatIds.add(id));
      return { ...log, seatIds };
    });

    if (allSeatIds.size === 0) {
      return res.json({ status: 'success', data: [] });
    }

    // Step 3: Get all seat info in bulk
    const seatIdList = Array.from(allSeatIds).join(',');
    const seatRequest = new sql.Request();
    const seatResult = await seatRequest.query(`
      SELECT ID, LEVEL, ZONE, ROW, [COLUMN]
      FROM Seats_data
      WHERE ID IN (${seatIdList})
    `);

    const seatMap = new Map();
    seatResult.recordset.forEach(seat => {
      seatMap.set(seat.ID, {
        level: seat.LEVEL,
        zone: seat.ZONE,
        row: seat.ROW,
        column: seat.COLUMN
      });
    });

    // Step 4: Format response
    const formatted = logsMapped.map(log => ({
      logId: log.logId,
      userId: log.User_ID,
      firstName: log.FirstName,
      lastName: log.LastName,
      isAdmin: adminIds.includes(log.User_ID),
      message: log.Message,
      At: log.Created_At,
      seats_data: log.seatIds.map(id => seatMap.get(id)).filter(Boolean)
    }));

    return res.json({ status: 'success', data: formatted });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'fail', message: 'Server error', error: err.message });
  }
};