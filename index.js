const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
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

// Database setup
let db;
(async () => {
  db = await open({
    filename: './database.db',
    driver: sqlite3.Database
  });
  
  // Users table
  await db.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password TEXT,
    balance REAL DEFAULT 0
  )`);
  
  // Transactions table
  await db.exec(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT,
    type TEXT,
    amount REAL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
})();

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
  const existing = await db.get('SELECT * FROM users WHERE email = ?', [email]);
  if(existing) return res.json({ error: 'Email already exists' });

  const hashed = await bcrypt.hash(password, 10);
  const userId = uuidv4();
  await db.run('INSERT INTO users (id, email, password) VALUES (?,?,?)', [userId, email, hashed]);
  res.json({ userId, message: 'Registered successfully' });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
  if(!user) return res.json({ error: 'User not found' });

  const valid = await bcrypt.compare(password, user.password);
  if(!valid) return res.json({ error: 'Wrong password' });

  res.json({ userId: user.id, message: 'Login successful' });
});

// MONEY ROUTES
app.get('/api/user/:userId', async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.params.userId]);
  res.json(user);
});

app.get('/api/transactions/:userId', async (req, res) => {
  const txs = await db.all('SELECT * FROM transactions WHERE userId = ? ORDER BY createdAt DESC', [req.params.userId]);
  res.json(txs);
});

app.post('/deposit', async (req, res) => {
  const { email, amount, userId } = req.body;
  const response = await axios.post('https://api.paystack.co/transaction/initialize',
    { email, amount: amount * 100, metadata: { userId } },
    { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` }
  );
  res.json(response.data);
});

app.post('/api/withdraw', async (req, res) => {
  const { userId, amount } = req.body;
  await db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [amount, userId]);
  await db.run('INSERT INTO transactions (userId, type, amount) VALUES (?,?,?)', [userId, 'Withdraw', amount]);
  res.json({ message: 'Withdrawal successful' });
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));