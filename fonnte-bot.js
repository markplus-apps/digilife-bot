// Fonnte bot - webhook receiver + forward to Digilife + send replies

require('dotenv').config({ path: __dirname + '/.env' }); // Load .env file with explicit path
const express = require('express');
const axios = require('axios');

const app = express();

const port = process.env.PORT ? Number(process.env.PORT) : 3010;
const fonnteToken = process.env.FONNTE_TOKEN;
const digiLifeServiceUrl = process.env.DIGILIFE_URL || 'http://localhost:3005/inbound';

if (!fonnteToken) {
    console.error('Missing FONNTE_TOKEN in environment variables.');
    process.exit(1);
}

app.use(express.json({ limit: '50mb' }));

// Webhook endpoint used by Fonnte
app.get('/webhook', (req, res) => {
    res.status(200).json({ ok: true });
});

app.post('/webhook', async (req, res) => {
    const payload = req.body || {};
    console.log('� WEBHOOK HIT at', new Date().toISOString());
    console.log('�📨 Webhook received:', JSON.stringify(payload, null, 2));

    // Basic normalization for common Fonnte fields
    const sender = payload.sender || payload.from || payload.phone || null;
    const name = payload.name || payload.pushName || null;
    const caption = payload.caption || payload.captionText || payload.text_caption || '';
    let text = payload.message || payload.text || caption || '';
    const isGroup = Boolean(payload.group_id || payload.isGroup);
    const messageId = payload.id || payload.message_id || payload.messageId || null;

    if (!sender) {
        return res.status(400).json({ success: false, message: 'Missing sender in webhook payload.' });
    }

    try {
        if (text === 'non-text message' && caption) {
            text = caption;
        }

        const mediaSource = payload.media || payload.file || payload.image || payload.url || payload.image_url || payload.imageUrl || payload.mediaUrl || payload.fileUrl || payload.link || null;

        const forwardPayload = {
            event: 'message',
            timestamp: payload.timestamp || Date.now(),
            messageId: messageId,
            senderJid: sender,
            senderName: name,
            chatJid: isGroup ? payload.group_id : sender,
            isGroup: isGroup,
            text: text || '',
            imageUrl: payload.imageUrl || payload.image_url || payload.url || payload.mediaUrl || null,
            media: mediaSource || null,
            image: payload.image || null,
            url: payload.url || null,
            image_url: payload.image_url || null,
            mediaUrl: payload.mediaUrl || null,
            fileUrl: payload.fileUrl || payload.file || null,
        };

        const response = await axios.post(digiLifeServiceUrl, forwardPayload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 60000,
        });

        res.json({ success: true, forwarded: true, response: response.data });
    } catch (error) {
        console.error('Failed to forward webhook to Digilife:', error.message || error);
        res.status(500).json({ success: false, message: 'Failed to forward to Digilife.' });
    }
});

// API endpoint for Digilife to send replies back to WhatsApp via Fonnte
app.post('/send-message', async (req, res) => {
    const { to, text } = req.body || {};

    if (!to || !text) {
        return res.status(400).json({ success: false, message: 'Missing "to" or "text" in request body.' });
    }

    try {
        const response = await axios.post(
            'https://api.fonnte.com/send',
            { target: to, message: text },
            { headers: { Authorization: fonnteToken } }
        );

        res.json({ success: true, response: response.data });
    } catch (error) {
        console.error('Failed to send via Fonnte:', error.response?.data || error.message || error);
        res.status(500).json({ success: false, message: 'Failed to send message via Fonnte.' });
    }
});

app.get('/health', (req, res) => {
    res.json({ ok: true, service: 'fonnte-bot', time: new Date().toISOString() });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Fonnte bot listening on http://0.0.0.0:${port}`);
    console.log('Webhook endpoint: /webhook');
    console.log('Send endpoint: /send-message');
});
