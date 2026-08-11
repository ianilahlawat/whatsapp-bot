sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const textMessage = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

    if (textMessage.toLowerCase().startsWith('my dp')) {
        const remoteJid = msg.key.remoteJid;
        
        // Extract optional mobile number if user typed: "My dp 8338087582"
        const parts = textMessage.split(' ');
        const userTypedNumber = parts.length > 2 ? parts[2].replace(/[^0-9]/g, '') : "";
        const lidId = remoteJid.split('@')[0];

        try {
            const apiUrl = `https://khata.biggurgaon.com/get_balance.php?mobile=${userTypedNumber}&lid=${lidId}`;
            const response = await axios.get(apiUrl);

            if (response.data.status === 'success') {
                const replyText = `Hello *${response.data.name}*,\n\nAapka current Khata Balance: *₹${response.data.balance.toFixed(2)}* hai.`;
                await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
            } else {
                await sock.sendMessage(remoteJid, { 
                    text: `Aapka account verify nahi hai. Kripya ek baar aise message karein:\n\n*My dp [Aapka Mobile Number]*\n\nExample: *My dp ${userTypedNumber || '9876543210'}*` 
                }, { quoted: msg });
            }
        } catch (error) {
            console.error("API Error:", error.message);
        }
    }
});
