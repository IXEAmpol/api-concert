
const { express } = require('./imports/shared');
const cors = require('cors');
require('dotenv').config();

const app = express();
const HOST = process.env.HOST || 'localhost';
const PORT = process.env.PORT || 3000;
const allowedOrigin = process.env.ALLOWED_ORIGIN;

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

if(process.env.DB_SERVER === 'localhost'){
  
}
else{

}
app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
