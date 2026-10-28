const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

// Serves the front-end visual management dashboard interface
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Automated Smartlink payload serialization and URL query parameter routing path
app.get('/api/transmissions/smartlink', (req, res) => {
    try {
        const { item_id, qty, amount, routing_matrix, transmission_id, tx_type } = req.query;

        if (!routing_matrix) {
            return res.status(400).json({ 
                status: "Rejected", 
                message: "Missing required routing_matrix code parameter." 
            });
        }

        // Adjust ledger calculation balance format based on negative push/debit reconciliation rules
        let calculatedAmount = parseInt(amount) || 0;
        const transactionType = tx_type || "settlement"; // Defaults to settlement structure

        if (transactionType === "debit" || transactionType === "reconciliation") {
            // Forces negative transaction entry value to record outbound settlement push alignment
            calculatedAmount = -Math.abs(calculatedAmount);
        }

        console.log(`[SMARTLINK PAYLOAD RECEIVED] Type: ${transactionType}, Amount: ${calculatedAmount}, Routing Matrix: ${routing_matrix}`);

        // Format data into standard transaction structure
        const normalizedPayload = {
            pipelineType: req.query.pipelineType || "Software",
            transmission_id: transmission_id || `TLK-${Date.now()}`,
            routing_matrix: routing_matrix,
            amount: calculatedAmount,
            transactionType: transactionType,
            data: { item_id, qty }
        };

        res.status(200).json({ 
            status: "Processed", 
            message: "Payload successfully serialized and processed.",
            transaction: normalizedPayload 
        });
    } catch (error) {
        console.error(`[SMARTLINK REJECTED] ${error.message}`);
        res.status(400).json({ status: "Rejected", message: error.message });
    }
});

app.listen(10000, () => console.log('WTM Gateway API listening on port 10000'));
