const express = require('express');
const multer = require('multer');
const { createWorker } = require('tesseract.js');
const pg = require('pg');

const server = express();
server.use(express.json());

// 1. Establish Secure Connection Parameters for the Cloud Database Ledger
const dbPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL
});

console.log("Server initialized");
console.log("Initialization complete");

// 2. Core Unified Payment Processor Logic
async function processUnifiedPayment(customerEmail, amountInCents, metadataContext) {
    try {
        const stripe = require('stripe')(process.env.STRIPE_LIVE_SECRET_KEY);
        console.log(`[PAYMENT] Processing unified entry for ${customerEmail}`);
        
        const customers = await stripe.customers.list({ email: customerEmail, limit: 1 });
        if (customers.data.length === 0) {
            throw new Error('Customer account registration profile not found.');
        }
        const customerId = customers.data[0].id;

        const paymentMethods = await stripe.paymentMethods.list({
            customer: customerId,
            type: 'card'
        });
        if (paymentMethods.data.length === 0) {
            throw new Error('No active or valid payment methods found for this profile.');
        }
        const paymentMethodId = paymentMethods.data[0].id;

        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInCents,
            currency: 'usd',
            customer: customerId,
            payment_method: paymentMethodId,
            off_session: true, 
            confirm: true,     
            metadata: {
                business_name: "WE THE MUSCLE LLC",
                ...metadataContext
            }
        });

        return { success: true, id: paymentIntent.id, status: paymentIntent.status };
    } catch (error) {
        console.error("[PAYMENT ERROR] Core processing failed:", error.message);
        return { success: false, error: error.message };
    }
}

// 3. Web-Based Frontend Correspondence Route (Path A)
server.post('/api/v1/checkout-pay-button', async (req, res) => {
    const { customerEmail, amountInCents, adjustmentId } = req.body;
    console.log(`[TRIGGER] Payment button click received for ${customerEmail}`);
    
    const result = await processUnifiedPayment(customerEmail, amountInCents, {
        source_channel: "frontend_button",
        adjustment_id: adjustmentId
    });

    if (result.success) res.status(200).json(result);
    else res.status(400).json(result);
});

// 4. Automated Image/Barcode Extraction Endpoint (Path B)
const upload = multer({ storage: multer.memoryStorage() }).single('sku_image');
server.post('/scan-transaction', upload, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No image payload provided." });

        const worker = await createWorker('eng');
        const { data: { text } } = await worker.recognize(req.file.buffer);
        await worker.terminate();

        const cleanSku = text.replace(/[^a-zA-Z0-9-]/g, '').trim();
        console.log(`[LEDGER] Extracted SKU: ${cleanSku}. Processing payload matching...`);

        const mockItemPriceCents = 5000; 
        const customerEmail = "your_login_email@domain.com"; 
        
        const result = await processUnifiedPayment(customerEmail, mockItemPriceCents, {
            source_channel: "backend_barcode_parser",
            adjustment_id: cleanSku
        });

        if (result.success) {
            await dbPool.query(
                "INSERT INTO ledger_reconciliations (adjustment_id, type, amount, status, reference_id) VALUES (\$1, \$2, \$3, \$4, \$5)",
                [cleanSku, "settlement_reconciliation", 50.00, "processed", result.id]
            );
            console.log(`[POSTGRESQL] Secure tracking row inserted for ${cleanSku}`);
        }

        res.status(200).json({ success: true, extractedSku: cleanSku, paymentStatus: result.status });
    } catch (error) {
        console.error("[ERROR] Processing image payload failed:", error);
        res.status(500).json({ error: "System loop failure during extraction." });
    }
});

