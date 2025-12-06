const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs').promises; // স্থায়ী ডেটাবেসের জন্য 'fs.promises' ব্যবহার করা হয়েছে

// --- Environment Variables থেকে তথ্য নেওয়া হচ্ছে ---
const TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE'; 
const ADMIN_ID = parseInt(process.env.ADMIN_ID) || 6285540474; 
// ---------------------------------------------

const WEBHOOK_URL = process.env.RENDER_EXTERNAL_URL; 
const PORT = process.env.PORT || 3000; 

const bot = new TelegramBot(TOKEN, { polling: false }); 
const app = express();

// --- ডেটাবেস এবং ম্যাপ ---
// সমস্ত ব্যবহারকারীর স্থায়ী তালিকা (ID -> User Object)
let users = {}; 
// বর্তমান সেশনের রিপ্লাই ট্র্যাক করার জন্য (forwarded_message_id -> original_user_id)
let forwardedMessagesMap = {}; 
// অ্যাডমিন যখন কোনো ইউজারকে বেছে রিপ্লাই শুরু করবেন, তখন সেই ইউজার ID এখানে থাকবে (admin_id -> target_user_id)
let adminReplyTarget = {}; 

const DB_FILE = 'user_db.json';

// --- ডেটাবেস ফাংশন ---

// ফাইল থেকে ডেটা লোড করুন
async function loadData() {
    try {
        const data = await fs.readFile(DB_FILE, 'utf-8');
        users = JSON.parse(data);
        console.log(`Loaded ${Object.keys(users).length} users from DB.`);
    } catch (e) {
        if (e.code === 'ENOENT') {
            // ফাইল না থাকলে খালি অবজেক্ট দিয়ে শুরু করুন
            await fs.writeFile(DB_FILE, JSON.stringify({}));
        } else {
            console.error("Error loading DB:", e.message);
        }
        users = {};
    }
}

// ফাইলে ডেটা সেভ করুন
async function saveUsers() {
    try {
        await fs.writeFile(DB_FILE, JSON.stringify(users, null, 2));
    } catch (e) {
        console.error("Error saving DB:", e.message);
    }
}

// --- সার্ভার এবং Webhook সেটআপ ---

app.use(bodyParser.json());

app.post('/', (req, res) => {
    bot.processUpdate(req.body); 
    res.sendStatus(200); 
});

// --- নতুন ফিচার: ইউজার লিস্ট কমান্ড (/users) ---

bot.onText(/\/users/, async (msg) => {
    const chatId = msg.chat.id;
    if (chatId !== ADMIN_ID) return;

    const userKeys = Object.keys(users);
    if (userKeys.length === 0) {
        return bot.sendMessage(chatId, "বর্তমানে কোনো ব্যবহারকারী নিবন্ধিত নেই।");
    }

    let messageText = "👥 **নিবন্ধিত ব্যবহারকারী তালিকা:**\n\n";
    const buttons = [];

    // প্রতি 5 জন ব্যবহারকারীর জন্য একটি মেসেজ তৈরি করা হলো (যাতে মেসেজ খুব বড় না হয়)
    userKeys.slice(0, 10).forEach(id => {
        const user = users[id];
        messageText += `👤 Name: ${user.name || 'N/A'}\n  ID: \`${user.id}\`\n  Username: ${user.username ? '@' + user.username : 'N/A'}\n---\n`;
        
        // রিপ্লাই বাটন যোগ করা হলো (Callback data-তে user ID পাঠানো হচ্ছে)
        buttons.push([{
            text: `➡️ Reply to ${user.name || user.id}`,
            callback_data: `reply_${user.id}`
        }]);
    });
    
    // বার্তাটি পাঠান
    await bot.sendMessage(chatId, messageText, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: buttons
        }
    });

    if (userKeys.length > 10) {
         await bot.sendMessage(chatId, `আরও ${userKeys.length - 10} জন ব্যবহারকারী আছে, শুধুমাত্র প্রথম 10 জন দেখানো হলো।`);
    }
});


// --- নতুন ফিচার: বাটন ক্লিক হ্যান্ডলিং (Callback Query) ---

