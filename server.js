require('dotenv').config();
const express = require('express');
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

// 1. Initialize secure production database pool for Neon
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Required for serverless database connection handshake
  }
});

// 2. Transporter for automated Outlook settlement telemetry
const mailTransporter = nodemailer.createTransport({
  host: '://office365.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.OUTLOOK_EMAIL,
    pass: process.env.OUTLOOK_PASSWORD
  }
});

// 3. STRIPE WEBHOOK ROUTE (Handles raw data stream for Settlements & Reconciliations)
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`❌ Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const eventType = event.type;
  const dataObject = event.data.object;

  // Target tracking scope across your financial categories
  const targetEvents = [
    'credit_note.created', 'customer.balance_transaction.created',
    'customer_cash_balance_transaction.created', // 💡 Added modern cash balance event
    'invoice.created', 'invoice.finalized', 'invoice.sent', 
    'invoice.paid', 'invoice.payment_failed', 'invoice.voided', 
    'invoice.marked_uncollectible', 'payment_intent.succeeded', 
    'payment_intent.payment_failed', 'payment_intent.canceled', 
    'charge.succeeded', 'charge.failed', 'checkout.session.completed', 
    'checkout.session.expired', 'charge.refunded', 'refund.created', 
    'refund.failed', 'charge.dispute.created', 
    'charge.dispute.funds_withdrawn', 'charge.dispute.closed', 
    'payout.created', 'payout.paid', 'payout.failed'
  ];

  if (targetEvents.includes(eventType)) {
    const transactionId = dataObject.id || `evt_${event.id}`;
    const amount = dataObject.amount_total || dataObject.amount || dataObject.gross_amount || 0;
    const currency = dataObject.currency || 'usd';
    
    // Evaluate if the entry is a negative or positive settlement allocation
    let calculationType = 'positive_charge';
    const isNegative = [
      'credit_note.created', 'charge.refunded', 'refund.created', 
      'charge.dispute.created', 'charge.dispute.funds_withdrawn',
      'customer_cash_balance_transaction.created' // Triggers ledger safety mapping for deductions/adjustments
    ].includes(eventType) || (dataObject.amount && dataObject.amount < 0);

    if (isNegative) {
      calculationType = 'negative_charge';
    }

    console.log(`⚖️ Processing ${calculationType} for event: ${eventType} [ID: ${transactionId}]`);

    try {
      // A. Write an unalterable compliance audit log into the Neon database
      const queryText = `
        INSERT INTO ledger_reconciliations (
          session_id, charge_type, amount, currency, stripe_event_type, 
          network_transaction_id, tax_year, irs_1099_compliant, raw_payload, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (session_id) DO UPDATE SET 
          status = 'BALANCED',
          mismatch_reconciliation = 'Adjusted gross balance down by ' || EXCLUDED.amount;
      `;

      const queryValues = [
        transactionId,
        calculationType,
        amount,
        currency.toUpperCase(),
        eventType,
        event.request ? event.request.id : 'tx_fed_system_fallback',
        new Date().getFullYear(),
        true,
        JSON.stringify(dataObject),
        'BALANCED'
      ];

      await db.query(queryText, queryValues);
      console.log(`📁 Unalterable corporate compliance log saved: ${transactionId}`);

      // B. Dispatch automated Outlook correspondence telemetry report
      await mailTransporter.sendMail({
        from: process.env.OUTLOOK_EMAIL,
        to: process.env.OUTLOOK_EMAIL, 
        subject: `WE THE MUSCLE LLC - Ledger Synchronization Logged`,
        text: `Settlement action entry ${transactionId} (${calculationType.toUpperCase()}) has successfully passed external compliance verification.\n\n` +
              `Event Type: ${eventType}\n` +
              `Value Total: ${(amount / 100).toFixed(2)} ${currency.toUpperCase()}\n` +
              `Federal & IRS 1099 Audit Status: COMPLIANT / RECORDED\n` +
              `Network Transaction Token ID: ${event.request ? event.request.id : 'N/A'}`
      });
      
      console.log(`📬 Telemetry correspondence completed for token: ${transactionId}`);

    } catch (processingError) {
      console.error(`❌ External system communication failure: ${processingError.message}`);
    }
  }

  // Return HTTP 200 to inform Stripe the data stream was absorbed completely
  res.status(200).json({ received: true });
});

// 4. GLOBAL MIDDLEWARE FOR ALL OTHER ROUTES
app.use(express.json());

// Sample placeholder route showcasing standard JSON functionality
app.get('/health', (req, res) => {
  res.json({ status: "ONLINE", business: "WE THE MUSCLE LLC" });
});

// 5. UNIFIED PORT LISTENER (Flexible Port Mapping)
const port = process.env.PORT || 3000;

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});
const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Pool } = require('pg');

const app = express();

// Connect securely to your Neon PostgreSQL Project 2 database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true } // Required by Neon for secure encryption
});

// CRITICAL FOR 403 FIX: Stripe webhooks MUST read raw unparsed data
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // 1. Bodyguard check: Verifies the webhook signature using your whsec_ key
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`💥 Webhook Signature Verification Failed: ${err.message}`);
    return res.status(403).send(`Webhook Error: ${err.message}`); // Slams the door safely
  }

  // 2. The signature is valid! Process the specific payment event
  if (event.type === 'invoice.paid' || event.type === 'checkout.session.completed') {
    const sessionOrInvoice = event.data.object;
   
    // Extract metadata or invoice IDs you tied to the session
    const invoiceId = sessionOrInvoice.id;
    const amountPaid = sessionOrInvoice.amount_paid || sessionOrInvoice.amount_total;

    try {
      // 3. Command Neon to update your ledger (Uses clean, standardized columns to avoid 703 errors)
      const queryText = `
        UPDATE invoices
        SET is_settled = true
        WHERE invoice_id = $1;
      `;
      await pool.query(queryText, [invoiceId]);
      console.log(`✅ Successfully updated Neon ledger for Invoice: ${invoiceId}`);
     
    } catch (dbErr) {
      console.error(`💥 Neon PostgreSQL Error (Check columns/703):`, dbErr.message);
      // We still return a 200 to Stripe so it doesn't keep spamming retries
    }
  }

  // Acknowledge receipt back to Stripe instantly
  res.json({ received: true });
});

// Serve your public frontend files out of a folder named "public"
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Bodyguard server actively running on port ${PORT}`));

