'use strict';

const express = require('express');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const conversationHistory = new Map();
const MAX_HISTORY = 20;

const SYSTEM_PROMPT = 'You are a helpful assistant for Manaret Al-Adel plumbing supplies company in Jeddah, Saudi Arabia. Reply in the customer language (Arabic or English).';

async function sendWhatsAppMessage(to, text) {
  try {
    await axios.post(
      'https://graph.facebook.com/v20.0/' + PHONE_NUMBER_ID + '/messages',
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
      { headers: { Authorization: 'Bearer ' + WHATSAPP_TOKEN, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[WhatsApp] Error:', err.response?.data || err.message);
  }
}

async function getClaudeReply(senderNumber, userMessage) {
  if (!conversationHistory.has(senderNumber)) conversationHistory.set(senderNumber, []);
  const history = conversationHistory.get(senderNumber);
  history.push({ role: 'user', content: userMessage });
  while (history.length > MAX_HISTORY) history.shift();
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: history
    });
    const assistantText = response.content[0].text;
    history.push({ role: 'assistant', content: assistantText });
    return assistantText;
  } catch (err) {
    console.error('[Claude] Error:', err.message);
    return 'Sorry, a temporary error occurred. Please try again.';
  }
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
          const reply = await getClaudeReply(senderNumber, messageText);
          await sendWhatsAppMessage(senderNumber, reply);
        }
      }
    }
  } catch (err) {
    console.error('[Webhook] Error:', err.message);
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'running', service: 'Manaret Al-Adel WhatsApp Bot', model: 'claude-sonnet-4-5' });
});

app.listen(PORT, () => console.log('[Server] Bot running on port ' + PORT));
