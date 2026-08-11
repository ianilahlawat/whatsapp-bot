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

const PORT = process.env.PORT || 3000;

// Web Server for Browser QR View
const server = http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });

    if (isConnected) {
        res.end(`<html><body style="text-align:center;padding-top:50px;font-family:sans-serif;">
            <h2 style="color:green;">✅ WhatsApp Bot Connected & Running!</h2>
            <p>Ab aap WhatsApp par "My Dp" bhej kar test kar sakte hain.</p>
        </body></html>`);
    } else if (qrCodeData) {
        try {
            const qrImage = await QRCode.toDataURL(qrCodeData);
            res.end(`<html><body style="text-align:center;padding-top:50px;font-family:sans-serif;">
                <h2>Scan WhatsApp QR Code:</h2>
                <img src="${qrImage}" style="width:260px;height:250px;"/>
                <p>Scan karne ke baad 5-10 seconds me page reload karein.</p>
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

// Baileys WhatsApp Engine
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
            browser: ["Ubuntu", "Chrome", "20.0.04"]
        });

        sock.ev.on('creds.update', saveCreds);

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

        // WhatsApp Message Listener
       sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const textMessage = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

    if (textMessage.toLowerCase() === 'my dp') {
        const remoteJid = msg.key.remoteJid;
        
        // Extract ONLY last 10 digits (E.g. "919876543210@s.whatsapp.net" -> "9876543210")
        let rawNumber = remoteJid.split('@')[0];
        let mobileNumber = rawNumber.replace(/[^0-9]/g, '').slice(-10);

        try {
            // Aapka exact cPanel API Endpoint
            const apiUrl = `https://khata.biggurgaon.com/get_balance.php?mobile=${mobileNumber}`;
            const response = await axios.get(apiUrl);

            if (response.data.status === 'success') {
                const replyText = `Hello *${response.data.name}*,\n\nAapka current Khata Balance: *₹${response.data.balance.toFixed(2)}* hai.`;
                await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
            } else {
                // Number print karwa rahe hain debug ke liye
                await sock.sendMessage(remoteJid, { 
                    text: `Aapka mobile number (*${mobileNumber}*) Khata record me nahi mila.` 
                }, { quoted: msg });
            }
        } catch (error) {
            console.error("API Call Error:", error.message);
        }
    }
});

    } catch (err) {
        console.error("Bot Start Error:", err.message);
        setTimeout(startBot, 5000);
    }
}

startBot();
