const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = 'rhymezone_secret_key';

// MongoDB Connection
mongoose.connect(MONGODB_URI)
.then(() => console.log('MongoDB Connected'))
.catch(err => console.log(err));

// MongoDB Schemas
const UserSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 0 }
});

const TransactionSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  type: { type: String, required: true },
  amount: { type: Number, required: true },
  reference: { type: String },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);

// middleware to check token
function authenticateToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

// TEST ROUTE
app.get('/', (req, res) => {
  res.json({ message: "RhymeZone Backend is Live!" });
});

// RHYME ROUTES
app.get('/rhyme', async (req, res) => {
  const word = req.query.word;
  const response = await axios.get(`https://api.datamuse.com/words?rel_rhy=${word}`);
  res.json({ word, rhymes: response.data.map(w => w.word) });
});

app.get('/random', async (req, res) => {
  const words = ['love', 'time', 'money', 'dream', 'music', 'life'];
  const word = words[Math.floor(Math.random() * words.length)];
  res.json({ word });
});

// AUTH ROUTES
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    const existing = await User.findOne({ email });
    if(existing) return res.status(400).json({ error: 'Email already exists' });

    const hashed = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    const newUser = new User({ id: userId, email, password: hashed });
    await newUser.save();
    res.json({ userId, message: 'Registered successfully' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if(!user) return res.status(400).json({ error: 'User not found' });

    const valid = await bcrypt.compare(password, user.password);
    if(!valid) return res.status(400).json({ error: 'Wrong password' });

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
    res.json({ token, userId: user.id, message: 'Login successful' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// MONEY ROUTES
app.get('/api/user/:userId', async (req, res) => {
  const user = await User.findOne({ id: req.params.userId });
  if(!user) return res.status(404).json({ error: 'User not found' });
  res.json({ balance: user.balance });
});

app.get('/api/transactions/:userId', async (req, res) => {
  const txs = await Transaction.find({ userId: req.params.userId }).sort({ createdAt: -1 });

  const formattedTxs = txs.map(tx => {
    const date = new Date(tx.createdAt);
    const formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    return {
      type: tx.type,
      amount: tx.amount,
      date: formattedDate
    }
  });

  res.json(formattedTxs);
});

// VERIFY PAYMENT ROUTE
app.post('/api/verify-payment', authenticateToken, async (req, res) => {
  try {
    const { reference } = req.body;
    const userId = req.user.id;

    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });

    const paymentData = response.data;

    if (paymentData.status === 'success') {
      const amount = paymentData.amount / 100;

      await User.updateOne({ id: userId }, { $inc: { balance: Number(amount) } });
      const tx = new Transaction({ userId, type: 'Deposit', amount: Number(amount), reference });
      await tx.save();

      const user = await User.findOne({ id: userId });
      res.json({ success: true, message: `Deposited ₦${amount} successfully!`, balance: user.balance });
    } else {
      res.json({ success: false, message: 'Payment not successful' });
    }
  } catch(err) {
    res.status(500).json({ error: 'Verification failed: ' + err.message });
  }
});

// OLD WITHDRAW - KEEP FOR TESTING
app.post('/api/withdraw', authenticateToken, async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.user.id;
    const user = await User.findOne({ id: userId });

    if(user.balance < Number(amount)) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    await User.updateOne({ id: userId }, { $inc: { balance: -Number(amount) } });
    const tx = new Transaction({ userId, type: 'Withdraw', amount: Number(amount) });
    await tx.save();
    res.json({ message: 'Withdrawal successful' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// NEW 1: GET BANK LIST
app.get('/api/banks', async (req, res) => {
  try {
    const response = await axios.get('https://api.paystack.co/bank', {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
    });
    res.json(response.data);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// NEW 2: AUTO WITHDRAW TO BANK
app.post('/api/withdraw-bank', authenticateToken, async (req, res) => {
  try {
    const { amount, accountNumber, bankCode } = req.body;
    const userId = req.user.id;
    const user = await User.findOne({ id: userId });

    if(user.balance < Number(amount)) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    if(Number(amount) < 100) {
      return res.status(400).json({ error: 'Minimum withdrawal is ₦100' });
    }

    // 1. CREATE RECIPIENT
    const recipientRes = await axios.post('https://api.paystack.co/transferrecipient', {
      type: "nuban",
      name: user.email,
      account_number: accountNumber,
      bank_code: bankCode,
      currency: "NGN"
    }, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } });

    const recipientCode = recipientRes.data.data.recipient_code;

    // 2. INITIATE TRANSFER
    const transferRes = await axios.post('https://api.paystack.co/transfer', {
      source: "balance",
      amount: Number(amount) * 100,
      recipient: recipientCode,
      reason: "RhymeZone Withdrawal"
    }, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } });

    // 3. DEDUCT BALANCE ONLY IF TRANSFER SUCCESS
    if(transferRes.data.status === true) {
      await User.updateOne({ id: userId }, { $inc: { balance: -Number(amount) } });
      const tx = new Transaction({ userId, type: 'Withdraw', amount: Number(amount) });
      await tx.save();
      res.json({ message: `₦${amount} sent to your bank! It will arrive in 10 minutes.` });
    } else {
      res.json({ error: 'Transfer failed: ' + transferRes.data.message });
    }

  } catch(err) {
    res.status(500).json({ error: 'Withdrawal failed: ' + err.message });
  }
});

// CREATE RECIPIENT ROUTE - OLD
app.post('/create-recipient', async (req, res) => {
  const { name } = req.body;
  console.log("Received name:", name);

  if (!name) {
    return res.status(400).json({ success: false, message: "Name is required" });
  }

  res.json({
    success: true,
    message: "Recipient created!",
    name: name
  });
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
