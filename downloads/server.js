const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

app.get('/', (req, res) => {
    res.send('WTM Backend Gateway is Active and Secure.');
});

app.get('/api/transmissions/smartlink', (req, res) => {
    try {
        const { item_id, qty, amount, routing_matrix, transmission_id, tx_type } = req.query;
        if (!routing_matrix) {
            return res.status(400).json({ status: "Rejected", message: "Missing routing_matrix" });
        }
        let calculatedAmount = parseInt(amount) || 0;
        if (tx_type === "debit") calculatedAmount = -Math.abs(calculatedAmount);

        res.status(200).json({ 
            status: "Processed", 
            transaction: { item_id, qty, amount: calculatedAmount, routing_matrix } 
        });
    } catch (error) {
        res.status(400).json({ status: "Rejected", message: error.message });
    }
});

app.listen(10000, () => console.log('WTM Gateway API listening on port 10000'));
