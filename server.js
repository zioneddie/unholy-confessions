const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Health check endpoint (keeps pinger happy)
app.get('/', (req, res) => {
  res.send('Unholy Confessions API is live ✠');
});

// Confession submission endpoint
app.post('/api/confessions', async (req, res) => {
  const { confession, category, consent } = req.body;

  if (!confession || confession.length < 10) {
    return res.status(400).json({ success: false, error: 'Confession is too short.' });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.error('Missing Telegram environment variables on server.');
    return res.status(500).json({ success: false, error: 'Server configuration error.' });
  }

  const messageText = `🚨 NEW UNHOLY CONFESSION\n\nCategory: ${category || 'General'}\n\nConfession:\n"${confession}"`;

  try {
    const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: messageText
      })
    });

    const data = await telegramResponse.json();

    if (data.ok) {
      return res.json({ success: true });
    } else {
      console.error('Telegram API Error:', data);
      return res.status(500).json({ success: false, error: data.description || 'Telegram rejection' });
    }
  } catch (err) {
    console.error('Fetch error connecting to Telegram:', err);
    return res.status(500).json({ success: false, error: 'Failed to reach Telegram' });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Unholy Confessions API running on port ${PORT}`);
});

