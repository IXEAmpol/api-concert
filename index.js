const { express } = require('./imports/shared');
const cors = require('cors');
const fs = require('fs');
const https = require('https');
require('dotenv').config();

const app = express();
const HOST = process.env.HOST || 'localhost';
const PORT = process.env.PORT || 3000;
const allowedOrigin = process.env.ALLOWED_ORIGIN;

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Load SSL credentials
const privateKey = fs.readFileSync('./certs/STAR_ampolfood_com.key', 'utf8');
const certificate = fs.readFileSync('./certs/STAR_ampolfood_com.crt', 'utf8');

const credentials = { key: privateKey, cert: certificate };

app.disable('etag');
app.use(cors({}));
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/', (req, res) => res.status(200).send('OK'));

app.use(cors({
  // origin: allowedOrigin
}));
app.use(express.json());
 
// seat
const seatRoutes = require('./seatManage/seatRoute');
app.use('/api', seatRoutes);

// OTP
const OTPRoutes = require('./OTPManage/OTPRoute');
app.use('/api', OTPRoutes);

// user
const userRoutes = require('./userManage/userRoute');
app.use('/api', userRoutes);

// transaction
const transactionRoutes = require('./paymentManage/paymentRoute');
app.use('/api', transactionRoutes);

// admin
const adminRoutes = require('./adminManage/adminRoute');
app.use('/api', adminRoutes);

if(process.env.HOST === '0.0.0.0'){
  // Start HTTPS server
  https.createServer(credentials, app).listen(443, () => {
    console.log('HTTPS Server running on port 443');
  });
}
else{
  app.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
  });
} 