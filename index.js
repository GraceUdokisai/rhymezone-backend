import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios"; // <-- ADDED FOR RAPIDAPI

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected ✅"))
  .catch((err) => console.error(err));

// User Schema - ADDED TRANSACTIONS
const userSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  balance: { type: Number, default: 0 },
  transactions: [ // NEW: This will store history
    {
      type: { type: String }, // "Deposit" or "Withdraw"
      amount: { type: Number },
      date: { type: Date, default: Date.now }
    }
  ]
});
const User = mongoose.model("User", userSchema);

// Test route
app.get("/", (req, res) => {
  res.send("Backend is running ✅");
});

// ===== NEW: RHYMEZONE ROUTE =====
app.get("/rhyme", async (req, res) => {
  const word = req.query.word;
  if (!word) return res.status(400).json({ error: "word query is required. Example: /rhyme?word=love" });

  try {
    const response = await axios.get('https://rhymezone-com.p.rapidapi.com/words', {
      params: { word: word, max: 20 },
      headers: {
        'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'rhymezone-com.p.rapidapi.com'
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error("Rhyme error:", error.message);
    res.status(500).json({ error: "Failed to fetch rhymes" });
  }
});
// ===== END RHYMEZONE ROUTE =====


// 1. Create Paystack payment
app.post("/deposit", async (req, res) => {
  const { email, amount, userId } = req.body;
  
  try {
    if (!email || !amount || !userId) {
      return res.status(400).json({ status: false, message: "Email, amount, and userId are required" });
    }

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        amount: amount * 100, // Convert to kobo
        metadata: { userId, amount }, // <-- ADDED AMOUNT TOO
        callback_url: `https://rhymezone-backend.onrender.com/payment-callback` // <-- CHANGED TO LIVE URL
      })
    });
    
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Deposit error:", err);
    res.status(500).json({ status: false, message: "Payment initialization failed" });
  }
});

// 2. Paystack callback - Backend verifies FIRST + SAVES TRANSACTION
app.get("/payment-callback", async (req, res) => {
  const { reference } = req.query;
  
  try {
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });
    
    const data = await response.json();
    console.log("Verify result:", data.data.status, "Ref:", reference);
    
    if (data.status && data.data.status === "success") {
      const amountPaid = data.data.amount / 100;
      const userId = data.data.metadata.userId; 
      
      const user = await User.findById(userId);
      user.balance += amountPaid;
      // SAVE TRANSACTION
      user.transactions.push({ type: "Deposit", amount: amountPaid });
      await user.save();

      return res.redirect(`https://rhymezone-backend.onrender.com/verify.html?status=success&reference=${reference}`); // <-- CHANGED TO LIVE URL
    } else {
      return res.redirect("https://rhymezone-backend.onrender.com/verify.html?status=failed"); // <-- CHANGED TO LIVE URL
    }
  } catch (err) {
    console.error("Verify error:", err.message);
    res.redirect("https://rhymezone-backend.onrender.com/verify.html?status=failed"); // <-- CHANGED TO LIVE URL
  }
});

// 3. GET USER BALANCE ROUTE
app.get('/api/user/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ balance: user.balance, email: user.email });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 4. WITHDRAW ROUTE - NOW SAVES TRANSACTION TOO
app.post('/api/withdraw', async (req, res) => {
  try {
    const { userId, amount } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({ message: 'userId and amount required' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.balance < amount) {
      return res.status(400).json({ message: 'Insufficient balance' });
    }

    // Deduct from balance
    user.balance -= amount;
    // SAVE TRANSACTION
    user.transactions.push({ type: "Withdraw", amount: amount });
    await user.save();

    res.json({ 
      message: `Withdrawal of ₦${amount} successful`, 
      newBalance: user.balance 
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 5. NEW: GET ALL TRANSACTIONS ROUTE
app.get('/api/transactions/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user.transactions.reverse()); // newest first
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


const PORT = process.env.PORT || 10000; // <-- CHANGED TO 10000 FOR RENDER
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Paystack key loaded: ${process.env.PAYSTACK_SECRET_KEY ? "YES" : "NO"}`);
  console.log(`RapidAPI key loaded: ${process.env.RAPIDAPI_KEY ? "YES" : "NO"}`); // <-- ADDED
});