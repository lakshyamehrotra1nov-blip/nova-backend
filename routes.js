const express = require('express');
const router = express.Router();
const { Transaction, Budget, Subscription, Settings, Goal, Wallet, User, Otp, Investment, Debt } = require('./models');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

// --- EMAIL TRANSPORTER ---
let transporter;

if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
  console.log('📧 Gmail transporter configured successfully.');
} else {
  nodemailer.createTestAccount().then(account => {
    transporter = nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: { user: account.user, pass: account.pass }
    });
    console.log('📧 Ethereal Email test account created. (Add EMAIL_USER and EMAIL_PASS to .env to use Gmail)');
  }).catch(err => console.error('Failed to create Ethereal account:', err));
}

// --- AUTH ---
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ error: 'Email already exists' });
    
    const user = new User({ email, password, name });
    await user.save();
    res.status(201).json({ id: user._id, name: user.name, email: user.email });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.json({ id: user._id, name: user.name, email: user.email });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit OTP
    await Otp.findOneAndUpdate({ email }, { otp }, { upsert: true, new: true });
    
    if (transporter) {
      const info = await transporter.sendMail({
        from: '"NovaTrack Admin" <admin@novatrack.com>',
        to: email,
        subject: 'Password Reset OTP',
        text: `Your OTP for password reset is: ${otp}. It will expire in 10 minutes.`
      });
      console.log('✅ OTP sent to', email);
      console.log('🔗 Preview URL: %s', nodemailer.getTestMessageUrl(info));
    } else {
      console.log(`Fallback: OTP for ${email} is ${otp}`);
    }
    
    res.json({ success: true, message: 'OTP sent to email' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const validOtp = await Otp.findOne({ email, otp });
    if (!validOtp) return res.status(400).json({ error: 'Invalid or expired OTP' });

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    user.password = newPassword;
    await user.save();
    await Otp.deleteOne({ email }); // Delete OTP after successful use
    
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- TRANSACTIONS ---
router.get('/transactions', async (req, res) => {
  try {
    const txs = await Transaction.find().sort({ date: -1 });
    res.json(txs.map(t => ({ id: t._id, ...t.toObject() })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/transactions', async (req, res) => {
  try {
    const tx = new Transaction(req.body);
    await tx.save();
    
    // Update Wallet Balance if applicable
    if (tx.walletId) {
      const wallet = await Wallet.findById(tx.walletId);
      if (wallet) {
        if (wallet.type === 'credit') {
          // For credit cards, an expense increases the balance owed, income decreases it.
          wallet.balance += (tx.type === 'expense' ? tx.amount : -tx.amount);
        } else {
          // For checking/savings, an expense decreases the balance, income increases it.
          wallet.balance += (tx.type === 'income' ? tx.amount : -tx.amount);
        }
        await wallet.save();
      }
    }

    res.status(201).json({ id: tx._id, ...tx.toObject() });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/transactions/:id', async (req, res) => {
  try {
    await Transaction.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- BUDGETS ---
router.get('/budgets', async (req, res) => {
  try {
    const budgets = await Budget.find();
    // Convert array of docs to object: { "Food": 500, "Shopping": 300 }
    const formatted = budgets.reduce((acc, curr) => {
      acc[curr.category] = curr.limit;
      return acc;
    }, {});
    res.json(formatted);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/budgets', async (req, res) => {
  try {
    const { category, limit } = req.body;
    await Budget.findOneAndUpdate({ category }, { limit }, { upsert: true, new: true });
    res.json({ success: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// --- SUBSCRIPTIONS ---
router.get('/subscriptions', async (req, res) => {
  try {
    const subs = await Subscription.find();
    res.json(subs.map(s => ({ id: s._id, ...s.toObject() })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/subscriptions', async (req, res) => {
  try {
    const sub = new Subscription({
      name: req.body.name,
      amount: req.body.amount,
      date: req.body.date,
      category: req.body.category,
      type: req.body.type || 'expense',
      isFreeTrial: req.body.isFreeTrial || false,
      trialEndDate: req.body.trialEndDate || null
    });
    await sub.save();
    res.status(201).json({ id: sub._id, ...sub.toObject() });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/subscriptions/:id', async (req, res) => {
  try {
    await Subscription.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// --- DEBTS ---
router.get('/debts', async (req, res) => {
  try {
    const debts = await Debt.find();
    res.json(debts.map(d => ({ id: d._id, ...d.toObject() })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/debts', async (req, res) => {
  try {
    const debt = new Debt(req.body);
    await debt.save();
    res.status(201).json({ id: debt._id, ...debt.toObject() });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/debts/:id', async (req, res) => {
  try {
    await Debt.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// --- GOALS ---
router.get('/goals', async (req, res) => {
  try {
    const goals = await Goal.find().sort({ createdAt: -1 });
    res.json(goals.map(g => ({ id: g._id, ...g.toObject() })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/goals', async (req, res) => {
  try {
    const goal = new Goal({
      name: req.body.name,
      targetAmount: req.body.targetAmount,
      currentAmount: req.body.currentAmount || 0,
      deadline: req.body.deadline
    });
    await goal.save();
    res.status(201).json({ id: goal._id, ...goal.toObject() });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/goals/:id', async (req, res) => {
  try {
    const goal = await Goal.findByIdAndUpdate(req.params.id, { currentAmount: req.body.currentAmount }, { new: true });
    res.json({ id: goal._id, ...goal.toObject() });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/goals/:id', async (req, res) => {
  try {
    await Goal.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// --- WALLETS ---
router.get('/wallets', async (req, res) => {
  try {
    const wallets = await Wallet.find().sort({ createdAt: 1 });
    res.json(wallets.map(w => ({ id: w._id, ...w.toObject() })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/wallets', async (req, res) => {
  try {
    const wallet = new Wallet(req.body);
    await wallet.save();
    res.status(201).json({ id: wallet._id, ...wallet.toObject() });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/wallets/:id', async (req, res) => {
  try {
    const wallet = await Wallet.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ id: wallet._id, ...wallet.toObject() });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/wallets/:id', async (req, res) => {
  try {
    await Wallet.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// --- SETTINGS ---
router.get('/settings', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({ currency: 'USD' });
    }
    res.json({ currency: settings.currency });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/settings', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (settings) {
      settings.currency = req.body.currency;
      await settings.save();
    } else {
      settings = await Settings.create({ currency: req.body.currency });
    }
    res.json({ currency: settings.currency });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- INVESTMENTS ---
router.get('/investments', async (req, res) => {
  try {
    const investments = await Investment.find().sort({ createdAt: -1 });
    res.json(investments.map(i => ({ _id: i._id, id: i.id, name: i.name, symbol: i.symbol, amount: i.amount })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/investments', async (req, res) => {
  try {
    const investment = new Investment({
      id: req.body.id,
      name: req.body.name,
      symbol: req.body.symbol,
      amount: req.body.amount
    });
    await investment.save();
    res.status(201).json({ _id: investment._id, id: investment.id, name: investment.name, symbol: investment.symbol, amount: investment.amount });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/investments/:dbId', async (req, res) => {
  try {
    await Investment.findByIdAndDelete(req.params.dbId);
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// --- AI ENDPOINTS (Proxied) ---
router.post('/ai/advice', async (req, res) => {
  try {
    const { income, expenses, balance, formattedExpensesByCategory, formattedBudgets } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'GEMINI_API_KEY is missing on server.' });

    const prompt = `
      You are an expert financial advisor AI inside an expense tracking app.
      Analyze the following user financial data and provide a short, actionable, and encouraging 3-sentence financial advice.
      Be specific about their categories. Do not use generic greetings.

      Total Income: ${income}
      Total Expenses: ${expenses}
      Current Balance: ${balance}
      Expenses by Category: ${JSON.stringify(formattedExpensesByCategory)}
      Budgets set: ${JSON.stringify(formattedBudgets)}
    `;

    const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (!aiRes.ok) return res.status(aiRes.status).json({ error: await aiRes.text() });
    const data = await aiRes.json();
    res.json({ advice: data.candidates[0].content.parts[0].text });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ai/scan', async (req, res) => {
  try {
    const { base64Image, mimeType } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'GEMINI_API_KEY is missing on server.' });

    const prompt = `
      Analyze this receipt image and extract the following information.
      Return ONLY a valid, plain JSON object (without markdown blocks like \`\`\`json) with these exact keys:
      {
        "amount": <number representing the total amount>,
        "date": "<string in YYYY-MM-DD format, or today's date if not found>",
        "category": "<guess the category, e.g., Food, Groceries, Transport, Utilities, General>"
      }
    `;

    const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64Image.split(',')[1] } }
          ]
        }],
        generationConfig: {
          response_mime_type: "application/json"
        }
      })
    });

    if (!aiRes.ok) return res.status(aiRes.status).json({ error: await aiRes.text() });
    const data = await aiRes.json();
    res.json({ result: data.candidates[0].content.parts[0].text });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ai/import', async (req, res) => {
  try {
    const { csvText } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'GEMINI_API_KEY is missing on server.' });

    const prompt = `
      You are an AI designed to parse bank statement CSVs into clean JSON.
      I will provide raw CSV text. Return ONLY a valid JSON array of objects representing the transactions.
      Each object must have these exact keys:
      {
        "date": "YYYY-MM-DD",
        "amount": number (positive absolute value),
        "type": "expense" or "income",
        "category": "Food, Transport, Utilities, Housing, Shopping, Entertainment, Healthcare, General, Salary, Investment, etc",
        "note": "Short description based on the CSV description"
      }
      If it's a credit or deposit, type is "income". If it's a debit or charge, type is "expense".
      
      CSV DATA:
      ${csvText}
    `;

    const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          response_mime_type: "application/json"
        }
      })
    });

    if (!aiRes.ok) return res.status(aiRes.status).json({ error: await aiRes.text() });
    const data = await aiRes.json();
    res.json({ result: data.candidates[0].content.parts[0].text });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ai/chat', async (req, res) => {
  try {
    const { query, formattedHistory, systemContext } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'GEMINI_API_KEY is missing on server.' });

    const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemContext }] },
        contents: [
          ...formattedHistory,
          { role: 'user', parts: [{ text: query }] }
        ],
        generationConfig: {
          response_mime_type: "application/json"
        }
      })
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      let readableError = "API Error";
      try {
        const errJson = JSON.parse(errText);
        if (errJson.error && errJson.error.message) {
          readableError = errJson.error.message;
          if (readableError.includes("is not found")) {
            const modelsRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
            const modelsData = await modelsRes.json();
            const modelNames = modelsData.models.map(m => m.name.replace('models/', '')).filter(n => n.includes('gemini')).join(', ');
            readableError += ` AVAILABLE MODELS: ${modelNames}`;
          }
          if (aiRes.status === 429 || readableError.includes("quota") || readableError.includes("429")) {
            readableError = "I'm thinking too fast! Nova AI's rate limit was reached. Please wait about 15 seconds and try again. ⏳";
          }
        }
      } catch (e) {}
      return res.status(aiRes.status).json({ error: readableError });
    }

    const data = await aiRes.json();
    res.json({ result: data.candidates[0].content.parts[0].text });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- WIPE ALL (Reset) ---
router.post('/wipe', async (req, res) => {
  try {
    await Transaction.deleteMany({});
    await Budget.deleteMany({});
    await Subscription.deleteMany({});
    await Investment.deleteMany({});
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
