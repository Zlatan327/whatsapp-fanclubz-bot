require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { handleMessage } = require('./messageHandler');
const { close: closeDb } = require('./database');

const client = new Client({
    authStrategy: new LocalAuth()
});

// Display QR code in terminal for authentication
client.on('qr', (qr) => {
    console.log('\n🔐 Scan this QR code with your WhatsApp app:\n');
    qrcode.generate(qr, { small: true });
});

// Confirmation when the client is ready
client.on('ready', () => {
    console.log('✅ Client is ready! The bot is now running.\n');
});

// Handle authentication failure
client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failed:', msg);
    process.exit(1);
});

// Handle disconnection
client.on('disconnected', (reason) => {
    console.log('🔌 Client disconnected:', reason);
});

// Listen for all messages (including ones sent by the bot)
// We filter out bot's own messages to avoid infinite loops
client.on('message_create', async (msg) => {
    // Skip messages sent by the bot itself
    if (msg.fromMe) return;
    await handleMessage(msg);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    await client.destroy();
    closeDb();
    process.exit(0);
});

// Start the client
console.log('🚀 Starting WhatsApp bot...');
client.initialize();
