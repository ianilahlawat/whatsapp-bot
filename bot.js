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

// Smart Phone Number Extractor (Searches Full Message Payload for Real Number)
function extractRealNumber(msg) {
    try {
        const fullMsgStr = JSON.stringify(msg);
        
        // Search for any @s.whatsapp.net JID inside the message structure
        const matches = fullMsgStr.match(/(\d{10,12})@s\.whatsapp\.net/g);
        
        if (matches && matches.length > 0) {
            for (let match of matches) {
                let clean = match.split('@')[0].replace(/[^0-9]/g, '');
                let tenDigit = clean.length > 10 ? clean.slice(-10) : clean;
                
                // Exclude bot's own number or invalid length
                if (tenDigit.length === 10) {
                    return tenDigit;
                }
            }
        }

        // Fallback to JID fields
        let fallbackJid = msg.key.participantAlt || msg.key.remoteJidAlt || msg.key.participant || msg.key.remoteJid || "";
        let cleanFallback = fallbackJid.split('@')[0].replace(/[^0-9]/g, '');
        return cleanFallback.length > 10 ? cleanFallback.slice(-10) : cleanFallback;
    } catch (e) {
        console.error("Extraction error:", e);
        return "";
    }
}

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
            browser: ["Windows", "Chrome", "122.0.0.0"]
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
                const mobileNumber = extractRealNumber(msg);

                console.log(`[DEBUG] Raw RemoteJid: ${remoteJid}`);
                console.log(`[DEBUG] Extracted 10-Digit Mobile: ${mobileNumber}`);

                try {
                    // Hits your cPanel PHP Endpoint
                    const apiUrl = `https://khata.biggurgaon.com/get_balance.php?mobile=${mobileNumber}`;
                    const response = await axios.get(apiUrl);

                    if (response.data.status === 'success') {
                        const replyText = `Hello *${response.data.name}*,\n\nAapka current Khata Balance: *₹${response.data.balance.toFixed(2)}* hai.`;
                        await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
                    } else {
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
