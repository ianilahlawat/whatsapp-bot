const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const axios = require('axios');
const http = require('http');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const pino = require('pino');

let qrCodeData = "";
let isConnected = false;

// Render dynamic PORT
const PORT = process.env.PORT || 3000;

// ==========================================
// 1. Web Server (Render Web Service Health Check & QR Display)
// ==========================================
const server = http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });

    if (isConnected) {
        res.end(`<html><body style="text-align:center;padding-top:50px;font-family:sans-serif;">
            <h2 style="color:green;">✅ WhatsApp Bot Connected & Running!</h2>
            <p>Ab aap WhatsApp par "My dp" bhej kar balance test kar sakte hain.</p>
        </body></html>`);
    } else if (qrCodeData) {
        try {
            const qrImage = await QRCode.toDataURL(qrCodeData);
            res.end(`<html><body style="text-align:center;padding-top:50px;font-family:sans-serif;">
                <h2>Scan WhatsApp QR Code:</h2>
                <img src="${qrImage}" style="width:260px;height:250px;"/>
                <p>Scan karne ke 5-10 seconds baad page reload karein.</p>
            </body></html>`);
        } catch (err) {
            res.end("QR Render Error: " + err.message);
        }
    } else {
        res.end(`<html><body style="text-align:center;padding-top:50px;font-family:sans-serif;">
            <h2>Initializing Bot & Connecting to WhatsApp...</h2>
            <p>Please refresh in 5 seconds.</p>
            <script>setTimeout(() => { location.reload(); }, 5000);</script>
        </body></html>`);
    }
});

server.listen(PORT, () => {
    console.log(`Web Server listening on port ${PORT}`);
});

// ==========================================
// 2. Main Baileys WhatsApp Engine
// ==========================================
async function startBot() {
    try {
        const authPath = path.join(__dirname, 'auth_info');
        if (!fs.existsSync(authPath)) {
            fs.mkdirSync(authPath, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            browser: ["Windows", "Chrome", "122.0.0.0"]
        });

        sock.ev.on('creds.update', saveCreds);

        // Connection State Update Listener
        sock.ev.on('connection.update', (update) => {
            const { connection, qr, lastDisconnect } = update;

            if (qr) {
                qrCodeData = qr;
                isConnected = false;
                console.log("New QR Code Generated!");
            }

            if (connection === 'close') {
                isConnected = false;
                qrCodeData = "";
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log(`Connection Closed. Status Code: ${statusCode}`);
                
                const shouldReconnect = (statusCode !== DisconnectReason?.loggedOut);
                if (shouldReconnect) {
                    setTimeout(startBot, 3000);
                }
            } else if (connection === 'open') {
                isConnected = true;
                qrCodeData = "";
                console.log('✅ Connected to WhatsApp!');
            }
        });

        // ==========================================
        // 3. WhatsApp Message Event Listener
        // ==========================================
        sock.ev.on('messages.upsert', async ({ messages }) => {
            const msg = messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const textMessage = (
                msg.message.conversation || 
                msg.message.extendedTextMessage?.text || 
                ""
            ).trim();

            // Match 'my dp' or 'my dp 9876543210'
            if (textMessage.toLowerCase().startsWith('my dp')) {
                const remoteJid = msg.key.remoteJid;
                
                // Extract unique WhatsApp Identifier (LID or Phone JID string)
                const lidId = (msg.key.participant || remoteJid || "").split('@')[0].replace(/[^0-9]/g, '');

                // Extract typed mobile number if user sent: "My dp 8338087582"
                const parts = textMessage.split(/\s+/);
                let userTypedNumber = "";
                if (parts.length >= 3) {
                    userTypedNumber = parts[2].replace(/[^0-9]/g, '').slice(-10);
                }

                console.log(`Processing Request - LID/JID ID: ${lidId} | Typed Mobile: ${userTypedNumber}`);

                try {
                    // API Call to cPanel PHP endpoint
                    const apiUrl = `https://khata.biggurgaon.com/get_balance.php?mobile=${userTypedNumber}&lid=${lidId}`;
                    const response = await axios.get(apiUrl);

                    if (response.data.status === 'success') {
                        const replyText = `Hello *${response.data.name}*,\n\nAapka current Khata Balance: *₹${response.data.balance.toFixed(2)}* hai.`;
                        await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
                    } else {
                        // Helpful instruction when LID is not mapped yet
                        const notFoundText = `Aapka WhatsApp account abhi Khata record se linked nahi hai.\n\n` +
                            `Kripya ek baar apna registered mobile number aise bhej kar link karein:\n\n` +
                            `*My dp [Mobile Number]*\n\n` +
                            `*Example:* My dp 9876543210`;
                        
                        await sock.sendMessage(remoteJid, { text: notFoundText }, { quoted: msg });
                    }
                } catch (error) {
                    console.error("API Fetch Error:", error.message);
                    await sock.sendMessage(remoteJid, { 
                        text: "Server error occurred. Kripya thodi der baad try karein." 
                    }, { quoted: msg });
                }
            }
        });

    } catch (err) {
        console.error("Bot Start Error:", err.message);
        setTimeout(startBot, 5000);
    }
}

startBot();
