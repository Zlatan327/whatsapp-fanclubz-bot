const { logMessage, logInvite, getInviteLogs, hasIntroLog, getInviteLeaderboard, addBettingSub, removeBettingSub, getBettingSubs } = require('./database');

// ─── URL regex to detect links ──────────────────────────────────────────────
const URL_REGEX = /https?:\/\/[^\s]+|www\.[^\s]+/i;

// ─── Group Rules ─────────────────────────────────────────────────────────────
const GROUP_RULES = `📋 *Group Rules*

1️⃣  *Respect Everyone* — No insults, personal attacks, or hate speech.
2️⃣  *No Spam* — No repeated messages, chain messages, or self-promotion.
3️⃣  *No Links Without Permission* — Links from non-admins are auto-deleted.
4️⃣  *Stay On Topic* — Keep conversations relevant to the group purpose.
5️⃣  *No NSFW Content* — No explicit, violent, or disturbing media.
6️⃣  *English Only* — Use English so everyone can follow the conversation.
7️⃣  *No Impersonation* — Don't pretend to be someone you're not.
8️⃣  *Listen to Admins* — Admin decisions are final.
9️⃣  *No Doxxing* — Never share someone's personal info without consent.
🔟  *Have Fun!* — Be friendly and enjoy the community.

_Violations may result in a warning, mute, kick, or ban._
_Type /help to see available bot commands._`;

// ─── Help text ───────────────────────────────────────────────────────────────
const HELP_TEXT = `🤖 *Bot Commands*

/rules — Show group rules
/everyone — Tag all group members
/intro @user — Register who invited you
/odds_on — Subscribe to betting notifications (e.g. SportyBet codes)
/odds_off — Unsubscribe from betting notifications
/kick @user — Kick a member (admin only)
/ban @user — Ban a member (admin only)
/invites — Show recent invite/join log
/leaderboard — Show top inviters in the group
/commands — Show this help message
/help — Show this help message`;

/**
 * Check if the message sender is a group admin.
 */
const isAdmin = (chat, senderId) => {
    const participant = chat.participants.find(p => p.id._serialized === senderId);
    return participant && (participant.isAdmin || participant.isSuperAdmin);
};

/**
 * Check if a text message is likely a SportyBet or betting booking code.
 * Looking for context clues (sporty/odds/bet/code/booking) + 6-10 character alphanumeric string.
 */
