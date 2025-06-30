const { sql, bcrypt, nodemailer, dbConfig } = require('../imports/shared');
const excel = require('exceljs');

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
    request.input('TransactionID', sql.NVarChar(50), transactionId);

    // Step 1: Get transaction and user info
    const result = await request.query(`
      SELECT T.Booking, T.Status, T.Tax_Status, U.Email, U.FirstName, U.LastName
      FROM Transactions T
      INNER JOIN UserData U ON T.User_ID = U.ID
      WHERE T.ID = @TransactionID
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ status: 'fail', message: 'Transaction not found' });
    }

    const { Booking, Status, Tax_Status, Email, FirstName, LastName } = result.recordset[0];

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
    if(Tax_Status == 0){
      await request.query(`
        UPDATE Transactions SET Status = 3 WHERE ID = @TransactionID
      `);
    } else{
      await request.query(`
        UPDATE Transactions SET Status = 3, Tax_Status = 2 WHERE ID = @TransactionID
      `);
    }

    // Step 4: Insert into logs
    const logRequest = new sql.Request();
    logRequest.input('User_ID', sql.Int, requesterId);
    logRequest.input('Bookings', sql.NVarChar(sql.MAX), Booking);
    logRequest.input('Message', sql.NVarChar(sql.MAX), 'Approved transaction/seats');

    await logRequest.query(`
      INSERT INTO Seat_Logs (User_ID, Bookings, Message)
      VALUES (@User_ID, @Bookings, @Message)
    `);

    // Step 5: Send Email Notification
    const userName = FirstName + ' ' + LastName;
    const transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: parseInt(process.env.MAIL_PORT, 10),
      secure: process.env.MAIL_SECURE === 'true',
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
      },
      tls: {
        ciphers: process.env.MAIL_TLS_CIPHERS
      }
    });

    const mailOptions = {
      from: process.env.MAIL_FROM,
      to: Email,
      subject: "Your transaction have been approve.",
      text: `
      เรียนคุณ ชื่อ ${userName}
      หมายเลขการจอง ${transactionId} ของท่าน ได้รับการอนุมัติเรียบร้อยแล้ว 
      ท่านสามารถตรวจสอบการจอง ได้ที่ www.sigjhospital.com/birdfanfest20xx
      ใบเสร็จของท่านจะถูกออกโดยศิริราชมูลนิธิ ตามข้อมูลที่ท่านได้แจ้งไว้ในเว็บไซต์ ไม่สามารถแก้ไขข้อมูลในภายหลังได้

      หากท่านต้องการสอบถามเกี่ยวกับการจองบัตร
      กรุณาติดต่อ 063-195-4174, 064-931-7415
      LINE OA: @sigj.event (https://lin.ee/tfVt5us) 
      โปรดระวังมิจฉาชีพ หรือบุคคลแอบอ้างเรียกรับเงิน หรือกระทำการใด ๆ ให้เกิดความเสียหายแก่ท่าน การซื้อบัตรคอนเสิร์ต Bird Fanfest 20XX (รอบการกุศล) จะต้องดำเนินการผ่านทางเว็บไซต์ : https://www.sigjhospital.com/birdfanfest20xx/  และชำระเงินโดยการโอนผ่าน QR Code ของศิริราชมูลนิธิเท่านั้น

      สนับสนุนเว็บไซต์โดย บริษัท อำพลฟูดส์ โพรเซสซิ่ง จำกัด`
    };

    try {
      await transporter.sendMail(mailOptions);
    } catch (mailErr) {
      console.error('Email send failed:', mailErr.message);
    }

    return res.json({
      status: 'success',
      message: 'Transaction approved, seats marked as paid, and email sent'
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'fail', message: 'Server error', error: err.message });
  }
};

exports.approveTaxInvoice = async (req, res) => {
  const { transactionId } = req.body;
  const requesterId = req.user?.id;
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => Number(id.trim()));

  if (!transactionId) {
    return res.status(400).json({ status: 'fail', message: 'Transaction ID is required' });
  }

  if (!adminIds.includes(Number(requesterId))) {
    return res.status(403).json({ status: 'fail', message: 'Only admins can approve tax invoices' });
  }

  try {
    await sql.connect(dbConfig);
    const request = new sql.Request();
    request.input('TransactionID', sql.NVarChar(50), transactionId);

    const result = await request.query(`
      SELECT Tax_id, Tax_Status FROM Transactions WHERE ID = @TransactionID
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ status: 'fail', message: 'Transaction not found' });
    }

    const { Tax_id, Tax_Status } = result.recordset[0];

    if (Tax_Status !== 2) {
      return res.status(400).json({ status: 'fail', message: 'Only tax invoices with status 2 (recorded) can be approved' });
    }

    if (!Tax_id) {
      return res.status(400).json({ status: 'fail', message: 'No tax invoice associated with this transaction' });
    }

    // Step 1: Update Transactions Tax_Status to 3
    await request.query(`
      UPDATE Transactions SET Tax_Status = 3 WHERE ID = @TransactionID
    `);

    // Step 2: Update Tax_Invoice_Records Approved_By_Admin
    const updateTax = new sql.Request();
    updateTax.input('AdminID', sql.Int, requesterId);
    updateTax.input('TaxID', sql.Int, Tax_id);

    await updateTax.query(`
      UPDATE Tax_Invoice_Records SET Approved_By_Admin = @AdminID WHERE ID = @TaxID
    `);

    return res.json({ status: 'success', message: 'Tax invoice approved successfully' });

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
        T.BackURL1,
        T.BackURL2,
        T.Status,
        T.Tax_Status,
        T.CreatedAt,
        T.BookExpired,
        U.FirstName,
        U.LastName,
        U.Tel as Phone,
        U.Email,
        U.Addr,
        Tax.InName,
        Tax.Tax_Identification_No,
        Tax.Name,
        Tax.Tax_Address,
        Tax.Tax_Amount,
        Tax.Email as TaxMail
      FROM Transactions T
      INNER JOIN UserData U ON T.User_ID = U.ID
      LEFT JOIN Tax_Invoice_Records as Tax ON T.Tax_id = Tax.id
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
      BackURL1: tx.BackURL1,
      BackURL2: tx.BackURL2,
      Status: tx.Status,
      CreatedAt: tx.CreatedAt,
      BookExpired: tx.BookExpired,
      TaxStatus: tx.Tax_Status,
      TaxInName: tx.InName,
      Tax_Name: tx.Name,
      TaxIDNo: tx.Tax_Identification_No,
      TaxAddress: tx.Tax_Address,
      TaxMail: tx.TaxMail,
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
    const adminIdsAPF = (process.env.APF_ADMIN_IDS || '').split(',').map(id => Number(id.trim()));
    const adminIdsSRJ = (process.env.SRJ_ADMIN_IDS || '').split(',').map(id => Number(id.trim()));
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
      isAPF: adminIdsAPF.includes(log.User_ID),
      isSRJ: adminIdsSRJ.includes(log.User_ID),
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

