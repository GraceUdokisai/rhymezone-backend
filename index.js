const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const MONGODB_URI = process.env.MONGODB_URI;

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
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);

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
  const { email, password } = req.body;
  const existing = await User.findOne({ email });
  if(existing) return res.json({ error: 'Email already exists' });

  const hashed = await bcrypt.hash(password, 10);
  const userId = uuidv4();
  const newUser = new User({ id: userId, email, password: hashed });
  await newUser.save();
  res.json({ userId, message: 'Registered successfully' });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if(!user) return res.json({ error: 'User not found' });

  const valid = await bcrypt.compare(password, user.password);
  if(!valid) return res.json({ error: 'Wrong password' });

  res.json({ userId: user.id, message: 'Login successful' });
});

// MONEY ROUTES
app.get('/api/user/:userId', async (req, res) => {
  const user = await User.findOne({ id: req.params.userId });
  res.json(user);
});

app.get('/api/transactions/:userId', async (req, res) => {
  const txs = await Transaction.find({ userId: req.params.userId }).sort({ createdAt: -1 });
  res.json(txs);
});

app.post('/deposit', async (req, res) => {
  const { email, amount, userId } = req.body;
  const response = await axios.post('https://api.paystack.co/transaction/initialize',
    { email, amount: amount * 100, metadata: { userId } },
    { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } } // <-- FIXED HERE
  );
  res.json(response.data);
});

app.post('/api/withdraw', async (req, res) => {
  const { userId, amount } = req.body;
  await User.updateOne({ id: userId }, { $inc: { balance: -amount } });
  const tx = new Transaction({ userId, type: 'Withdraw', amount });
  await tx.save();
  res.json({ message: 'Withdrawal successful' });
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));