bot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const data = callbackQuery.data;
    const chatId = message.chat.id;
    
    // নিশ্চিত করুন যে অ্যাডমিনই ক্লিক করেছেন
    if (chatId !== ADMIN_ID) return;

    if (data.startsWith('reply_')) {
        const targetUserId = data.split('_')[1];
        const targetUser = users[targetUserId];

        if (!targetUser) {
            return bot.sendMessage(chatId, "❌ ব্যবহারকারীর ডেটা খুঁজে পাওয়া যায়নি।");
        }

        // রিপ্লাই টার্গেট সেট করা
        adminReplyTarget[chatId] = targetUserId;
        
        // অ্যাডমিনকে নির্দেশ দেওয়া
        await bot.sendMessage(chatId, 
            `✅ রিপ্লাই শুরু: আপনি এখন **${targetUser.name || targetUserId}**-কে মেসেজ পাঠাচ্ছেন।\n\nপরবর্তী মেসেজটি লিখুন।`
        );
    }
    
    // বাটন ক্লিকের নোটিফিকেশন বন্ধ করুন
    await bot.answerCallbackQuery(callbackQuery.id);
});


// --- প্রধান মেসেজিং লজিক ---

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || '';
    
    if (msg.from.is_bot) return;

    // --- ব্যবহারকারী মেসেজ পাঠালে (নতুন ইউজার সেভ করা) ---
    if (chatId !== ADMIN_ID) {
        
        // যদি ব্যবহারকারী DB তে না থাকে, তবে সেভ করুন
        if (!users[chatId]) {
            users[chatId] = { 
                id: chatId, 
                name: msg.from.first_name, 
                username: msg.from.username, 
                first_message: new Date().toISOString()
            };
            await saveUsers(); // ফাইলে সেভ করুন
        }

        // ... ফরওয়ার্ডিং লজিক ...
        try {
            const userMessageText = msg.text 
                || (msg.caption ? `[MEDIA] Caption: ${msg.caption}` : '[FILE/MEDIA/STICKER] (No text attached)');
            
            const customHeaderBody = `
📌 USER ID: ${chatId}
👤 NAME: ${msg.from.first_name || 'N/A'}
💥 USERNAME : ${msg.from.username ? `@${msg.from.username}` : 'N/A'}

================================

${userMessageText}

================================`; 

            await bot.sendMessage(ADMIN_ID, customHeaderBody, { parse_mode: 'Markdown' });
            const forwardedMsg = await bot.forwardMessage(ADMIN_ID, chatId, msg.message_id);
            forwardedMessagesMap[forwardedMsg.message_id] = chatId;

        } catch (error) {
            console.error("Error processing user message:", error);
        }
        return;
    }

    // --- অ্যাডমিন মেসেজ পাঠালে (রিপ্লাই বা নতুন চ্যাট) ---
    if (chatId === ADMIN_ID) {
        
        // ১. ফরওয়ার্ডেড মেসেজের রিপ্লাই হ্যান্ডলিং
        if (msg.reply_to_message) {
            const repliedToMessageId = msg.reply_to_message.message_id;
            const originalUserId = forwardedMessagesMap[repliedToMessageId];
            
            if (originalUserId) {
                 try {
                    await bot.copyMessage(originalUserId, chatId, msg.message_id);
                    // সাফল্যের বার্তা বন্ধ রাখা হলো
                 } catch (error) {
                    console.error("Error sending reply to user:", error);
                    await bot.sendMessage(chatId, `❌ ব্যবহারকারীকে রিপ্লাই পাঠানো যায়নি। ত্রুটি: ${error.message}`);
                 }
                 return;
            }
        }
        
        // ২. /users কমান্ড থেকে শুরু করা নতুন চ্যাট হ্যান্ডলিং
        const targetUserId = adminReplyTarget[chatId];
        if (targetUserId) {
            try {
                // টার্গেট ইউজারকে মেসেজ কপি করা
                await bot.copyMessage(targetUserId, chatId, msg.message_id);
                await bot.sendMessage(chatId, `✅ নতুন মেসেজ সফলভাবে ইউজার (${targetUserId}) এর কাছে পাঠানো হয়েছে।`);
                // রিপ্লাই সেশন শেষ
                delete adminReplyTarget[chatId]; 
            } catch (error) {
                console.error("Error sending direct message:", error);
                await bot.sendMessage(chatId, `❌ মেসেজ পাঠানো যায়নি। ত্রুটি: ${error.message}`);
            }
        }
    }
});


// --- সার্ভার শুরু করা ---
(async () => {
    // সার্ভার শুরুর আগে ডেটা লোড করুন
    await loadData(); 
    
    app.listen(PORT, async () => {
        console.log(`Server running on port ${PORT}`);
        
        if (WEBHOOK_URL) {
            try {
                await bot.setWebhook(`${WEBHOOK_URL}`); 
                console.log(`Webhook successfully set to: ${WEBHOOK_URL}`);
            } catch (error) {
                console.error('Failed to set webhook:', error.message);
            }
        } else {
             console.warn("RENDER_EXTERNAL_URL not found. Bot running without set webhook.");
        }
    });
})();
