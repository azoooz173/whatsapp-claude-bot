'use strict';
const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { systemPrompt, greeting, greetingEn } = require('./scripts/persona');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// رقم المالك (بدون + وبدون 00)
const OWNER_NUMBER = '966565111150';

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: systemPrompt,
    generationConfig: {
          maxOutputTokens: 1024,
          temperature: 0.7
    }
});

// Conversation memory: phone number -> array of {role, parts:[{text}]}
// Gemini expects role: 'user' | 'model' (NOT 'assistant')
const conversationHistory = new Map();
const MAX_HISTORY = 20;

async function sendWhatsAppMessage(to, text) {
    try {
          await axios.post(
                  'https://graph.facebook.com/v20.0/' + PHONE_NUMBER_ID + '/messages',
            {
                      messaging_product: 'whatsapp',
                      to,
                      type: 'text',
                      text: { body: text }
            },
            {
                      headers: {
                                  Authorization: 'Bearer ' + WHATSAPP_TOKEN,
                                  'Content-Type': 'application/json'
                      }
            }
                );
    } catch (err) {
          console.error('[WhatsApp] Error:', err.response?.data || err.message);
    }
}

async function getGeminiReply(senderNumber, userMessage) {
    if (!conversationHistory.has(senderNumber))
          conversationHistory.set(senderNumber, []);
    const history = conversationHistory.get(senderNumber);

  try {
        // startChat() takes the prior history; the new user message is sent via sendMessage()
      const chat = model.startChat({ history: [...history] });
        const result = await chat.sendMessage(userMessage);
        const assistantText = result.response.text();

      // Persist the new turn (only after a successful call, to avoid orphaned 'user' entries)
      history.push({ role: 'user', parts: [{ text: userMessage }] });
        history.push({ role: 'model', parts: [{ text: assistantText }] });
        while (history.length > MAX_HISTORY) history.shift();

      return assistantText;
  } catch (err) {
        console.error('[Gemini] Error:', err.message);
        return 'Sorry, a temporary error occurred. Please try again.';
  }
}

// يتحقق إذا كانت الرسالة أمر إرسال من المالك
// الصيغة: "أرسل لـ 0501234567: نص الرسالة"
function parseOwnerSendCommand(text) {
    const match = text.match(/^أرسل\s+لـ?\s*([\d]+)\s*:\s*(.+)$/s);
    if (!match) return null;
    let number = match[1].trim();
    const message = match[2].trim();
    // تحويل الرقم المحلي إلى دولي (966)
  if (number.startsWith('0')) {
        number = '966' + number.slice(1);
  }
    return { to: number, message };
}

app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
          res.status(200).send(challenge);
    } else {
          res.sendStatus(403);
    }
});

app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    try {
          const body = req.body;
          if (body.object !== 'whatsapp_business_account') return;
          for (const entry of body.entry || []) {
                  for (const change of entry.changes || []) {
                            const value = change.value;
                            if (!value || !value.messages) continue;
                            for (const msg of value.messages) {
                                        if (msg.type !== 'text') continue;
                                        const senderNumber = msg.from;
                                        const messageText = msg.text.body;
                                        console.log('[Incoming] From ' + senderNumber + ': ' + messageText);

                              // تحقق إذا المرسل هو المالك وأرسل أمر إرسال
                              if (senderNumber === OWNER_NUMBER) {
                                            const cmd = parseOwnerSendCommand(messageText);
                                            if (cmd) {
                                                            console.log('[Owner CMD] Send to ' + cmd.to + ': ' + cmd.message);
                                                            await sendWhatsAppMessage(cmd.to, cmd.message);
                                                            await sendWhatsAppMessage(OWNER_NUMBER, 'تم الإرسال إلى ' + cmd.to + ' بنجاح ✅');
                                                            continue;
                                            }
                              }

                              const reply = await getGeminiReply(senderNumber, messageText);
                                        await sendWhatsAppMessage(senderNumber, reply);
                            }
                  }
          }
    } catch (err) {
          console.error('[Webhook] Error:', err.message);
    }
});

app.get('/', (req, res) => {
    res.json({
          status: 'running',
          service: 'Manaret Al-Adel WhatsApp Bot',
          model: 'gemini-2.5-flash'
    });
});

app.listen(PORT, () => console.log('[Server] Bot running on port ' + PORT));
