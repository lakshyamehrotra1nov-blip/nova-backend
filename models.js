const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  type: { type: String, required: true }, // 'income' or 'expense'
  amount: { type: Number, required: true },
  category: { type: String, required: true },
  date: { type: String, required: true },
  note: { type: String },
  walletId: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet' }
}, { timestamps: true });

const BudgetSchema = new mongoose.Schema({
  category: { type: String, required: true, unique: true },
  limit: { type: Number, required: true },
}, { timestamps: true });

const SubscriptionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  amount: { type: Number, required: true },
  date: { type: Number, required: true },
  category: { type: String, default: 'Uncategorized' },
  type: { type: String, enum: ['income', 'expense'], default: 'expense' },
}, { timestamps: true });

const SettingsSchema = new mongoose.Schema({
  currency: { type: String, default: 'USD' },
}, { timestamps: true });

const GoalSchema = new mongoose.Schema({
  name: { type: String, required: true },
  targetAmount: { type: Number, required: true },
  currentAmount: { type: Number, default: 0 },
  deadline: { type: String, required: true },
}, { timestamps: true });

const WalletSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, required: true }, // 'checking', 'savings', 'credit'
  balance: { type: Number, default: 0 },
  apr: { type: Number, default: 0 } // For credit cards
}, { timestamps: true });

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, required: true }
}, { timestamps: true });

const OtpSchema = new mongoose.Schema({
  email: { type: String, required: true },
  otp: { type: String, required: true },
  createdAt: { type: Date, expires: '10m', default: Date.now }
});

const InvestmentSchema = new mongoose.Schema({
  id: { type: String, required: true }, // coingecko id
  name: { type: String, required: true },
  symbol: { type: String, required: true },
  amount: { type: Number, required: true },
}, { timestamps: true });

module.exports = {
  Transaction: mongoose.model('Transaction', TransactionSchema),
  Budget: mongoose.model('Budget', BudgetSchema),
  Subscription: mongoose.model('Subscription', SubscriptionSchema),
  Settings: mongoose.model('Settings', SettingsSchema),
  Goal: mongoose.model('Goal', GoalSchema),
  Wallet: mongoose.model('Wallet', WalletSchema),
  User: mongoose.model('User', UserSchema),
  Otp: mongoose.model('Otp', OtpSchema),
  Investment: mongoose.model('Investment', InvestmentSchema),
};
