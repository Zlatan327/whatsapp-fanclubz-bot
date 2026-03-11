const { 
    logMessage, getActivityLeaderboard,
    logInvite, getInviteLogs, hasIntroLog, getInviteLeaderboard,
    savePrediction, getRecentPredictions, searchPredictions, getPredictionCount
} = require('./database');

// ─── Prediction market domain patterns ───────────────────────────────────────
const PREDICTION_DOMAINS = [
    'fanclubz.app',
];

const URL_REGEX = /https?:\/\/[^\s]+/gi;

/**
 * Check if a URL belongs to a known prediction market platform.
 */
const isPredictionUrl = (url) => {
    const lower = url.toLowerCase();
    return PREDICTION_DOMAINS.some(domain => lower.includes(domain));
};

// ─── Helper: resolve a WhatsApp ID to a display name ─────────────────────────
/**
 * Resolve a WhatsApp user ID (e.g. "2348012345678@c.us") to their display name.
 * Falls back to the phone number only if the contact lookup fails entirely.
 */
const getDisplayName = async (client, userId) => {
    try {
        const contact = await client.getContactById(userId);
        return contact.pushname || contact.name || contact.shortName || userId.split('@')[0];
    } catch {
        return userId.split('@')[0];
    }
};

// ─── Group Rules ─────────────────────────────────────────────────────────────
const GROUP_RULES = `📋 *Group Rules*

1️⃣  *Respect Everyone* — No insults, personal attacks, or hate speech.
2️⃣  *No Spam* — No repeated messages, chain messages, or self-promotion.
3️⃣  *Stay On Topic* — Keep conversations about predictions and markets.
4️⃣  *Share Predictions* — Post prediction links freely! The bot tracks them.
5️⃣  *No NSFW Content* — No explicit, violent, or disturbing media.
6️⃣  *English Only* — Use English so everyone can follow the conversation.
7️⃣  *Listen to Admins* — Admin decisions are final.
8️⃣  *Have Fun!* — Debate the odds and enjoy the community.

_Violations may result in a warning, mute, kick, or ban._
_Type /help to see available bot commands._`;

// ─── Help text ───────────────────────────────────────────────────────────────
const HELP_TEXT = `🤖 *Bot Commands*

📊 *Predictions*
/predictions — Show the 10 most recent prediction links
/find <keyword> — Search saved predictions by keyword
/stats — Show prediction stats for this group

🏆 *Leaderboards & Invites*
/intro @user — Register who invited you
/invites — Show recent invite/join log
/leaderboard — Top inviters leaderboard
/active — Most active members leaderboard

👥 *General*
/rules — Show group rules
/everyone — Tag all group members

🔧 *Admin*
/kick @user — Kick a member (admin only)
/ban @user — Ban a member (admin only)

/help — Show this help message

_ℹ️ The bot automatically detects and saves FanClubz prediction links posted in the group._`;

/**
 * Check if the message sender is a group admin.
 */
const isAdmin = (chat, senderId) => {
    const participant = chat.participants.find(p => p.id._serialized === senderId);
    return participant && (participant.isAdmin || participant.isSuperAdmin);
};

/**
 * Handle incoming messages from WhatsApp.
 */
