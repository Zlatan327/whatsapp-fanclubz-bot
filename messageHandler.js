const { logMessage } = require('./database');

// Default rules if GROUP_RULES is not set in .env
const DEFAULT_RULES = '1. Be respectful to all members.\n2. No spamming or self-promotion.\n3. Keep conversations on topic and constructive.';

/**
 * Handle incoming messages from WhatsApp.
 * Logs all group messages and processes commands.
 */
const handleMessage = async (msg) => {
    const chat = await msg.getChat();

    // Only process group chat messages
    if (!chat.isGroup) return;

    // Log every group message to the database
    logMessage(msg.id._serialized, msg.from, chat.name, msg.body);

    // --- Command: /rules ---
    if (msg.body === '/rules') {
        const rulesText = process.env.GROUP_RULES || DEFAULT_RULES;
        // Replace literal \n from .env with actual newlines
        const formatted = rulesText.replace(/\\n/g, '\n');
        await msg.reply(`📋 *Group Rules:*\n\n${formatted}`);
        return;
    }

    // --- Command: /everyone ---
    if (msg.body === '/everyone') {
        try {
            let text = '📢 *Attention everyone!*\n\n';
            const mentions = [];

            for (const participant of chat.participants) {
                try {
                    const contact = await chat.client.getContactById(participant.id._serialized);
                    mentions.push(contact);
                    text += `@${participant.id.user} `;
                } catch (err) {
                    console.error(`Could not fetch contact ${participant.id.user}:`, err.message);
                }
            }

            await chat.sendMessage(text, { mentions });
        } catch (err) {
            console.error('Error in /everyone command:', err.message);
            await msg.reply('❌ Sorry, could not tag everyone. Please try again.');
        }
        return;
    }
};

module.exports = { handleMessage };