const isBettingCode = (text) => {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    
    // Some common keywords associated with betting codes
    const keywords = ['sporty', 'code', 'odds', 'booking', 'bet', 'stake'];
    const hasKeyword = keywords.some(kw => lowerText.includes(kw));

    // A code is typically 6-10 letters/numbers mixed. (e.g., BC8E12F or 6A3CDE4)
    // We look for words that have a mix of letters and numbers or uppercase words.
    // The following regex checks for 5 to 10 alphanumeric characters.
    const codeRegex = /\\b[A-Za-z0-9]{5,10}\\b/;
    
    // If it's a very short message (just the code) or has keywords
    if (text.length <= 15 && codeRegex.test(text)) {
        return true;
    }
    
    // If it has keywords and a matching code
    if (hasKeyword && codeRegex.test(text)) {
        return true;
    }

    return false;
};

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

    // ─── SportyBet Code Detection ─────────────────────────────────────────
    if (isBettingCode(msg.body)) {
        const subs = getBettingSubs(chat.id._serialized);
        
        // Exclude the sender themselves
        const taggedSubs = subs.filter(sub => sub !== msg.from);

        if (taggedSubs.length > 0) {
            let text = '🎲 *Betting Code Detected!* \nTagging interested members:\n\n';
            const mentions = [];
            
            for (const subId of taggedSubs) {
                try {
                    const contact = await chat.client.getContactById(subId);
                    mentions.push(contact);
                    text += `@${subId.split('@')[0]} `;
                } catch (err) {
                     console.error(`Could not fetch contact ${subId}: ${err.message}`);
                }
            }
            
            await msg.reply(text, chat.id._serialized, { mentions });
        }
    }

    // ─── Auto-delete links from non-admins ───────────────────────────────
    // We do this after betting code detection in case a link also happens to be a sportybet link.
    if (URL_REGEX.test(msg.body) && !isAdmin(chat, msg.from)) {
        try {
            await msg.delete(true); // delete for everyone
            await chat.sendMessage(`⚠️ @${msg.from.split('@')[0]} — Links are not allowed from non-admin members.`, {
                mentions: [await msg.getContact()]
            });
        } catch (err) {
            console.error('Error deleting link message:', err.message);
        }
        return;
    }

    // ─── Command: /rules ─────────────────────────────────────────────────
    if (msg.body === '/rules') {
        await msg.reply(GROUP_RULES);
        return;
    }

    // ─── Command: /help or /commands ─────────────────────────────────────
    if (msg.body === '/help' || msg.body === '/commands') {
        await msg.reply(HELP_TEXT);
        return;
    }

    // ─── Command: /everyone ──────────────────────────────────────────────
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

    // ─── Command: /intro @user ────────────────────────────────────────────
    if (msg.body.startsWith('/intro')) {
        const mentionedContacts = await msg.getMentions();
        if (mentionedContacts.length === 0) {
            await msg.reply('ℹ️ Usage: /intro @person — tag the person who invited you to this group.\n\nExample: "/intro @John" means John invited you.');
            return;
        }

        const inviter = mentionedContacts[0];

        // 1. Prevent multiple intros
        if (hasIntroLog(msg.from, chat.id._serialized)) {
            await msg.reply('🚫 You have already registered who invited you!');
            return;
        }

        // 2. Check if the tagged person is actually in the group
        const isParticipant = chat.participants.find(p => p.id._serialized === inviter.id._serialized);
        if (!isParticipant) {
             await msg.reply(`🚫 The person you tagged (@${inviter.id.user}) is not currently in this group.`);
             return;
        }

        const senderContact = await msg.getContact();
        const senderName = senderContact.pushname || msg.from.split('@')[0];
        const inviterName = inviter.pushname || inviter.id.user;

        // Log retroactive invite
        logInvite(msg.from, chat.id._serialized, chat.name, inviter.id._serialized, 'intro');

        await chat.sendMessage(
            `📝 Noted! *${senderName}* was invited by *${inviterName}* @${inviter.id.user}`,
            { mentions: [inviter] }
        );
        return;
    }

    // ─── Command: /odds_on ───────────────────────────────────────────────
    if (msg.body === '/odds_on') {
        addBettingSub(msg.from, chat.id._serialized);
        await msg.reply('✅ You are now subscribed! I will tag you whenever someone drops a betting code or odds.');
        return;
    }

    // ─── Command: /odds_off ──────────────────────────────────────────────
    if (msg.body === '/odds_off') {
        removeBettingSub(msg.from, chat.id._serialized);
        await msg.reply('🚫 You have been unsubscribed from betting notification tags.');
        return;
    }

    // ─── Command: /kick @user ────────────────────────────────────────────
    if (msg.body.startsWith('/kick')) {
        if (!isAdmin(chat, msg.from)) {
            await msg.reply('🚫 Only admins can use /kick.');
            return;
        }

        const mentionedContacts = await msg.getMentions();
        if (mentionedContacts.length === 0) {
            await msg.reply('ℹ️ Usage: /kick @user — mention the person you want to kick.');
            return;
        }

        for (const contact of mentionedContacts) {
            try {
                await chat.removeParticipants([contact.id._serialized]);
                logInvite(contact.id._serialized, chat.id._serialized, chat.name, msg.from, 'kicked');
                await chat.sendMessage(`🦵 @${contact.id.user} has been kicked by an admin.`, {
                    mentions: [contact]
                });
            } catch (err) {
                console.error(`Error kicking ${contact.id.user}:`, err.message);
                await msg.reply(`❌ Could not kick @${contact.id.user}. Make sure the bot is an admin.`);
            }
        }
        return;
    }

    // ─── Command: /ban @user ─────────────────────────────────────────────
    if (msg.body.startsWith('/ban')) {
        if (!isAdmin(chat, msg.from)) {
            await msg.reply('🚫 Only admins can use /ban.');
            return;
        }

        const mentionedContacts = await msg.getMentions();
        if (mentionedContacts.length === 0) {
            await msg.reply('ℹ️ Usage: /ban @user — mention the person you want to ban.');
            return;
        }

        for (const contact of mentionedContacts) {
            try {
                await chat.removeParticipants([contact.id._serialized]);
                logInvite(contact.id._serialized, chat.id._serialized, chat.name, msg.from, 'banned');
                await chat.sendMessage(`🔨 @${contact.id.user} has been banned by an admin.`, {
                    mentions: [contact]
                });
            } catch (err) {
                console.error(`Error banning ${contact.id.user}:`, err.message);
                await msg.reply(`❌ Could not ban @${contact.id.user}. Make sure the bot is an admin.`);
            }
        }
        return;
    }

    // ─── Command: /invites ───────────────────────────────────────────────
    if (msg.body === '/invites') {
        const logs = getInviteLogs(chat.id._serialized, 20);
        if (logs.length === 0) {
            await msg.reply('📭 No invite/join activity recorded yet.\n\nTip: Ask members to type "/intro @person" to register who invited them!');
            return;
        }

        let text = '📊 *Group Invite History*\n\n';
        for (const log of logs) {
            let userName = log.userId.split('@')[0];
            let inviterName = log.invitedBy !== 'unknown' ? log.invitedBy.split('@')[0] : 'invite link';

            try {
                const userContact = await chat.client.getContactById(log.userId);
                if (userContact && (userContact.pushname || userContact.name)) {
                    userName = userContact.pushname || userContact.name;
                }
            } catch (err) {}

            try {
                if (log.invitedBy !== 'unknown') {
                    const inviterContact = await chat.client.getContactById(log.invitedBy);
                    if (inviterContact && (inviterContact.pushname || inviterContact.name)) {
                        inviterName = inviterContact.pushname || inviterContact.name;
                    }
                }
            } catch (err) {}

            let emoji;
            switch (log.action) {
                case 'join':   emoji = '➡️'; break;
                case 'intro':  emoji = '📝'; break;
                case 'kicked': emoji = '🦵'; break;
                case 'banned': emoji = '🔨'; break;
                case 'left':   emoji = '⬅️'; break;
                default:       emoji = '❓';
            }
            text += `${emoji} *${userName}* — ${log.action} (by ${inviterName}) — ${log.timestamp}\n`;
        }
        await msg.reply(text);
        return;
    }

    // ─── Command: /leaderboard ───────────────────────────────────────────
    if (msg.body === '/leaderboard') {
        try {
            console.log(`[DEBUG] Fetching leaderboard for group: ${chat.id._serialized}`);
            const leaders = getInviteLeaderboard(chat.id._serialized, 10);
            console.log(`[DEBUG] Leaderboard data:`, leaders);

            if (leaders.length === 0) {
                await msg.reply('🏆 No invite data recorded yet.\n\nAsk members to type "/intro @person" to give credit!');
                return;
            }

            let text = '🏆 *Top Inviters Leaderboard*\n\n';
            for (let i = 0; i < leaders.length; i++) {
                const leader = leaders[i];
                let inviterName = leader.invitedBy.split('@')[0];

                try {
                    const contact = await chat.client.getContactById(leader.invitedBy);
                    if (contact && (contact.pushname || contact.name)) {
                        inviterName = contact.pushname || contact.name;
                    }
                } catch (err) {
                    console.error(`[DEBUG] Could not fetch contact for leaderboard: ${leader.invitedBy}`);
                }

                let medal = '🏅';
                if (i === 0) medal = '🥇';
                if (i === 1) medal = '🥈';
                if (i === 2) medal = '🥉';

                text += `${medal} *${inviterName}* — ${leader.count} invites\n`;
            }
            await msg.reply(text);
        } catch (err) {
            console.error('[ERROR] Leaderboard command failed:', err);
            await msg.reply('❌ An error occurred while generating the leaderboard.');
        }
        return;
    }
};