exports.uploadBackImage = async (req, res) => {
  const { transactionId, backUrl1, backUrl2 } = req.body;
  const requesterId = req.user?.id;

  // Validate admin
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => Number(id.trim()));
  if (!adminIds.includes(Number(requesterId))) {
    return res.status(403).json({ status: 'fail', message: 'Only admin can access this endpoint' });
  }

  if (!transactionId) {
    return res.status(400).json({ status: 'fail', message: 'Transaction ID is required' });
  }

  if (backUrl1 === undefined && backUrl2 === undefined) {
    return res.status(400).json({ status: 'fail', message: 'At least one of backUrl1 or backUrl2 must be provided' });
  }

  try {
    await sql.connect(dbConfig);

    // Step 1: Get transaction booking info
    const getBookingReq = new sql.Request();
    getBookingReq.input('TransactionID', sql.NVarChar(50), transactionId);
    const transactionRes = await getBookingReq.query(`
      SELECT Booking FROM Transactions WHERE ID = @TransactionID
    `);

    if (transactionRes.recordset.length === 0) {
      return res.status(404).json({ status: 'fail', message: 'Transaction not found' });
    }

    const bookingStr = transactionRes.recordset[0].Booking;

    // Step 2: Build update query securely
    const updateRequest = new sql.Request();
    updateRequest.input('TransactionID', sql.NVarChar(50), transactionId);

    let setClauses = [];
    if (backUrl1 !== undefined) {
      updateRequest.input('BackURL1', sql.NVarChar(sql.MAX), backUrl1);
      setClauses.push('BackURL1 = @BackURL1');
    }
    if (backUrl2 !== undefined) {
      updateRequest.input('BackURL2', sql.NVarChar(sql.MAX), backUrl2);
      setClauses.push('BackURL2 = @BackURL2');
    }

    const updateQuery = `
      UPDATE Transactions
      SET ${setClauses.join(', ')}
      WHERE ID = @TransactionID
    `;

    await updateRequest.query(updateQuery);

    // Step 3: Insert into Seat_Logs
    const logRequest = new sql.Request();
    logRequest.input('User_ID', sql.Int, requesterId);
    logRequest.input('Bookings', sql.NVarChar(sql.MAX), bookingStr);
    logRequest.input('Message', sql.NVarChar(sql.MAX), 'Upload back up image');
    await logRequest.query(`
      INSERT INTO Seat_Logs (User_ID, Bookings, Message, Created_At)
      VALUES (@User_ID, @Bookings, @Message, GETDATE())
    `);

    return res.status(200).json({
      status: 'success',
      message: 'Back image(s) updated and logged successfully',
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: 'fail',
      message: 'Server error',
      error: err.message,
    });
  }
};