const handleMessage = async (msg) => {
    const chat = await msg.getChat();

    // Only process group chat messages
    if (!chat.isGroup) return;

    // Log every group message to the database
    logMessage(msg.id._serialized, msg.from, chat.name, msg.body);

    // ─── Auto-detect prediction market links ─────────────────────────────
    const urls = msg.body.match(URL_REGEX) || [];
    const predictionUrls = urls.filter(isPredictionUrl);

    if (predictionUrls.length > 0) {
        let description = msg.body;
        for (const url of predictionUrls) {
            description = description.replace(url, '').trim();
        }

        for (const url of predictionUrls) {
            savePrediction(msg.id._serialized, msg.from, chat.id._serialized, url, description);
        }

        const count = predictionUrls.length;
        const plural = count > 1 ? `${count} predictions` : 'prediction';
        await msg.reply(`✅ Saved ${plural}! Type /predictions or /find <keyword> to look it up.`);
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
                    const name = contact.pushname || contact.name || participant.id.user;
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

        if (hasIntroLog(msg.from, chat.id._serialized)) {
            await msg.reply('🚫 You have already registered who invited you!');
            return;
        }

        const isParticipant = chat.participants.find(p => p.id._serialized === inviter.id._serialized);
        if (!isParticipant) {
            const inviterName = await getDisplayName(chat.client, inviter.id._serialized);
            await msg.reply(`🚫 *${inviterName}* is not currently in this group.`);
            return;
        }

        const senderName = await getDisplayName(chat.client, msg.from);
        const inviterName = await getDisplayName(chat.client, inviter.id._serialized);

        logInvite(msg.from, chat.id._serialized, chat.name, inviter.id._serialized, 'intro');

        await chat.sendMessage(
            `📝 Noted! *${senderName}* was invited by *${inviterName}* @${inviter.id.user}`,
            { mentions: [inviter] }
        );
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
            const userName = await getDisplayName(chat.client, log.userId);
            const inviterName = log.invitedBy !== 'unknown'
                ? await getDisplayName(chat.client, log.invitedBy)
                : 'invite link';

            let emoji;
            switch (log.action) {
                case 'join':   emoji = '➡️'; break;
                case 'intro':  emoji = '📝'; break;
                case 'kicked': emoji = '🦵'; break;
                case 'banned': emoji = '🔨'; break;
                case 'left':   emoji = '⬅️'; break;
                default:       emoji = '❓';
            }
            const date = log.timestamp.split(' ')[0];
            text += `${emoji} *${userName}* — ${log.action} (by ${inviterName}) — ${date}\n`;
        }
        await msg.reply(text);
        return;
    }

    // ─── Command: /leaderboard ───────────────────────────────────────────
    if (msg.body === '/leaderboard') {
        try {
            const leaders = getInviteLeaderboard(chat.id._serialized, 10);

            if (leaders.length === 0) {
                await msg.reply('🏆 No invite data recorded yet.\n\nAsk members to type "/intro @person" to give credit!');
                return;
            }

            let text = '🏆 *Top Inviters Leaderboard*\n\n';
            for (let i = 0; i < leaders.length; i++) {
                const leader = leaders[i];
                const inviterName = await getDisplayName(chat.client, leader.invitedBy);

                let medal = '🏅';
                if (i === 0) medal = '🥇';
                if (i === 1) medal = '🥈';
                if (i === 2) medal = '🥉';

                text += `${medal} *${inviterName}* — ${leader.count} invite${leader.count !== 1 ? 's' : ''}\n`;
            }
            await msg.reply(text);
        } catch (err) {
            console.error('[ERROR] Leaderboard command failed:', err);
            await msg.reply('❌ An error occurred while generating the leaderboard.');
        }
        return;
    }

    // ─── Command: /active — Most messages leaderboard ────────────────────
    if (msg.body === '/active') {
        try {
            const leaders = getActivityLeaderboard(chat.name, 10);

            if (leaders.length === 0) {
                await msg.reply('📊 No activity data yet. Keep chatting!');
                return;
            }

            let text = '🔥 *Most Active Members*\n\n';
            for (let i = 0; i < leaders.length; i++) {
                const leader = leaders[i];
                const name = await getDisplayName(chat.client, leader.sender);

                let medal = '🏅';
                if (i === 0) medal = '🥇';
                if (i === 1) medal = '🥈';
                if (i === 2) medal = '🥉';

                text += `${medal} *${name}* — ${leader.count} message${leader.count !== 1 ? 's' : ''}\n`;
            }
            await msg.reply(text);
        } catch (err) {
            console.error('[ERROR] Activity leaderboard failed:', err);
            await msg.reply('❌ An error occurred while generating the activity leaderboard.');
        }
        return;
    }

    // ─── Command: /predictions ───────────────────────────────────────────
    if (msg.body === '/predictions') {
        const predictions = getRecentPredictions(chat.id._serialized, 10);

        if (predictions.length === 0) {
            await msg.reply('📭 No predictions saved yet.\n\nPost a FanClubz prediction link and I\'ll track it automatically!');
            return;
        }

        let text = '📊 *Recent Predictions*\n\n';
        for (let i = 0; i < predictions.length; i++) {
            const p = predictions[i];
            const name = await getDisplayName(chat.client, p.sender);
            const desc = p.description ? ` — _${p.description.substring(0, 80)}_` : '';
            const date = p.timestamp.split(' ')[0];
            text += `${i + 1}. ${p.url}${desc}\n   📅 ${date} · 👤 ${name}\n\n`;
        }

        await msg.reply(text);
        return;
    }

    // ─── Command: /find <keyword> ────────────────────────────────────────
    if (msg.body.startsWith('/find ')) {
        const query = msg.body.slice(6).trim();

        if (!query) {
            await msg.reply('ℹ️ Usage: /find <keyword>\n\nExample: /find trump\nExample: /find polymarket');
            return;
        }

        const results = searchPredictions(chat.id._serialized, query, 10);

        if (results.length === 0) {
            await msg.reply(`🔍 No predictions found matching "*${query}*".\n\nTry a different keyword or type /predictions to see all recent posts.`);
            return;
        }

        let text = `🔍 *Predictions matching "${query}"*\n\n`;
        for (let i = 0; i < results.length; i++) {
            const p = results[i];
            const name = await getDisplayName(chat.client, p.sender);
            const desc = p.description ? ` — _${p.description.substring(0, 80)}_` : '';
            const date = p.timestamp.split(' ')[0];
            text += `${i + 1}. ${p.url}${desc}\n   📅 ${date} · 👤 ${name}\n\n`;
        }

        await msg.reply(text);
        return;
    }

    // ─── Command: /stats ─────────────────────────────────────────────────
    if (msg.body === '/stats') {
        const count = getPredictionCount(chat.id._serialized);

        let text = '📈 *Group Prediction Stats*\n\n';
        text += `🔢 Total predictions tracked: *${count}*\n`;
        text += `🌐 Platform: FanClubz\n\n`;
        text += `_Post a FanClubz prediction link and I'll save it automatically!_`;

        await msg.reply(text);
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
                const contactName = await getDisplayName(chat.client, contact.id._serialized);
                await chat.removeParticipants([contact.id._serialized]);
                logInvite(contact.id._serialized, chat.id._serialized, chat.name, msg.from, 'kicked');
                await chat.sendMessage(`🦵 *${contactName}* has been kicked by an admin.`);
            } catch (err) {
                console.error(`Error kicking ${contact.id.user}:`, err.message);
                const contactName = await getDisplayName(chat.client, contact.id._serialized);
                await msg.reply(`❌ Could not kick *${contactName}*. Make sure the bot is an admin.`);
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
                const contactName = await getDisplayName(chat.client, contact.id._serialized);
                await chat.removeParticipants([contact.id._serialized]);
                logInvite(contact.id._serialized, chat.id._serialized, chat.name, msg.from, 'banned');
                await chat.sendMessage(`🔨 *${contactName}* has been banned by an admin.`);
            } catch (err) {
                console.error(`Error banning ${contact.id.user}:`, err.message);
                const contactName = await getDisplayName(chat.client, contact.id._serialized);
                await msg.reply(`❌ Could not ban *${contactName}*. Make sure the bot is an admin.`);
            }
        }
        return;
    }
};

/**
 * Handle group membership changes (join).
 */
const handleGroupJoin = async (notification) => {
    try {
        const chat = await notification.getChat();
        if (!chat.isGroup) return;

        const joinedUsers = notification.recipientIds || [];
        const inviter = notification.author || 'unknown';

        for (const userId of joinedUsers) {
            logInvite(userId, chat.id._serialized, chat.name, inviter, 'join');
            const userName = await getDisplayName(chat.client, userId);
            const inviterName = inviter !== 'unknown'
                ? await getDisplayName(chat.client, inviter)
                : 'invite link';
            console.log(`📥 ${userName} joined "${chat.name}" (invited by ${inviterName})`);
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
            const userName = await getDisplayName(chat.client, userId);
            console.log(`📤 ${userName} left "${chat.name}"`);
        }
    } catch (err) {
        console.error('Error handling group leave:', err.message);
    }
};

module.exports = { handleMessage, handleGroupJoin, handleGroupLeave };
