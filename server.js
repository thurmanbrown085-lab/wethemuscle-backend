// 1. Load hidden environment configurations at the absolute top
require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const app = express();

// 2. Automatically pulls the key configured in your .env file
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// 3. Initialize secure database pool connection for Neon
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

app.use(express.static(__dirname));
app.use(express.json());

// 4. Automated Transmission Type Detector
function detectTransmissionType(inputString) {
  const cleanInput = inputString.replace(/[\s-]/g, '');

  const debitCardRegex = /^\d{13,16}$/;
  const routingNumberRegex = /^\d{9}$/;
  const bankAccountRegex = /^\d{4,17}$/;

  if (debitCardRegex.test(cleanInput)) {
    return { type: 'debit_card', value: cleanInput };
  } else if (routingNumberRegex.test(cleanInput)) {
    return { type: 'routing_number', value: cleanInput };
  } else if (bankAccountRegex.test(cleanInput)) {
    return { type: 'account_number', value: cleanInput };
  } else {
    return { type: 'unknown', value: cleanInput };
  }
}

// Main checkout route
app.post('/create-payment-intent', async (req, res) => {
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 2000, // Amount in cents ($20.00)
      currency: 'usd',
    });
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Pulls the port configured by your terminal environment, defaulting to 3000
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Secure server running on port ${port}`));
