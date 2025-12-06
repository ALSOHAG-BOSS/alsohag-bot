const TelegramBot = require('node-telegram-bot-api');

// --- আপনার দেওয়া তথ্য এখানে ---
const TOKEN = '8423536645:AAE1h1zi2-RZnd02vKYRCplXrknL6F6jCjE'; 
const ADMIN_ID = 6285540474; 
// -------------------------

const bot = new TelegramBot(TOKEN, { polling: true });

// key: forwarded_message_id (অ্যাডমিনের চ্যাটে), value: original_user_id
let forwardedMessagesMap = {}; 

console.log("বট চালু হয়েছে এবং ত্রুটিমুক্ত করা হয়েছে।");

// /start কমান্ড হ্যান্ডেল করা
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (chatId === ADMIN_ID) {
        bot.sendMessage(chatId, "আপনি অ্যাডমিন মোডে আছেন।");
    }
});


bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    
    // বট নিজের মেসেজ উপেক্ষা করবে
    if (msg.from.is_bot) return;

    // --- ব্যবহারকারী মেসেজ পাঠালে (অ্যাডমিন নয়) ---
    if (chatId !== ADMIN_ID) {
        try {
            
            // ব্যবহারকারীর মেসেজ থেকে টেক্সট বের করা (মিডিয়া থাকলে ক্যাপশন বা নোট যোগ করা)
            const userMessageText = msg.text 
                || (msg.caption ? `[MEDIA] Caption: ${msg.caption}` : '[FILE/MEDIA/STICKER] (No text attached)');
            
            // ১. অ্যাডমিনের জন্য কাস্টম মেসেজ বডি তৈরি করা (আপনার চাওয়া ফরম্যাট)
            const customHeaderBody = `
📌 USER ID: ${chatId}
👤 NAME: ${msg.from.first_name || 'N/A'}
💥 USERNAME : ${msg.from.username ? `@${msg.from.username}` : 'N/A'}

================================

${userMessageText}

================================`; // নির্দেশমূলক মেসেজটি এখানে বাদ দেওয়া হলো

            // ২. অ্যাডমিনকে কাস্টম ফরম্যাটটি পাঠানো
            await bot.sendMessage(ADMIN_ID, customHeaderBody);
            
            // ৩. মূল মেসেজটি অ্যাডমিনের কাছে ফরওয়ার্ড করা (রিপ্লাই করার জন্য এটি আবশ্যক)
            const forwardedMsg = await bot.forwardMessage(ADMIN_ID, chatId, msg.message_id);
            
            // ৪. রিপ্লাই ট্র্যাক করার জন্য মেসেজ আইডি ম্যাপ করে রাখা
            forwardedMessagesMap[forwardedMsg.message_id] = chatId;

        } catch (error) {
            console.error("Error processing user message:", error);
            // ত্রুটি দেখালে টার্মিনালে দেখাবে
        }
        return;
    }

    // --- অ্যাডমিন রিপ্লাই দিলে ---
    if (chatId === ADMIN_ID && msg.reply_to_message) {
        
        const repliedToMessageId = msg.reply_to_message.message_id;
        const originalUserId = forwardedMessagesMap[repliedToMessageId];

        if (originalUserId) {
            try {
                // অ্যাডমিনের মেসেজটি (টেক্সট, ছবি, বা অন্য মিডিয়া) ব্যবহারকারীর কাছে কপি করা
                await bot.copyMessage(originalUserId, chatId, msg.message_id);
                
                // ***এখানে অ্যাডমিনকে কোনো সফলতার মেসেজ পাঠানো হলো না।***
            
            } catch (error) {
                console.error("Error sending reply to user:", error);
                // ❌ এই লাইনটি SyntaxError এড়াতে নিশ্চিতভাবে সঠিক ব্যাকটিক দিয়ে লেখা
                await bot.sendMessage(chatId, `❌ ব্যবহারকারীকে রিপ্লাই পাঠানো যায়নি। ত্রুটি: ${error.message}`);
            }
        } else {
            // শুধুমাত্র ইউজার ID খুঁজে না পাওয়ার মেসেজটি পাঠানো হলো
            await bot.sendMessage(chatId, "❌ এই মেসেজটি রিপ্লাই করার জন্য ইউজার ID খুঁজে পাওয়া যায়নি।");
        }
    }
});
