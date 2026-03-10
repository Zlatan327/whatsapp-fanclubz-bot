require('dotenv').config();
const http = require('http');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const { handleMessage, handleGroupJoin, handleGroupLeave } = require('./messageHandler');
const { initDb, close: closeDb } = require('./database');

// ─── State for QR code ───────────────────────────────────────────────────────
let latestQrDataUrl = null;
let botReady = false;

// ─── WhatsApp Client ─────────────────────────────────────────────────────────
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined),
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// On QR — generate data URL and serve via HTTP
client.on('qr', async (qr) => {
    qrTerminal.generate(qr, { small: true });
    latestQrDataUrl = await QRCode.toDataURL(qr, { width: 400 });
    console.log('\n🔐 QR code ready! Open http://localhost:4588 in your browser to scan.\n');
});

client.on('ready', () => {
    botReady = true;
    latestQrDataUrl = null;
    console.log('✅ Client is ready! The bot is now running.\n');
    console.log('Commands: /rules · /everyone · /kick · /ban · /invites · /help\n');
});

client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failed:', msg);
    process.exit(1);
});

client.on('disconnected', (reason) => {
    console.log('🔌 Client disconnected:', reason);
    botReady = false;
});

client.on('message_create', async (msg) => {
    if (msg.fromMe) return;
    await handleMessage(msg);
});

client.on('group_join', async (notification) => {
    await handleGroupJoin(notification);
});

client.on('group_leave', async (notification) => {
    await handleGroupLeave(notification);
});

// ─── Local HTTP server to display QR code ────────────────────────────────────
const QR_PORT = process.env.PORT || 4588;

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });

    if (botReady) {
        res.end(`<!DOCTYPE html>
<html><head><title>WhatsApp Bot</title>
<meta http-equiv="refresh" content="5">
<style>
  body { background: #0b141a; color: #e9edef; font-family: 'Segoe UI', sans-serif;
         display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { background: #1f2c34; border-radius: 16px; padding: 48px; text-align: center; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
  h1 { color: #25D366; font-size: 28px; margin-bottom: 8px; }
  p { color: #8696a0; font-size: 16px; }
</style></head><body>
<div class="card">
  <h1>✅ Bot Connected!</h1>
  <p>Your WhatsApp bot is running. You can close this page.</p>
</div></body></html>`);
    } else if (latestQrDataUrl) {
        res.end(`<!DOCTYPE html>
<html><head><title>WhatsApp Bot — Scan QR</title>
<meta http-equiv="refresh" content="3">
<style>
  body { background: #0b141a; color: #e9edef; font-family: 'Segoe UI', sans-serif;
         display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { background: #1f2c34; border-radius: 16px; padding: 48px; text-align: center; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
  h1 { color: #25D366; font-size: 24px; margin-bottom: 4px; }
  p { color: #8696a0; font-size: 14px; margin-bottom: 24px; }
  img { border-radius: 12px; background: white; padding: 16px; }
  .steps { text-align: left; color: #8696a0; font-size: 14px; line-height: 2; margin-top: 24px; }
  .steps b { color: #e9edef; }
</style></head><body>
<div class="card">
  <h1>🔐 WhatsApp Bot</h1>
  <p>Scan this QR code to link your account</p>
  <img src="${latestQrDataUrl}" alt="QR Code" width="300" height="300" />
  <div class="steps">
    <b>1.</b> Open WhatsApp on your phone<br>
    <b>2.</b> Go to Settings → Linked Devices<br>
    <b>3.</b> Tap "Link a Device"<br>
    <b>4.</b> Point your camera at this QR code
  </div>
</div></body></html>`);
    } else {
        res.end(`<!DOCTYPE html>
<html><head><title>WhatsApp Bot — Loading</title>
<meta http-equiv="refresh" content="2">
<style>
  body { background: #0b141a; color: #e9edef; font-family: 'Segoe UI', sans-serif;
         display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { background: #1f2c34; border-radius: 16px; padding: 48px; text-align: center; box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
  h1 { color: #25D366; }
  p { color: #8696a0; }
  .spinner { border: 4px solid #1f2c34; border-top: 4px solid #25D366; border-radius: 50%;
             width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 24px auto; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style></head><body>
<div class="card">
  <h1>⏳ Starting Bot...</h1>
  <div class="spinner"></div>
  <p>Waiting for QR code. This page refreshes automatically.</p>
</div></body></html>`);
    }
});

server.listen(QR_PORT, () => {
    console.log(`🌐 QR code viewer running at http://localhost:${QR_PORT}`);
});

// ─── Graceful shutdown ───────────────────────────────────────────────────────
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    server.close();
    await client.destroy();
    closeDb();
    process.exit(0);
});

// ─── Start ───────────────────────────────────────────────────────────────────
(async () => {
    try {
        await initDb();
        console.log('🚀 Starting WhatsApp bot...');
        client.initialize();
    } catch (err) {
        console.error('Failed to start:', err);
        process.exit(1);
    }
})();
