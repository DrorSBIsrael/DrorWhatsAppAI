const express = require('express');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(express.json());

// ========================================
// הגדרות - יגיעו מ-Environment Variables
// ========================================
const GREEN_API_ID = process.env.GREEN_API_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;

// רשימה לבנה - מספרים מורשים
const WHITELIST = process.env.WHITELIST ? process.env.WHITELIST.split(',').map(n => n.trim()) : [];

// 🆕 רשימה שחורה - מספרים חסומים (הבוט לא יענה להם!)
const BLACKLIST = process.env.BLACKLIST ? process.env.BLACKLIST.split(',').map(n => n.trim()) : [];

// 🆕 מצב עונה לכולם
const REPLY_TO_ALL = process.env.REPLY_TO_ALL === 'true';

// 🆕 שם שלך (ייכנס לפרומפט)
const YOUR_NAME = process.env.YOUR_NAME || 'דרור פרינץ';

// 🆕 מידע עליך ועל העסק (זה מה שיגרום לבוט לענות כמוך!)
const YOUR_PERSONALITY = process.env.YOUR_PERSONALITY || `
אתה ${YOUR_NAME}, מנהל של חברת לציוד אוטומטטי בחניונים.
אתה עונה ללקוחות בצורה ידידותית ומקצועית.
אתה תמיד עוזר ומנסה לפתור בעיות.
אתה מדבר בעברית בסגנון פשוט וישיר.
`;

// זיכרון שיחות (בזיכרון זמני - ייאבד אם השרת נכבה)
// בגרסה מתקדמת נשמור במסד נתונים
const conversationMemory = {};

// נתיב לקובץ זיכרון (לשמירה קבועה)
const MEMORY_FILE = path.join(__dirname, 'conversation_memory.json');

console.log('🚀 השרת מתחיל...');
console.log('📋 רשימה לבנה:', WHITELIST.length, 'מספרים');
console.log('🚫 רשימה שחורה:', BLACKLIST.length, 'מספרים');
console.log('👥 קבוצות: מתעלם מקבוצות - רק הודעות פרטיות ✅');
console.log('🌍 מצב עונה לכולם:', REPLY_TO_ALL ? 'מופעל ✅' : 'כבוי ❌');
console.log('👤 השם שלך:', YOUR_NAME);

// ========================================
// טעינת זיכרון מקובץ (בהפעלה)
// ========================================
async function loadMemory() {
  try {
    const data = await fs.readFile(MEMORY_FILE, 'utf8');
    const loaded = JSON.parse(data);
    Object.assign(conversationMemory, loaded);
    console.log('💾 זיכרון נטען:', Object.keys(conversationMemory).length, 'שיחות');
  } catch (error) {
    console.log('💾 אין זיכרון קודם - מתחיל מחדש');
  }
}

// ========================================
// שמירת זיכרון לקובץ
// ========================================
async function saveMemory() {
  try {
    await fs.writeFile(MEMORY_FILE, JSON.stringify(conversationMemory, null, 2));
    console.log('💾 זיכרון נשמר');
  } catch (error) {
    console.error('❌ שגיאה בשמירת זיכרון:', error.message);
  }
}

// טען זיכרון בהפעלה
loadMemory();

// ========================================
// בדיקת חיבור
// ========================================
app.get('/', (req, res) => {
  const mode = REPLY_TO_ALL ? 'עונה לכולם 🌍' : `רק רשימה לבנה (${WHITELIST.length} מספרים)`;
  res.send(`✅ WhatsApp AI Bot של ${YOUR_NAME} פועל! מצב: ${mode}`);
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    whitelist: WHITELIST.length,
    blacklist: BLACKLIST.length,
    replyToAll: REPLY_TO_ALL,
    conversationsInMemory: Object.keys(conversationMemory).length
  });
});

