const { sql, bcrypt, dbConfig, nodemailer, otpStore } = require('../imports/shared');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const qs = require('qs');
require('dotenv').config();

const sendOtp = async (contact, isEmail, otp) => {
  const expires = Date.now() + 5 * 60 * 1000;
  otpStore.set(contact, { otp, expires, contact });

  if (isEmail) {
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
      to: contact,
      subject: process.env.MAIL_SUBJECT,
      text: `${process.env.MAIL_HEAD_CONTENT} ${otp}`
    };

    await transporter.sendMail(mailOptions);
  } else {
    const toPhone = '66' + contact.replace(/^0/, '');
    const smsPayload = require('qs').stringify({
      CMD: process.env.SMS_CMD,
      FROM: process.env.SMS_FROM,
      TO: toPhone,
      REPORT: process.env.SMS_REPORT,
      CHARGE: process.env.SMS_CHARGE,
      CODE: process.env.SMS_CODE,
      CTYPE: process.env.SMS_CTYPE,
      CONTENT: `${process.env.SMS_HEAD_CONTENT} ${otp}`
    });

    await axios.post(process.env.SMS_API, smsPayload, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
    });
  }
};

exports.register = async (req, res) => {
  const { IdenNumber, Email, Tel, Way } = req.body;

  if ( !Email || !Tel || !Way ) {
    return res.status(400).json({ status: 'fail', message: 'Missing required fields' });
  }

  try {
    await sql.connect(dbConfig);
    const request = new sql.Request();

    const checkQuery = await request.query(`
      SELECT * FROM UserData
      WHERE IdenNumber = '${IdenNumber}' OR Email = '${Email}' OR Tel = '${Tel}'
    `);

    if (checkQuery.recordset.length > 0) {
      return res.status(400).json({ status: 'fail', message: 'User already exists' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const contact = Way === 'Email' ? Email : Tel;
    const isEmail = Way === 'Email';

    await sendOtp(contact, isEmail, otp);

    return res.json({ status: 'success', message: 'OTP sent' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'fail', message: 'Server error', error: err.message });
  }
};

exports.registerConfirm = async (req, res) => {
  const { FirstName, LastName, IdenNumber, Addr, Email, Tel, Way, otp } = req.body;

  if (!FirstName || !LastName || !IdenNumber || !Addr || !Email || !Tel || !Way || !otp) {
    return res.status(400).json({ status: 'fail', message: 'Missing required fields' });
  }

  const contact = Way === 'Email' ? Email : Tel;
  const record = otpStore.get(contact);

  if (!record) {
    return res.status(400).json({ status: 'fail', message: 'No OTP request found for this contact' });
  }

  if (Date.now() > record.expires) {
    otpStore.delete(contact);
    return res.status(400).json({ status: 'fail', message: 'OTP expired' });
  }

  if (record.otp !== otp) {
    return res.status(401).json({ status: 'fail', message: 'Incorrect OTP' });
  }

  try {
    await sql.connect(dbConfig);
    const request = new sql.Request();
    request.input('FirstName', sql.NVarChar(sql.MAX), FirstName);
    request.input('LastName', sql.NVarChar(sql.MAX), LastName);
    request.input('IdenNumber', sql.NVarChar(sql.MAX), IdenNumber);
    request.input('Addr', sql.NVarChar(sql.MAX), Addr);
    request.input('Email', sql.NVarChar(sql.MAX), Email);
    request.input('Tel', sql.NVarChar(sql.MAX), Tel);
    request.input('CreatedAt', sql.DateTime, new Date());

    // Double-check user doesn't already exist (prevent duplicate if double-submit)
    const checkQuery = await request.query(`
      SELECT * FROM UserData
      WHERE IdenNumber = '${IdenNumber}' OR Email = '${Email}' OR Tel = '${Tel}'
    `);

    if (checkQuery.recordset.length > 0) {
      return res.status(400).json({ status: 'fail', message: 'User already exists' });
    }

    await request.query(`
      INSERT INTO UserData (FirstName, LastName, IdenNumber, Addr, Email, Tel, CreatedAt)
      VALUES (@FirstName, @LastName, @IdenNumber, @Addr, @Email, @Tel, @CreatedAt)
    `);

    otpStore.delete(contact);

    // After inserting new user
    const getUser = await request.query(`
      SELECT ID FROM UserData
      WHERE Email = '${Email}' OR Tel = '${Tel}'
    `);

    const user = getUser.recordset[0];

    const token = jwt.sign(
      { id: user.ID },
      process.env.JWT_SECRET || 'your_secret_key',
      { expiresIn: '3h' }
    );

    return res.json({ status: 'success', message: 'Transaction recorded successfully', token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'fail', message: 'Server error', error: err.message });
  }
};

exports.login = async (req, res) => {
  const { Contact } = req.body;

  if (!Contact) {
    return res.status(400).json({ status: 'fail', message: 'Contact (email or phone) is required' });
  }

  try {
    await sql.connect(dbConfig);
    const request = new sql.Request();

    const loginQuery = await request.query(`
      SELECT * FROM UserData
      WHERE Email = '${Contact}' OR Tel = '${Contact}'
    `);

    if (loginQuery.recordset.length === 0) {
      return res.status(404).json({ status: 'fail', message: 'User not found' });
    }

    const isEmail = Contact.includes('@');
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await sendOtp(Contact, isEmail, otp);

    return res.json({ status: 'success', message: 'OTP sent to user for login' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: 'fail', message: 'Server error', error: err.message });
  }
};

exports.loginConfirm = async (req, res) => {
  const { Contact, otp } = req.body;
  const record = otpStore.get(Contact);

  if (!record) return res.status(400).json({ status: 'fail', message: 'No OTP request found for this email' });

  if (Date.now() > record.expires) {
    otpStore.delete(Contact);
    return res.status(400).json({ status: 'fail', message: 'OTP expired' });
  }

  if (record.otp !== otp) {
    return res.status(401).json({ status: 'fail', message: 'Incorrect OTP' });
  }

  await sql.connect(dbConfig);
  const request = new sql.Request();
  const result = await request.query(`
    SELECT ID FROM UserData WHERE Email = '${Contact}' OR Tel = '${Contact}'
  `);
  const user = result.recordset[0];

  const token = jwt.sign(
    { id: user.ID },
    process.env.JWT_SECRET || 'your_secret_key',
    { expiresIn: '3h' }
  );

  const adminIds = (process.env.ADMIN_IDS || '').split(',').map(id => Number(id.trim()));
  const isAdmin = adminIds.includes(Number(user.ID));

  res.json({ status: 'success', message: 'Transaction recorded successfully', token, isAdmin});
};

exports.sendOtp = async (req, res) => {
  const { Email } = req.body;

  // Validate input
  if (!Email) {
    return res.status(400).json({ status: 'fail', message: 'Did not send email / phone number' });
  }

  const isEmail = Email.includes('@');
  const isPhone = /^\d{10,15}$/.test(Email);

  if (!isEmail && !isPhone) {
    return res.status(400).json({ status: 'fail', message: 'Invalid email or phone number' });
  }

  // Check if OTP already exists and is still valid
  const existing = otpStore.get(Email);
  if (existing && Date.now() < existing.expires) {
    return res.status(400).json({
      status: 'fail',
      message: 'An OTP has already been sent. Please wait before requesting a new one.'
    });
  }

  // Generate OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expires = Date.now() + 5 * 60 * 1000;

  otpStore.set(Email, { otp, expires, contact: Email });

  if (isEmail) {
    // 📧 Email via Office365
    const transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: parseInt(process.env.MAIL_PORT, 10),
      secure: process.env.MAIL_SECURE === 'true', // convert string to boolean
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
      to: req.body.Email,        // dynamically provided (e.g., req.body.Email)
      subject: process.env.MAIL_SUBJECT,
      text: `${process.env.MAIL_HEAD_CONTENT} ${otp}`
    };

    try {
      await transporter.sendMail(mailOptions);
      return res.json({ status: 'success', message: 'OTP sent to email' });
    } catch (err) {
      return res.status(500).json({ status: 'fail', message: 'Failed to send OTP email', error: err.message });
    }

  } else if (isPhone) {
    // 📱 Send via Custom SMS Gateway
    const toPhone = '66' + Email.replace(/^0/, '');

    const smsPayload = qs.stringify({
      CMD: 'SENDMSG',
      FROM: 'AMPOLFOOD',
      TO: toPhone,
      REPORT: 'Y',
      CHARGE: '66800474243',
      CODE: '45140533002',
      CTYPE: 'TEXT',
      CONTENT: `Your OTP number are: ${otp}`
    });

    try {
      const smsResponse = await axios.post('https://110.49.174.171:10443', smsPayload, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
      });

      return res.json({ status: 'success', message: 'OTP sent via SMS', response: smsResponse.data });
    } catch (err) {
      console.error('SMS sending error:', err.response?.data || err.message);
      return res.status(500).json({ status: 'fail', message: 'Failed to send OTP SMS', error: err.message });
    }
  }
};

exports.verifyOtp = async (req, res) => {
  const { Email, otp } = req.body;
  const record = otpStore.get(Email);

  if (!record) return res.status(400).json({ status: 'fail', message: 'No OTP request found for this email' });

  if (Date.now() > record.expires) {
    otpStore.delete(Email);
    return res.status(400).json({ status: 'fail', message: 'OTP expired' });
  }

  if (record.otp !== otp) {
    return res.status(401).json({ status: 'fail', message: 'Incorrect OTP' });
  }

    // Generate JWT token (valid for 2 hours)
  const token = jwt.sign({ email: Email }, 'your_secret_key', { expiresIn: '3h' });
  res.json({ status: 'success', message: 'Transaction recorded successfully', token });
};