const Order = require('../models/Order');
const IcoTransaction = require('../models/IcoTransaction');
const IcoHolding = require('../models/IcoHolding');
const WalletTransaction = require('../models/WalletTransaction');
const WalletAccount = require('../models/WalletAccount');
const { distributeReferralCommission } = require('../utils/referralService');
const {
  verifySignature: verifyRazorpaySignature,
  createOrder: createRazorpayOrder,
  RAZORPAY_KEY_ID,
} = require('../utils/razorpay');
const { getOrCreateWalletAccount } = require('../utils/walletAccount');
const { createUserNotification } = require('../utils/notificationService');

const PHONEPE_SUCCESS_CODES = ['PAYMENT_SUCCESS', 'SUCCESS'];

const createRazorpayWalletOrder = async (req, res) => {
  try {
    const { amount, currency = 'INR', description } = req.body || {};
    const numericAmount = Number(amount);

    if (!numericAmount || numericAmount <= 0) {
      return res.status(400).json({ message: 'Valid amount is required' });
    }

    const normalizedCurrency = String(currency || 'INR').toUpperCase();
    const wallet = await getOrCreateWalletAccount(req.user._id);
    // Razorpay receipt must be <= 40 chars; keep a short, unique receipt
    const receipt = `w_${wallet._id.toString().slice(-12)}_${Date.now().toString().slice(-6)}`;

    const order = await createRazorpayOrder({
      amount: numericAmount,
      currency: normalizedCurrency,
      receipt,
      notes: {
        userId: String(req.user._id),
        purpose: 'wallet_topup',
      },
    });

    const walletTx = await WalletTransaction.create({
      user: req.user._id,
      wallet: wallet._id,
      type: 'credit',
      category: 'topup',
      amount: numericAmount,
      currency: normalizedCurrency,
      status: 'pending',
      description: description || 'Wallet top-up via Razorpay',
      paymentGateway: 'razorpay',
      merchantTransactionId: order.id,
      razorpayOrderId: order.id,
      razorpayResponse: order,
    });

    return res.json({
      orderId: order.id,
      amountInPaise: order.amount,
      currency: order.currency,
      key: RAZORPAY_KEY_ID,
      transactionId: walletTx._id,
      mock: Boolean(order.mock),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const handlePhonePeCallback = async (req, res) => {
  try {
    const payload = req.body?.data || req.body;
    const merchantTransactionId = payload?.merchantTransactionId || payload?.orderId;
    const transactionId = payload?.transactionId;
    const code = payload?.code;
    const status = PHONEPE_SUCCESS_CODES.includes(code) ? 'paid' : 'failed';

    if (!merchantTransactionId) {
      return res.status(400).json({ message: 'merchantTransactionId missing' });
    }

    let handled = false;

    const order = await Order.findById(merchantTransactionId);
    if (order) {
      order.paymentStatus = status === 'paid' ? 'paid' : 'failed';
      order.status = status === 'paid' ? 'confirmed' : 'pending';
      order.phonePePaymentLink = undefined;
      order.phonePePayload = undefined;
      await order.save();
      handled = true;

      if (status === 'paid') {
        const orderAmount = order.totals?.grandTotal || order.totals?.subtotal || 0;
        await distributeReferralCommission({
          buyerId: order.user,
          amount: orderAmount,
          sourceType: 'order',
          sourceId: order._id.toString(),
        });
      }
    }

    if (!handled) {
      const transaction = await IcoTransaction.findById(merchantTransactionId);
      if (transaction) {
        transaction.status = status === 'paid' ? 'completed' : 'failed';
        transaction.phonePeTransactionId = transactionId;
        await transaction.save();

      if (status === 'paid' && transaction.type === 'buy') {
        const holding = await IcoHolding.findOneAndUpdate(
          { user: transaction.user },
          { $inc: { balance: transaction.tokenAmount } },
          { new: true, upsert: true },
        );
        await distributeReferralCommission({
          buyerId: transaction.user,
          amount: transaction.fiatAmount,
          sourceType: 'ico',
          sourceId: transaction._id.toString(),
        });
        await createUserNotification({
          userId: transaction.user,
          title: 'Token purchase successful',
          message: `Purchased ${transaction.tokenAmount} tokens.`,
          type: 'transaction',
          metadata: { transactionId: transaction._id },
        });
        handled = true;
        console.log('ICO holding updated', holding.balance);
      } else if (status !== 'paid' && transaction.type === 'buy') {
        console.log('ICO transaction failed');
        await createUserNotification({
          userId: transaction.user,
          title: 'Token purchase failed',
          message: 'Your token purchase failed. Please try again.',
          type: 'transaction',
          metadata: { transactionId: transaction._id },
        });
      }
    }
    }

    if (!handled) {
      const walletTransaction = await WalletTransaction.findById(merchantTransactionId);
      if (walletTransaction) {
        handled = true;
        walletTransaction.status = status === 'paid' ? 'completed' : 'failed';
        walletTransaction.phonePeTransactionId = transactionId;
        walletTransaction.phonePeResponse = payload;
        await walletTransaction.save();

        if (status === 'paid' && walletTransaction.type === 'credit') {
          const walletQuery = walletTransaction.wallet
            ? { _id: walletTransaction.wallet }
            : { user: walletTransaction.user };

          await WalletAccount.findOneAndUpdate(
            walletQuery,
            {
              $inc: {
                balance: walletTransaction.amount,
                totalCredited: walletTransaction.amount,
              },
              $setOnInsert: { user: walletTransaction.user },
            },
            { upsert: true, setDefaultsOnInsert: true },
          );
        }

        await createUserNotification({
          userId: walletTransaction.user,
          title: status === 'paid' ? 'Wallet top-up successful' : 'Wallet top-up failed',
          message:
            status === 'paid'
              ? `Wallet credited with INR ${walletTransaction.amount}.`
              : 'Your wallet top-up failed. Please try again.',
          type: 'transaction',
          metadata: { transactionId: walletTransaction._id },
        });
      }
    }

    res.json({ handled, merchantTransactionId, code: status });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const handleRazorpayVerify = async (req, res) => {
  try {
    // Accept both camelCase and Razorpay default field names from the checkout response
    const {
      orderId: bodyOrderId,
      paymentId: bodyPaymentId,
      signature: bodySignature,
      transactionId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body || {};

    const orderId = bodyOrderId || razorpay_order_id;
    const paymentId = bodyPaymentId || razorpay_payment_id;
    const signature = bodySignature || razorpay_signature;

    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({
        message: 'orderId, paymentId and signature are required',
        receivedKeys: Object.keys(req.body || {}),
      });
    }

    const valid = verifyRazorpaySignature({ orderId, paymentId, signature });
    if (!valid) {
      return res.status(400).json({ message: 'Invalid signature' });
    }

    // First try ICO transaction
    let transaction = await IcoTransaction.findOne(
      transactionId ? { _id: transactionId } : { paymentReference: orderId },
    );
    if (transaction) {
      transaction.status = 'completed';
      transaction.paymentReference = orderId;
      transaction.phonePeTransactionId = paymentId; // reuse field for tracking
      await transaction.save();

      if (transaction.type === 'buy') {
        const holding = await IcoHolding.findOneAndUpdate(
          { user: transaction.user },
          { $inc: { balance: transaction.tokenAmount } },
          { new: true, upsert: true },
        );
        await distributeReferralCommission({
          buyerId: transaction.user,
          amount: transaction.fiatAmount,
          sourceType: 'ico',
          sourceId: transaction._id.toString(),
        });
        await createUserNotification({
          userId: transaction.user,
          title: 'Token purchase successful',
          message: `Purchased ${transaction.tokenAmount} tokens.`,
          type: 'transaction',
          metadata: { transactionId: transaction._id },
        });
        return res.json({ status: 'success', transactionId: transaction._id, holding, kind: 'ico' });
      }

      return res.json({ status: 'success', transactionId: transaction._id, kind: 'ico' });
    }

    // Then try Wallet topup transaction
    const walletTx = await WalletTransaction.findOne(
      transactionId ? { _id: transactionId } : { merchantTransactionId: orderId },
    );
    if (!walletTx) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    walletTx.status = 'completed';
    walletTx.razorpayOrderId = orderId;
    walletTx.razorpayPaymentId = paymentId;
    walletTx.razorpaySignature = signature;
    await walletTx.save();

    if (walletTx.type === 'credit' && walletTx.category === 'topup') {
      const walletQuery = walletTx.wallet ? { _id: walletTx.wallet } : { user: walletTx.user };
      const wallet = await WalletAccount.findOneAndUpdate(
        walletQuery,
        {
          $inc: {
            balance: walletTx.amount,
            totalCredited: walletTx.amount,
          },
          $setOnInsert: { user: walletTx.user },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
      await createUserNotification({
        userId: walletTx.user,
        title: 'Wallet top-up successful',
        message: `Wallet credited with INR ${walletTx.amount}.`,
        type: 'transaction',
        metadata: { transactionId: walletTx._id },
      });
      return res.json({ status: 'success', transactionId: walletTx._id, wallet, kind: 'wallet' });
    }

    res.json({ status: 'success', transactionId: walletTx._id, kind: 'wallet' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createRazorpayWalletOrder,
  handlePhonePeCallback,
  handleRazorpayVerify,
};
