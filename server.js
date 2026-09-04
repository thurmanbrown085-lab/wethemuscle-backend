// Add this at the absolute top of server.js
require('dotenv').config();

const express = require('express');
const app = express();

// Automatically pulls the key your terminal configured in the .env file
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

app.use(express.static(__dirname));
app.use(express.json());

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
