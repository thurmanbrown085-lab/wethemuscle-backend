require('dotenv').config();
const express = require('express');
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

// Initialize production database pool
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Transporter for automated Outlook settlement telemetry
const mailTransporter = nodemailer.createTransport({
  host: '://office365.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.OUTLOOK_EMAIL,
    pass: process.env.OUTLOOK_PASSWORD
  }
});

app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') {
    next();
  } else {
    express.json()(req, res, next);
  }
});

/**
 * Endpoint to process positive/negative ledger adjustments (Settlements & Reconciliations)
 * type: 'positive' (Debit/Charge Invoice) or 'negative' (Credit Note/Payout Invoice)
 */
app.post('/process-settlement', async (req, res) => {
  try {
    const { customerId, amount, type, description, referenceId } = req.body;
    let adjustment;

    if (type === 'negative') {
      // Process as a Credit Note reconciliation for a negative invoice balance
      adjustment = await stripe.creditNotes.create({
        amount: amount * 100, // convert to cents
        invoice: referenceId, // target invoice ID to credit / reconcile
        memo: description || 'Negative adjustment reconciliation payload'
      });
    } else {
      // Process as a Customer Balance Transaction for positive adjustment injection
      adjustment = await stripe.customers.createBalanceTransaction(customerId, {
        amount: amount * 100, // positive value increments customer balance due
        currency: 'usd',
        description: description || 'Positive adjustment settlement payload'
      });
    }

    // Immediately archive local database ledger details
    await db.query(
      'INSERT INTO ledger_reconciliations(adjustment_id, type, amount, status, reference_id) VALUES($1, $2, $3, $4, $5)',
      [adjustment.id, type, amount, 'reconciled', referenceId || customerId]
    );

    res.json({ success: true, adjustmentId: adjustment.id, status: 'processed' });
  } catch (error) {
    console.error(`Settlement Processing Failure: ${error.message}`);
    res.status(500).json({ error: 'Failed to balance settlement matrix.' });
  }
});

// Asynchronous Webhook tracking for automated external clearing alerts
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`⚠️ Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Monitor credit notes and customer balance activities for clearing telemetry
  if (event.type === 'credit_note.created' || event.type === 'customer.balance_transaction.created') {
    const dataObject = event.data.object;
    
    try {
      await mailTransporter.sendMail({
        from: process.env.OUTLOOK_EMAIL,
        to: process.env.RECONCILIATION_AUDIT_EMAIL || process.env.OUTLOOK_EMAIL,
        subject: `WE THE MUSCLE LLC - Settlement Matrix Reconciliation Logged`,
        text: `Adjustment token ${dataObject.id} has cleared network validation pipelines. Value entry logged.`
      });
    } catch (mailError) {
      console.error(`Telemetry Dispatch Error: ${mailError.message}`);
    }
  }

  res.json({ received: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Settlement and Reconciliation Engine Online on port ${PORT}`));

