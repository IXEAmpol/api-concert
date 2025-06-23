const bcrypt = require('bcrypt');
const express = require('express');
const router = express.Router();
require('dotenv').config();

if(process.env.DB_SERVER === 'localhost'){
  var sql = require('mssql/msnodesqlv8');

  var dbConfig = {
    connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=ConcertDB;Trusted_Connection=Yes;',
    driver: 'msnodesqlv8'
  };
}else if(process.env.DB_SERVER != ''){
  
  var sql = require('mssql');
  
  var dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER, // e.g. '192.168.1.20' or 'sql.yourdomain.com'
    database: process.env.DB_DATABASE,
    options: {
      encrypt: false, // Set to true if using Azure or SSL
      trustServerCertificate: true, // Use true for development
    }
  };
}

const otpStore = new Map(); // email => { otp, expires, ...userData }

const nodemailer = require('nodemailer');

const ADMIN_IDS = process.env.ADMIN_IDS
  ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim(), 10))
  : [];

module.exports = {
  sql,
  bcrypt,
  dbConfig,
  express,
  router,
  otpStore,
  nodemailer
};
