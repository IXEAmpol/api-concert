const { sql, bcrypt, dbConfig, nodemailer, otpStore } = require('../imports/shared');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const qs = require('qs');
require('dotenv').config();

const sendOtp = async (contact, isEmail, otp, UserName) => {
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
      text: `
      เรียนคุณ ${UserName}
      ศูนย์การแพทย์กาญจนาภิเษก คณะแพทยศาสตร์ศิริราชพยาบาล มหาวิทยาลัยมหิดล
      ขอขอบคุณที่ท่านให้ความสนใจ คอนเสิร์ต Bird Fanfest 20XX (รอบการกุศล)  
      โปรดใช้รหัสนี้  เพื่อเข้าสู่บัญชีของคุณ
      Your OTP code is : ${otp}


      หากท่านต้องการสอบถามเกี่ยวกับการซื้อบัตร
      กรุณาติดต่อ 063-195-4174, 064-931-7415
      LINE OA: @sigj.event (https://lin.ee/tfVt5us) 
      โปรดระวังมิจฉาชีพ หรือบุคคลแอบอ้างเรียกรับเงิน หรือกระทำการใด ๆ ให้เกิดความเสียหายแก่ท่าน การซื้อบัตรคอนเสิร์ต Bird Fanfest 20XX (รอบการกุศล) จะต้องดำเนินการผ่านทางเว็บไซต์ : https://www.sigjhospital.com/birdfanfest20xx/  และชำระเงินโดยการโอนผ่าน QR Code ของศิริราชมูลนิธิเท่านั้น

      สนับสนุนเว็บไซต์โดย บริษัท อำพลฟูดส์ โพรเซสซิ่ง จำกัด
      `
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
      CONTENT: `Your OTP code is : ${otp}`
    });

    await axios.post(process.env.SMS_API, smsPayload, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
    });
  }
};

exports.register = async (req, res) => {
  const { IdenNumber, Email, Tel, Way, FirstName, LastName } = req.body;

  if ( !Email || !Tel || !Way || !FirstName || !LastName ) {
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
    const userName = FirstName + ' ' + LastName;
    const contact = Way === 'Email' ? Email : Tel;
    const isEmail = Way === 'Email';

    await sendOtp(contact, isEmail, otp, userName);

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
    request.input('Contact', sql.NVarChar(255), Contact);

    const loginQuery = await request.query(`
      SELECT * FROM UserData
      WHERE Email = @Contact OR Tel = @Contact
    `);

    if (loginQuery.recordset.length === 0) {
      return res.status(404).json({ status: 'fail', message: 'User not found' });
    }

    const user = loginQuery.recordset[0];
    const userName = user.FirstName + ' ' + user.LastName;
    const isEmail = Contact.includes('@');
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await sendOtp(Contact, isEmail, otp, userName);

    return res.json({ status: 'success', message: `OTP sent to ${userName} for login` });
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

  otpStore.delete(Contact);
  res.json({ status: 'success', message: 'Transaction recorded successfully', token, isAdmin});
};