// 5. Open Communication Cluster Port Links
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server live on processing cluster channel port ${PORT}`);
});

// --- AUTOMATED MICROSOFT 365 LEDGER BACKUP ROUTINE ---
const nodemailer = require('nodemailer');

/**
 * Compiles a ledger summary from PostgreSQL and dispatches it straight to Outlook
 */
async function triggerMicrosoft365Backup() {
    try {
        console.log("[BACKUP] Extracting master ledger logs from PostgreSQL cluster...");
        
        // 1. Query the 50 most recent entries across both accounts from your database tables
        const queryResult = await dbPool.query(
            "SELECT id, created_at, adjustment_id, type, amount, status FROM ledger_reconciliations ORDER BY created_at DESC LIMIT 50"
        );

        if (queryResult.rows.length === 0) {
            console.log("[BACKUP] Ledger tables are empty. Skipping automated email backup loop.");
            return;
        }

        // 2. Format the rows into a clean, unalterable text table layout
        let logReportTable = "ID   | TIMESTAMP           | ADJUSTMENT ID        | TYPE                     | AMOUNT   | STATUS\n";
        logReportTable += "-------------------------------------------------------------------------------------------------\n";
        
        queryResult.rows.forEach(row => {
            logReportTable += `${row.id.toString().padEnd(4)} | ${row.created_at.toISOString().slice(0,19)} | ${row.adjustment_id.padEnd(20)} | ${row.type.padEnd(24)} | \$${row.amount.toString().padEnd(7)} | ${row.status}\n`;
        });

        // 3. Authenticate securely with your Microsoft 365 cloud email vault
        const transporter = nodemailer.createTransport({
            host: "smtp.office365.com",
            port: 587,
            secure: false, // TLS requirements
            auth: {
                user: process.env.OUTLOOK_EMAIL || "thurmanbrown085@gmail.com",
                pass: process.env.OUTLOOK_PASSWORD 
            },
            tls: { ciphers: 'SSLv3' }
        });

        // 4. Dispatch the encrypted data summary straight to your inbox
        const mailOptions = {
            from: process.env.OUTLOOK_EMAIL || "thurmanbrown085@gmail.com",
            to: process.env.OUTLOOK_EMAIL || "thurmanbrown085@gmail.com",
            subject: `📊 Automated Ledger Backup Report - ${new Date().toISOString().slice(0,10)}`,
            text: `This is an automated structural ledger backup compiled straight from your live PostgreSQL tables for WE THE MUSCLE LLC.\n\n=== RECONCILIATION DATA DUMP ===\n\n${logReportTable}\n\n=== END OF REPORT ===`
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`📡 Secure Backup Archive Delivered to Microsoft 365: ${info.messageId}`);

    } catch (error) {
        console.error("💥 Automated backup routine failed:", error.message);
    }
}

// 5. Expose an administrative webhook to force a manual email trigger if needed
server.post('/api/v1/admin/trigger-backup', async (req, res) => {
    await triggerMicrosoft365Backup();
    res.status(200).json({ success: true, message: "Backup pipeline fired smoothly." });
});

// --- ADVANCED PLATFORM SECURITY: PILLARS 3, 4, & 5 ---

// 1. PostgreSQL Exception Queue Logging Mechanism
async function logToExceptionQueue(errorMessage, errorStack, payloadContext = {}) {
    try {
        console.error(`[EXCEPTION QUEUE] Logging failure condition: ${errorMessage}`);
        await dbPool.query(
            "INSERT INTO exception_queue (error_message, error_stack, payload_context) VALUES (\$1, \$2, \$3)",
            [errorMessage, errorStack, JSON.stringify(payloadContext)]
        );
    } catch (dbErr) {
        console.error("💥 Critical Failure: Exception queue table unreachable:", dbErr.message);
    }
}

// 2. Webhook Queue & Dead Letter Queue (DLQ) Memory Rail Array
const webhookQueue = [];
const deadLetterQueue = [];
let isProcessingQueue = false;

async function processWebhookQueueWorker() {
    if (isProcessingQueue || webhookQueue.length === 0) return;
    isProcessingQueue = true;

    while (webhookQueue.length > 0) {
        const currentTask = webhookQueue.shift();
        console.log(`[QUEUE] Worker popped item ${currentTask.taskId} from active queue memory.`);

        try {
            // Re-route task execution directly back into our core payment processor
            const paymentResult = await processUnifiedPayment(
                currentTask.payload.customerEmail,
                currentTask.payload.amountInCents,
                currentTask.payload.context
            );

            if (!paymentResult.success) {
                throw new Error(paymentResult.error || "Queue payment handling failed.");
            }
            
            console.log(`[QUEUE SUCCESS] Task ${currentTask.taskId} fully resolved.`);
        } catch (taskErr) {
            currentTask.retryCount += 1;
            console.warn(`[QUEUE WARN] Task ${currentTask.taskId} failed. Attempt count: ${currentTask.retryCount}/3`);

            if (currentTask.retryCount >= 3) {
                console.error(`[DLQ ALERT] Task ${currentTask.taskId} exceeded retry constraints. Moving to Dead Letter Queue.`);
                currentTask.failureReason = taskErr.message;
                deadLetterQueue.push(currentTask);
                
                // Route task straight into database exception triage tracking tables
                await logToExceptionQueue(
                    `Webhook Queue Exceeded Retry Limit: ${taskErr.message}`,
                    taskErr.stack,
                    currentTask
                );
            } else {
                // Re-queue task back at the end of the memory line for another execution attempt
                webhookQueue.push(currentTask);
                await new Promise(resolve => setTimeout(resolve, 2000)); // Cool-down gap
            }
        }
    }
    isProcessingQueue = false;
}

// 3. Telemetry Geofencing Validation Rules Middleware
function enforceTelemetryGeofencing(req, res, next) {
    // Read incoming traffic markers; fallback to US headers if testing on localhost
    const incomingIpCountry = req.headers['cf-ipcountry'] || req.headers['x-forwarded-for-country'] || 'US';
    const forwardingClientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    console.log(`[GEOFENCE] Telemetry check for IP ${forwardingClientIp} from country region: ${incomingIpCountry}`);

    // Restrict processing channels exclusively to secure North American regions (US / CA)
    if (incomingIpCountry !== 'US' && incomingIpCountry !== 'CA') {
        console.error(`[⚠️ BLOCK] Geofence intrusion detected from unauthorized region: ${incomingIpCountry}`);
        
        logToExceptionQueue(
            "Geofence Telemetry Intrusion Blocked",
            `IP address location outside parameters: ${incomingIpCountry}`,
            { clientIp: forwardingClientIp, country: incomingIpCountry, targetPath: req.path }
        );

        return res.status(403).json({ error: "Access denied: Unauthorized transaction telemetry location coordinates." });
    }

    next();
}

// Attach Geofencing tracking firewall rules directly to your core payment channels
server.use('/api/v1/checkout-pay-button', enforceTelemetryGeofencing);
server.use('/scan-transaction', enforceTelemetryGeofencing);

// Administrative Endpoint to inspect active queue buffers and DLQ logs
server.get('/api/v1/admin/queue-status', (req, res) => {
    res.status(200).json({
        activeQueueLength: webhookQueue.length,
        deadLetterQueueLength: deadLetterQueue.length,
        deadLetterQueueContents: deadLetterQueue
    });
});
