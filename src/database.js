const mongoose = require('mongoose');

// Mongoose Models
const activitySchema = new mongoose.Schema({
    messageId: String,
    sender: String,
    groupName: String,
    body: String,
    timestamp: { type: Date, default: Date.now }
});
const ActivityLog = mongoose.model('ActivityLog', activitySchema);

const inviteSchema = new mongoose.Schema({
    userId: String,
    groupId: String,
    groupName: String,
    invitedBy: { type: String, default: 'unknown' },
    action: { type: String, default: 'join' },
    timestamp: { type: Date, default: Date.now }
});
const InviteLog = mongoose.model('InviteLog', inviteSchema);

const predictionSchema = new mongoose.Schema({
    messageId: String,
    sender: String,
    groupId: String,
    url: String,
    description: String,
    timestamp: { type: Date, default: Date.now }
});
const Prediction = mongoose.model('Prediction', predictionSchema);

const initDb = async () => {
    // We connect to Mongoose from index.js directly.
    console.log('📦 Database models initialized');
};

// ─── Activity Logging ────────────────────────────────────────────────────────

const logMessage = async (messageId, sender, groupName, body) => {
    try {
        await ActivityLog.create({ messageId, sender, groupName, body });
    } catch (err) {
        console.error('Error logging message:', err.message);
    }
};

const getActivityLeaderboard = async (groupName, limit = 10) => {
    try {
        const results = await ActivityLog.aggregate([
            { $match: { groupName: String(groupName) } },
            { $group: { _id: "$sender", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: limit }
        ]);
        return results.map(row => ({ sender: row._id, count: row.count }));
    } catch (err) {
        console.error('Error fetching activity leaderboard:', err.message);
        return [];
    }
};

// ─── Invite Tracking ─────────────────────────────────────────────────────────

const logInvite = async (userId, groupId, groupName, invitedBy, action = 'join') => {
    try {
        await InviteLog.create({ userId, groupId, groupName, invitedBy: invitedBy || 'unknown', action });
    } catch (err) {
        console.error('Error logging invite:', err.message);
    }
};

const getInviteLogs = async (groupId, limit = 10) => {
    try {
        const results = await InviteLog.find({ groupId })
            .sort({ _id: -1 })
            .limit(limit)
            .lean();
        return results.map(row => ({
            userId: row.userId,
            invitedBy: row.invitedBy,
            action: row.action,
            timestamp: row.timestamp
        }));
    } catch (err) {
        console.error('Error fetching invite logs:', err.message);
        return [];
    }
};

const hasIntroLog = async (userId, groupId) => {
    try {
        const count = await InviteLog.countDocuments({ userId, groupId, action: 'intro' });
        return count > 0;
    } catch (err) {
        console.error('Error checking intro log:', err.message);
        return false;
    }
};

const getInviteLeaderboard = async (groupId, limit = 10) => {
    try {
        const results = await InviteLog.aggregate([
            { $match: { groupId: String(groupId), invitedBy: { $ne: 'unknown' }, action: { $in: ['join', 'intro'] } } },
            { $group: { _id: "$invitedBy", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: limit }
        ]);
        return results.map(row => ({ invitedBy: row._id, count: row.count }));
    } catch (err) {
        console.error('Error fetching invite leaderboard:', err.message);
        return [];
    }
};

// ─── Predictions ─────────────────────────────────────────────────────────────

const savePrediction = async (messageId, sender, groupId, url, description) => {
    try {
        await Prediction.create({ messageId, sender, groupId, url, description: description || '' });
    } catch (err) {
        console.error('Error saving prediction:', err.message);
    }
};

const getRecentPredictions = async (groupId, limit = 10) => {
    try {
        const results = await Prediction.find({ groupId: String(groupId) })
            .sort({ _id: -1 })
            .limit(limit)
            .lean();
        return results.map(row => ({
            sender: row.sender,
            url: row.url,
            description: row.description,
            timestamp: row.timestamp
        }));
    } catch (err) {
        console.error('Error fetching predictions:', err.message);
        return [];
    }
};

const searchPredictions = async (groupId, query, limit = 10) => {
    try {
        const regex = new RegExp(query, 'i');
        const results = await Prediction.find({
            groupId: String(groupId),
            $or: [
                { description: { $regex: regex } },
                { url: { $regex: regex } }
            ]
        })
        .sort({ _id: -1 })
        .limit(limit)
        .lean();
        
        return results.map(row => ({
            sender: row.sender,
            url: row.url,
            description: row.description,
            timestamp: row.timestamp
        }));
    } catch (err) {
        console.error('Error searching predictions:', err.message);
        return [];
    }
};

const getPredictionCount = async (groupId) => {
    try {
        return await Prediction.countDocuments({ groupId: String(groupId) });
    } catch (err) {
        console.error('Error counting predictions:', err.message);
        return 0;
    }
};

const close = async () => {
    console.log('Database cleanup complete.');
};

module.exports = { 
    initDb, logMessage, getActivityLeaderboard,
    logInvite, getInviteLogs, hasIntroLog, getInviteLeaderboard,
    savePrediction, getRecentPredictions, searchPredictions, getPredictionCount,
    close 
};
