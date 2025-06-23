const { sql, bcrypt, dbConfig } = require('../imports/shared');

exports.getSeats = async (req, res) => {
  const { ZONE } = req.body;

  if (!ZONE) {
    return res.status(400).json({ status: 'fail', message: 'Zone parameter is required' });
  }

  try {
    await sql.connect(dbConfig);
    const request = new sql.Request();
    request.input('zone', sql.VarChar, ZONE); // use appropriate type if not VarChar

    const result = await request.query(`
      SELECT 
        [ID],
        [LEVEL],
        [ZONE],
        [PRICE],
        [ROW],
        [COLUMN],
        [DISPLAY],
        [VISIBLE],
        [STATUS],
        [UPDATED_AT]
      FROM [Seats_data]
      WHERE ZONE = @zone
    `);

    res.json(result.recordset);
  } catch (err) {
    res.status(500).json({ status: 'fail', message: err.message });
  }
};

exports.bookSeats = async (req, res) => {
  const { booking } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ status: 'fail', message: 'Unauthorized: user not found in token' });
  }

  if (!booking) {
    return res.status(400).json({ status: 'fail', message: 'Booking parameter is required' });
  }

  const seatIds = booking.split('|').filter(Boolean).map(Number);
  if (seatIds.length === 0) {
    return res.status(400).json({ status: 'fail', message: 'No valid seat IDs provided' });
  }

  const idList = seatIds.join(',');

  try {
    await sql.connect(dbConfig);
    const request = new sql.Request();

    // Step 1: Check seat availability
    const checkResult = await request.query(`
      SELECT [ID], [ZONE], [ROW], [COLUMN], [DISPLAY] FROM Seats_data
      WHERE ID IN (${idList}) AND STATUS != 0
    `);

    if (checkResult.recordset.length > 0) {
      const takenSeats = checkResult.recordset.map(row => ({
        zone: row.ZONE,
        row: row.ROW,
        column: row.COLUMN,
        display: row.DISPLAY
      }));

      return res.json({
        status: 'fail',
        message: 'Some seats are already taken',
        seats_data: takenSeats
      });
    }

    // Step 2: Get total amount
    const totalResult = await request.query(`
      SELECT SUM(PRICE) as Total FROM Seats_data
      WHERE ID IN (${idList})
    `);
    const totalAmount = totalResult.recordset[0].Total || 0;

    // Step 3: Update seat statuses
    await request.query(`
      UPDATE Seats_data
      SET STATUS = 1, UPDATED_AT = GETDATE()
      WHERE ID IN (${idList})
    `);

    // Step 4: Insert transaction and return inserted ID
    const insertRequest = new sql.Request();
    insertRequest.input('User_ID', sql.Int, userId);
    insertRequest.input('Booking', sql.NVarChar(sql.MAX), booking);
    insertRequest.input('TotalAmount', sql.Decimal(10, 2), totalAmount);
    insertRequest.input('Status', sql.TinyInt, 1); // 1 = not paid
    insertRequest.input('CreatedAt', sql.DateTime, new Date());

    const insertResult = await insertRequest.query(`
      INSERT INTO Transactions (User_ID, Booking, TotalAmount, Status, CreatedAt)
      OUTPUT INSERTED.ID
      VALUES (@User_ID, @Booking, @TotalAmount, @Status, @CreatedAt)
    `);

    const transactionId = insertResult.recordset[0].ID;

    return res.json({
      status: 'success',
      message: 'Seats booked and transaction recorded',
      transactionId
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'fail', message: err.message });
  }
};

exports.getEmptySeats = async (req, res) => {
  const requesterId = req.user?.id;
  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => Number(id.trim()));
  const isAdmin = adminIds.includes(Number(requesterId));

  if (!isAdmin) {
    return res.status(403).json({ status: 'fail', message: 'Only admin can access this endpoint' });
  }

  try {
    await sql.connect(dbConfig);
    const request = new sql.Request();

    const result = await request.query(`
      SELECT
        ZONE,
        COUNT(*) AS Max,
        SUM(CASE WHEN STATUS = 0 THEN 1 ELSE 0 END) AS Available
      FROM Seats_data
      WHERE VISIBLE = 'T'
      GROUP BY ZONE
      ORDER BY ZONE
    `);

    return res.json({
      status: 'success',
      zones: result.recordset
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'fail', message: 'Database error', error: err.message });
  }
};