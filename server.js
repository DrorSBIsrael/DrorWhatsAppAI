const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// ========================================
// הגדרות - יגיעו מ-Environment Variables
// ========================================
const GREEN_API_ID = process.env.GREEN_API_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;

// רשימה לבנה - מספרי טלפון מורשים (כולל קידומת מדינה ללא +)
// דוגמה: 972501234567 (ישראל), 12025551234 (ארה"ב)
const WHITELIST = process.env.WHITELIST ? process.env.WHITELIST.split(',') : [];

// 🆕 מצב עונה לכולם - שנה ל-true כדי לענות לכל מי ששולח הודעה
// ב-Environment Variables הוסף: REPLY_TO_ALL=true
const REPLY_TO_ALL = process.env.REPLY_TO_ALL === 'true';

console.log('🚀 השרת מתחיל...');
console.log('📋 רשימה לבנה:', WHITELIST);
console.log('🌍 מצב עונה לכולם:', REPLY_TO_ALL ? 'מופעל ✅' : 'כבוי ❌');

// ========================================
// בדיקת חיבור - Render צריך את זה
// ========================================
app.get('/', (req, res) => {
  const mode = REPLY_TO_ALL ? 'עונה לכולם 🌍' : `רק רשימה לבנה (${WHITELIST.length} מספרים)`;
  res.send(`✅ WhatsApp AI Bot פועל! מצב: ${mode}`);
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    whitelist: WHITELIST.length,
    replyToAll: REPLY_TO_ALL
  });
});

// ========================================
// קבלת הודעות מ-WhatsApp (Webhook)
// ========================================
app.post('/webhook', async (req, res) => {
  try {
    console.log('📩 הודעה חדשה התקבלה:', JSON.stringify(req.body, null, 2));

    // Green API שולח אירועים שונים, אנחנו רוצים רק הודעות טקסט
    if (req.body.typeWebhook !== 'incomingMessageReceived') {
      return res.sendStatus(200);
    }

    const messageData = req.body.messageData;
    
    // בודק שזו הודעת טקסט (לא תמונה/קובץ)
    if (messageData.typeMessage !== 'textMessage' && messageData.typeMessage !== 'extendedTextMessage') {
      return res.sendStatus(200);
    }

    const senderNumber = req.body.senderData.sender.replace('@c.us', ''); // מסיר את הסיומת
    const messageText = messageData.textMessageData?.textMessage || messageData.extendedTextMessageData?.text || '';

    console.log(`📱 מספר שולח: ${senderNumber}`);
    console.log(`💬 תוכן ההודעה: ${messageText}`);

    // ========================================
    // בדיקת רשימה לבנה (רק אם REPLY_TO_ALL כבוי)
    // ========================================
    if (!REPLY_TO_ALL) {
      // מצב רשימה לבנה - בודק אם המספר רשום
      if (!WHITELIST.includes(senderNumber)) {
        console.log(`❌ מספר ${senderNumber} לא ברשימה הלבנה - מתעלם`);
        return res.sendStatus(200);
      }
      console.log(`✅ מספר ${senderNumber} ברשימה הלבנה - שולח ל-AI`);
    } else {
      // מצב עונה לכולם
      console.log(`🌍 מצב עונה לכולם - שולח ל-AI`);
    }

    // ========================================
    // שליחה ל-Claude AI
    // ========================================
    const aiResponse = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: messageText
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      }
    );

    const aiAnswer = aiResponse.data.content[0].text;
    console.log(`🤖 תשובת AI: ${aiAnswer}`);

    // ========================================
    // שליחת תשובה חזרה ל-WhatsApp
    // ========================================
    await axios.post(
      `https://api.green-api.com/waInstance${GREEN_API_ID}/sendMessage/${GREEN_API_TOKEN}`,
      {
        chatId: req.body.senderData.sender,
        message: aiAnswer
      }
    );

    console.log('✅ תשובה נשלחה בהצלחה!');
    res.sendStatus(200);

  } catch (error) {
    console.error('❌ שגיאה:', error.response?.data || error.message);
    res.sendStatus(500);
  }
});

// ========================================
// הפעלת השרת
// ========================================
app.listen(PORT, () => {
  console.log(`✅ השרת פועל על פורט ${PORT}`);
  console.log(`🌐 Webhook URL: https://your-app.onrender.com/webhook`);
  if (REPLY_TO_ALL) {
    console.log(`🌍 מצב: עונה לכולם`);
  } else {
    console.log(`📋 מצב: רק רשימה לבנה (${WHITELIST.length} מספרים)`);
  }
});