// ========================================
// קבלת שם איש קשר מ-Green API
// ========================================
async function getContactName(phoneNumber) {
  try {
    const response = await axios.get(
      `https://api.green-api.com/waInstance${GREEN_API_ID}/getContactInfo/${GREEN_API_TOKEN}`,
      {
        params: {
          chatId: `${phoneNumber}@c.us`
        }
      }
    );
    
    if (response.data && response.data.name) {
      return response.data.name;
    }
  } catch (error) {
    console.log('⚠️ לא הצלחתי לקבל שם איש קשר:', error.message);
  }
  return null;
}

// ========================================
// קבלת היסטוריית צ'אט מ-Green API (אופציונלי)
// ========================================
async function getChatHistory(phoneNumber, count = 10) {
  try {
    const response = await axios.post(
      `https://api.green-api.com/waInstance${GREEN_API_ID}/getChatHistory/${GREEN_API_TOKEN}`,
      {
        chatId: `${phoneNumber}@c.us`,
        count: count
      }
    );
    
    if (response.data && Array.isArray(response.data)) {
      return response.data;
    }
  } catch (error) {
    console.log('⚠️ לא הצלחתי לקבל היסטוריית צ\'אט:', error.message);
  }
  return [];
}

// ========================================
// קבלת הודעות מ-WhatsApp (Webhook)
// ========================================
app.post('/webhook', async (req, res) => {
  try {
    console.log('📩 הודעה חדשה התקבלה');

    // בודק שזה אירוע של הודעה נכנסת
    if (req.body.typeWebhook !== 'incomingMessageReceived') {
      return res.sendStatus(200);
    }

    const messageData = req.body.messageData;
    
    // בודק שזו הודעת טקסט
    if (messageData.typeMessage !== 'textMessage' && messageData.typeMessage !== 'extendedTextMessage') {
      return res.sendStatus(200);
    }

    const senderNumber = req.body.senderData.sender.replace('@c.us', '').replace('@g.us', '');
    const messageText = messageData.textMessageData?.textMessage || messageData.extendedTextMessageData?.text || '';
    
    // ========================================
    // בדיקה שזה לא קבוצה (רק הודעות פרטיות!)
    // ========================================
    const isGroup = req.body.senderData.sender.includes('@g.us');
    if (isGroup) {
      console.log(`👥 הודעה מקבוצה - מתעלם!`);
      return res.sendStatus(200);
    }

    console.log(`📱 מספר שולח: ${senderNumber}`);
    console.log(`💬 הודעה: ${messageText}`);

    // ========================================
    // בדיקת רשימה שחורה (עדיפות ראשונה!)
    // ========================================
    if (BLACKLIST.includes(senderNumber)) {
      console.log(`🚫 מספר ${senderNumber} ברשימה השחורה - מתעלם!`);
      return res.sendStatus(200);
    }

    // ========================================
    // בדיקת רשימה לבנה (אם REPLY_TO_ALL כבוי)
    // ========================================
    if (!REPLY_TO_ALL && !WHITELIST.includes(senderNumber)) {
      console.log(`❌ מספר ${senderNumber} לא ברשימה הלבנה - מתעלם`);
      return res.sendStatus(200);
    }

    // ========================================
    // קבלת שם איש קשר
    // ========================================
    let contactName = await getContactName(senderNumber);
    if (contactName) {
      console.log(`👤 שם איש קשר: ${contactName}`);
    }

    // ========================================
    // טיפול בזיכרון שיחות
    // ========================================
    if (!conversationMemory[senderNumber]) {
      conversationMemory[senderNumber] = {
        contactName: contactName,
        messages: [],
        firstContact: new Date().toISOString(),
        lastContact: new Date().toISOString()
      };
      console.log(`🆕 שיחה חדשה עם ${contactName || senderNumber}`);
    } else {
      conversationMemory[senderNumber].lastContact = new Date().toISOString();
      if (contactName && !conversationMemory[senderNumber].contactName) {
        conversationMemory[senderNumber].contactName = contactName;
      }
    }

    // הוסף את ההודעה של המשתמש לזיכרון
    conversationMemory[senderNumber].messages.push({
      role: 'user',
      content: messageText,
      timestamp: new Date().toISOString()
    });

    // שמור רק 20 הודעות אחרונות (כדי לא להעמיס על Claude)
    if (conversationMemory[senderNumber].messages.length > 20) {
      conversationMemory[senderNumber].messages = conversationMemory[senderNumber].messages.slice(-20);
    }

    // ========================================
    // הכנת הפרומפט ל-Claude
    // ========================================
    const systemPrompt = `${YOUR_PERSONALITY}

חשוב מאוד: 
- אתה לא בוט! אתה ${YOUR_NAME} אישית.
- אל תגיד "אני בוט" או "אני עוזר AI" - אתה ${YOUR_NAME}!
- אל תתנצל שאתה לא יכול לעשות דברים - תמיד תנסה לעזור כמו שאתה באמת היית עושה.
- דבר בסגנון טבעי וידידותי, כמו שאתה מדבר בחיים האמיתיים.
${contactName ? `- אתה מדבר עם ${contactName}.` : ''}

היסטוריית השיחה עם ${contactName || 'הלקוח הזה'}:
${conversationMemory[senderNumber].messages.slice(-10).map(m => 
  `${m.role === 'user' ? contactName || 'לקוח' : YOUR_NAME}: ${m.content}`
).join('\n')}`;

    // הודעות ל-Claude (רק הודעות אחרונות)
    const messagesToSend = conversationMemory[senderNumber].messages.slice(-10);

    console.log(`🤖 שולח ל-Claude AI עם ${messagesToSend.length} הודעות בהקשר`);

    // ========================================
    // שליחה ל-Claude AI
    // ========================================
    const aiResponse = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messagesToSend.map(m => ({
          role: m.role,
          content: m.content
        }))
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
    console.log(`💭 תשובת ${YOUR_NAME}: ${aiAnswer}`);

    // שמור את התשובה בזיכרון
    conversationMemory[senderNumber].messages.push({
      role: 'assistant',
      content: aiAnswer,
      timestamp: new Date().toISOString()
    });

    // שמור זיכרון לקובץ (אסינכרוני - לא מחכה)
    saveMemory().catch(err => console.error('שגיאה בשמירה:', err));

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
// API נוסף - צפייה בזיכרון (לבדיקות)
// ========================================
app.get('/memory', (req, res) => {
  const summary = {};
  for (const [phone, data] of Object.entries(conversationMemory)) {
    summary[phone] = {
      contactName: data.contactName,
      messageCount: data.messages.length,
      firstContact: data.firstContact,
      lastContact: data.lastContact
    };
  }
  res.json(summary);
});

// ========================================
// API למחיקת זיכרון של מספר מסוים
// ========================================
app.delete('/memory/:phone', async (req, res) => {
  const phone = req.params.phone;
  if (conversationMemory[phone]) {
    delete conversationMemory[phone];
    await saveMemory();
    res.json({ success: true, message: `זיכרון של ${phone} נמחק` });
  } else {
    res.json({ success: false, message: 'מספר לא נמצא בזיכרון' });
  }
});

// ========================================
// שמירת זיכרון כל 5 דקות
// ========================================
setInterval(() => {
  saveMemory().catch(err => console.error('שגיאה בשמירה אוטומטית:', err));
}, 5 * 60 * 1000); // 5 דקות

// ========================================
// הפעלת השרת
// ========================================
app.listen(PORT, () => {
  console.log(`✅ השרת פועל על פורט ${PORT}`);
  console.log(`🌐 Webhook URL: https://your-app.onrender.com/webhook`);
  if (REPLY_TO_ALL) {
    console.log(`🌍 מצב: עונה לכולם (מלבד ${BLACKLIST.length} מספרים חסומים)`);
  } else {
    console.log(`📋 מצב: רק רשימה לבנה (${WHITELIST.length} מספרים)`);
  }
  console.log(`💾 שיחות בזיכרון: ${Object.keys(conversationMemory).length}`);
});
