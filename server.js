require('dotenv').config();
const express = require('express');
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Pool } = require('pg');
const nodemailer = require('nodemailer');

// 1. Initialize production database pool
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // Required for production clouds like Render/Neon
});

// 2. Transporter for automated Outlook correspondence
const mailTransporter = nodemailer.createTransport({
  host: '://office365.com',
  port: 587,
  secure: false, // TLS requirements
  auth: {
    user: process.env.OUTLOOK_EMAIL,
    pass: process.env.OUTLOOK_PASSWORD
  }
});

// 3. Conditional body parsing middleware (Preserves raw formats for webhooks)
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') {
    next();
  } else {
    express.json()(req, res, next);
  }
});

// 4. Secure live checkout execution route
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { amount, description, customerEmail } = req.body;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'B2B Agreement Financing', description: description },
          unit_amount: amount * 100 // Convert to cents
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: customerEmail,
      success_url: `${process.env.DOMAIN || 'http://localhost:3000'}/success`,
      cancel_url: `${process.env.DOMAIN || 'http://localhost:3000'}/cancel`,
    });
    res.json({ url: session.url });
  } catch (error) {
    console.error(`Checkout Session Error: ${error.message}`);
    res.status(500).json({ error: 'Failed to initiate secure payment routing.' });
  }
});

// 5. Asynchronous Stripe webhook reception endpoint
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`⚠️ Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle transaction payloads securely
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    
    try {
      // Record transaction into your ledger tables
      await db.query(
        'INSERT INTO transactions(stripe_id, amount, status, email) VALUES($1, $2, $3, $4)',
        [session.id, session.amount_total, session.payment_status, session.customer_details.email]
      );
      
      // Dispatch automated B2B telemetry notifications via Outlook
      await mailTransporter.sendMail({
        from: process.env.OUTLOOK_EMAIL,
        to: session.customer_details.email,
        subject: 'WE THE MUSCLE LLC - Execution Status Confirmed',
        text: `Your transaction of $${(session.amount_total / 100).toFixed(2)} has successfully processed. Your records are archived.`
      });
      console.log(` Ledger finalized and confirmation email sent for session: ${session.id}`);
    } catch (dbError) {
      console.error(`Ledger/Email Execution Error: ${dbError.message}`);
    }
  }

  res.json({ received: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Unified engine active on local port ${PORT}`));