/**
 * Handle group membership changes (join/leave).
 */
const handleGroupJoin = async (notification) => {
    try {
        const chat = await notification.getChat();
        if (!chat.isGroup) return;

        // recipientIds = who joined, author = who added them
        const joinedUsers = notification.recipientIds || [];
        const inviter = notification.author || 'unknown';

        for (const userId of joinedUsers) {
            logInvite(userId, chat.id._serialized, chat.name, inviter, 'join');
            const userNumber = userId.split('@')[0];
            const inviterNumber = inviter !== 'unknown' ? inviter.split('@')[0] : 'invite link';
            console.log(`📥 ${userNumber} joined "${chat.name}" (invited by ${inviterNumber})`);
        }
    } catch (err) {
        console.error('Error handling group join:', err.message);
    }
};

/**
 * Handle group membership leave events.
 */
const handleGroupLeave = async (notification) => {
    try {
        const chat = await notification.getChat();
        if (!chat.isGroup) return;

        const leftUsers = notification.recipientIds || [];
        for (const userId of leftUsers) {
            logInvite(userId, chat.id._serialized, chat.name, notification.author || 'self', 'left');
            const userNumber = userId.split('@')[0];
            console.log(`📤 ${userNumber} left "${chat.name}"`);
        }
    } catch (err) {
        console.error('Error handling group leave:', err.message);
    }
};

module.exports = { handleMessage, handleGroupJoin, handleGroupLeave };
