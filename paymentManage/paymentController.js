const { sql, bcrypt, nodemailer, dbConfig } = require('../imports/shared');

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
      SELECT 
        Trans.[ID], Trans.Booking, Trans.TotalAmount, Trans.BillURL, Trans.BackURL1, Trans.BackURL2, Trans.Status, 
        Trans.Tax_status, Tax.Tax_Identification_No, Tax.InName, Tax.Name as Tax_Name, Tax.Tax_Address, Tax.Tax_Amount, Tax.Email
      FROM 
        Transactions as Trans Left JOIN Tax_Invoice_Records as Tax ON Trans.Tax_id = Tax.id
      WHERE 
        User_ID = ${userId}
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
      TaxStatus: tx.Tax_Status,
      TaxInName: tx.InName,
      TaxName: tx.Name,
      TaxIDNo: tx.Tax_Identification_No,
      TaxAddress: tx.Tax_Address,
      TaxMail: tx.Email,
      BillURL: tx.BillURL,
      BackURL1: tx.BackURL1,
      BackURL2: tx.BackURL2,
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
    request.input('TransactionID', sql.NVarChar(50), transactionId);

    // Step 1: Get transaction info
    const result = await request.query(`
      SELECT User_ID, Tax_id, Booking FROM Transactions WHERE ID = @TransactionID
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ status: 'fail', message: 'Transaction not found' });
    }

    const { User_ID, Booking, Tax_id } = result.recordset[0];

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

    await request.query(`
      DELETE FROM Tax_Invoice_Records WHERE ID = ${Tax_id}
    `);

    const logRequest = new sql.Request();
    logRequest.input('User_ID', sql.Int, requesterId);
    logRequest.input('Bookings', sql.NVarChar(sql.MAX), Booking);
    logRequest.input('Message', sql.NVarChar(sql.MAX), 'Canceled transaction/seats');

    await logRequest.query(`
      INSERT INTO Seat_Logs (User_ID, Bookings, Message)
      VALUES (@User_ID, @Bookings, @Message)
    `);

    if (isAdmin) {
      const userData = await request.query(`
        SELECT FirstName, LastName, Email FROM UserData WHERE ID = ${User_ID}
      `);

      const { FirstName, LastName, Email } = userData.recordset[0];
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
        subject: "Your transaction have been cancel.",
        text: `
        เรียนคุณ ${userName}
        หมายเลขการจอง ${transactionId} ของท่าน ถูกยกเลิก เนื่องจากท่านไม่ได้ชำระเงิน ในเวลาที่กำหนด 
        ท่านสามารถจองบัตรอีกครั้ง ได้ที่ www.sigjhospital.com/birdfanfest20xx

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
    }

    return res.json({ status: 'success', message: 'Transaction canceled and seats released' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'fail', message: 'Server error', error: err.message });
  }
};

exports.payUserTransaction = async (req, res) => {
  const {
    transactionId,
    billUrl,
    Tax_need,
    InName,
    Tax_Name,
    Tax_Identification_No,
    Tax_Address,
    Tax_Email,
    Notes
  } = req.body;

  const requesterId = req.user?.id;
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => Number(id.trim()));

  if (!transactionId || !billUrl) {
    return res.status(400).json({ status: 'fail', message: 'Transaction ID and Bill URL are required' });
  }

  if (typeof Tax_need !== 'boolean') {
    return res.status(400).json({ status: 'fail', message: 'Tax_need is required (true or false)' });
  }

  try {
    await sql.connect(dbConfig);
    const request = new sql.Request();
    request.input('TransactionID', sql.NVarChar(50), transactionId);

    const result = await request.query(`
      SELECT User_ID, Status, TotalAmount FROM Transactions WHERE ID = @TransactionID
    `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ status: 'fail', message: 'Transaction not found' });
    }

    const { User_ID, Status, TotalAmount } = result.recordset[0];
    const isOwner = requesterId === User_ID;
    const isAdmin = adminIds.includes(Number(requesterId));

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ status: 'fail', message: 'You are not allowed to mark this transaction as paid' });
    }

    if (Status !== 1) {
      return res.status(400).json({ status: 'fail', message: 'Transaction is not in a payable state (Status must be 1)' });
    }

    const updateRequest = new sql.Request();
    updateRequest.input('TransactionID', sql.NVarChar(50), transactionId);
    updateRequest.input('BillURL', sql.NVarChar(sql.MAX), billUrl);

    await updateRequest.query(`
      UPDATE Transactions
      SET Status = 2, BillURL = @BillURL
      WHERE ID = @TransactionID
    `);

    if (Tax_need) {
      const userQuery = await new sql.Request()
        .input('UserID', sql.Int, User_ID)
        .query(`SELECT Addr as Address, IdenNumber, Email AS UserEmail FROM UserData WHERE ID = @UserID`);

      const userData = userQuery.recordset[0];

      const taxAddress = Tax_Address === 'Same' || !Tax_Address ? userData?.Address : Tax_Address;
      const taxEmail = Tax_Email === 'Same' || !Tax_Email ? userData?.UserEmail : Tax_Email;
      const taxId = Tax_Identification_No === 'Same' ? userData?.IdenNumber : Tax_Identification_No;

      const taxAmount = parseFloat((TotalAmount * 0.07).toFixed(2));

      const taxInsertRequest = new sql.Request();
      taxInsertRequest.input('InName', sql.NVarChar(sql.MAX), InName);
      taxInsertRequest.input('Name', sql.NVarChar(255), Tax_Name || null);
      taxInsertRequest.input('Tax_Identification_No', sql.NVarChar(20), taxId);
      taxInsertRequest.input('Tax_Address', sql.NVarChar(500), taxAddress);
      taxInsertRequest.input('Invoice_Amount', sql.Decimal(10, 2), TotalAmount);
      taxInsertRequest.input('Tax_Amount', sql.Decimal(10, 2), taxAmount);
      taxInsertRequest.input('Approved_By_Admin', sql.Int, null);
      taxInsertRequest.input('Email', sql.NVarChar(255), taxEmail);
      taxInsertRequest.input('Notes', sql.NVarChar(sql.MAX), Notes || null);

      const taxResult = await taxInsertRequest.query(`
        INSERT INTO Tax_Invoice_Records (
          InName, Name, Tax_Identification_No, Tax_Address,
          Invoice_Amount, Tax_Amount, Approved_By_Admin,
          Email, Notes
        )
        OUTPUT INSERTED.ID
        VALUES (
          @InName, @Name, @Tax_Identification_No, @Tax_Address,
          @Invoice_Amount, @Tax_Amount, @Approved_By_Admin,
          @Email, @Notes
        )
      `);

      const taxInvoiceId = taxResult.recordset[0].ID;

      const updateTaxStatus = new sql.Request();
      await updateTaxStatus.query(`
        UPDATE Transactions SET Tax_Status = 2, Tax_id = ${taxInvoiceId} WHERE ID = '${transactionId}'
      `);

      return res.json({
        status: 'success',
        message: 'Transaction marked as paid and tax invoice recorded',
        taxInvoiceId
      });
    } else {
      return res.json({ status: 'success', message: 'Transaction marked as paid successfully' });
    }

  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'fail', message: 'Server error', error: err.message });
  }
};