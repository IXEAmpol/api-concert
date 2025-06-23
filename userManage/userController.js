const { sql, dbConfig, ADMIN_IDS } = require('../imports/shared');

exports.getUserData = async (req, res) => {
  const requesterId = req.user?.id;; // Email or Tel

  try {
    await sql.connect(dbConfig);
    const request = new sql.Request();

    const query = await request.query(`
      SELECT * FROM UserData
      WHERE ID = '${requesterId}'
    `);

    if (query.recordset.length === 0) {
      return res.status(404).json({ status: 'fail', message: 'User not found' });
    }

    res.json({ status: 'success', data: query.recordset[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'fail', message: 'Database error', error: err.message });
  }
};

exports.updateUserData = async (req, res) => {
  const { ID, FirstName, LastName, Addr, IdenNumber, Email, Tel } = req.body;
  const requesterId = req.user?.id;

  if (!ID || !FirstName || !LastName || !Addr || !IdenNumber || !Email || !Tel) {
    return res.status(400).json({ status: 'fail', message: 'Missing required fields' });
  }

  if (requesterId != ID && !ADMIN_IDS.includes(requesterId)) {
    return res.status(403).json({ status: 'fail', message: 'Permission denied: cannot update this user' });
  }

  try {
    await sql.connect(dbConfig);
    const request = new sql.Request();

    // Check for duplicate IdenNumber, Email, or Tel in other users
    const checkDup = await request.query(`
      SELECT * FROM UserData 
      WHERE (IdenNumber = '${IdenNumber}' OR Email = '${Email}' OR Tel = '${Tel}')
      AND ID != ${ID}
    `);

    if (checkDup.recordset.length > 0) {
      return res.status(400).json({ status: 'fail', message: 'Duplicate IdenNumber, Email, or Tel already in use' });
    }

    request.input('ID', sql.Int, ID);
    request.input('FirstName', sql.NVarChar(sql.MAX), FirstName);
    request.input('LastName', sql.NVarChar(sql.MAX), LastName);
    request.input('Addr', sql.NVarChar(sql.MAX), Addr);
    request.input('IdenNumber', sql.NVarChar(sql.MAX), IdenNumber);
    request.input('Email', sql.NVarChar(sql.MAX), Email);
    request.input('Tel', sql.NVarChar(sql.MAX), Tel);

    await request.query(`
      UPDATE UserData
      SET FirstName = @FirstName,
          LastName = @LastName,
          Addr = @Addr,
          IdenNumber = @IdenNumber,
          Email = @Email,
          Tel = @Tel
      WHERE ID = @ID
    `);

    res.json({ status: 'success', message: 'User updated successfully' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'fail', message: 'Database error', error: err.message });
  }
};