exports.downloadTaxTransactions = async (req, res) => {
  const requesterId = req.user?.id;
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => Number(id.trim()));

  if (!adminIds.includes(Number(requesterId))) {
    return res.status(403).json({ status: 'fail', message: 'Only admins can perform this action' });
  }

  try {
    await sql.connect(dbConfig);
    const request = new sql.Request();

    const result = await request.query(`
      SELECT 
        T.ID as TransactionID,
        T.TotalAmount,
        T.Tax_Status,
        T.CreatedAt,
        U.FirstName,
        U.LastName,
        U.Email AS UserEmail,
        Tax.InName,
        Tax.Name as Tax_Name,
        Tax.Tax_Identification_No,
        Tax.Tax_Address,
        Tax.Invoice_Amount,
        Tax.Tax_Amount,
        Tax.Tax_Date,
        Tax.Email AS TaxEmail,
        Tax.Notes
      FROM Transactions T
      INNER JOIN UserData U ON T.User_ID = U.ID
      INNER JOIN Tax_Invoice_Records Tax ON T.Tax_id = Tax.ID
      WHERE T.Tax_Status >= 1
    `);

    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet('Tax Transactions');

    worksheet.columns = [
      { header: 'Transaction ID', key: 'TransactionID' },
      { header: 'Total Amount', key: 'TotalAmount' },
      { header: 'Tax Status', key: 'Tax_Status' },
      { header: 'Created At', key: 'CreatedAt' },
      { header: 'First Name', key: 'FirstName' },
      { header: 'Last Name', key: 'LastName' },
      { header: 'User Email', key: 'UserEmail' },
      { header: 'In Name', key: 'InName' },
      { header: 'Tax Name', key: 'Tax_Name' },
      { header: 'Tax ID No.', key: 'Tax_Identification_No' },
      { header: 'Tax Address', key: 'Tax_Address' },
      { header: 'Invoice Amount', key: 'Invoice_Amount' },
      { header: 'Tax Amount', key: 'Tax_Amount' },
      { header: 'Tax Date', key: 'Tax_Date' },
      { header: 'Tax Email', key: 'TaxEmail' },
      { header: 'Notes', key: 'Notes' },
    ];

    result.recordset.forEach(row => {
      worksheet.addRow(row);
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=TaxTransactions.xlsx'
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'fail', message: 'Error generating report', error: err.message });
  }
};
