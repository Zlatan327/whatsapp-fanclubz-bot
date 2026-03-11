const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '../activity.sqlite');

let db;

/**
 * Initialize the SQLite database using sql.js (pure JS, no native build).
 * Loads existing data from disk if the file exists.
 */
const initDb = async () => {
    const SQL = await initSqlJs();

    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }

    // Activity log table — tracks every message for activity leaderboard
    db.run(`CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        messageId TEXT,
        sender TEXT,
        groupName TEXT,
        body TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Invite tracking table — tracks who invited whom
    db.run(`CREATE TABLE IF NOT EXISTS invite_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT,
        groupId TEXT,
        groupName TEXT,
        invitedBy TEXT,
        action TEXT DEFAULT 'join',
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Predictions table — stores prediction market links posted in the group
    db.run(`CREATE TABLE IF NOT EXISTS predictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        messageId TEXT,
        sender TEXT,
        groupId TEXT,
        url TEXT,
        description TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Persist the initial schema to disk
    save();
    console.log('📦 Database initialized at', DB_PATH);
};

/**
 * Persist the in-memory database to disk.
 */
const save = () => {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
};

// ─── Activity Logging ────────────────────────────────────────────────────────

/**
 * Log a group message to the SQLite database.
 */
const logMessage = (messageId, sender, groupName, body) => {
    try {
        db.run(
            'INSERT INTO activity_log (messageId, sender, groupName, body) VALUES (?, ?, ?, ?)',
            [messageId, sender, groupName, body]
        );
        save();
    } catch (err) {
        console.error('Error logging message:', err.message);
    }
};

/**
 * Get top message senders for a group (most-active leaderboard).
 */
const getActivityLeaderboard = (groupName, limit = 10) => {
    try {
        const results = db.exec(
            `SELECT sender, COUNT(*) as count 
             FROM activity_log 
             WHERE groupName = ?
             GROUP BY sender 
             ORDER BY count DESC 
             LIMIT ?`,
            [groupName, limit]
        );
        if (results.length === 0) return [];
        return results[0].values.map(row => ({
            sender: row[0],
            count: row[1]
        }));
    } catch (err) {
        console.error('Error fetching activity leaderboard:', err.message);
        return [];
    }
};

// ─── Invite Tracking ─────────────────────────────────────────────────────────

/**
 * Log a group membership change (join/leave/kick/ban/intro).
 */
const logInvite = (userId, groupId, groupName, invitedBy, action = 'join') => {
    try {
        db.run(
            'INSERT INTO invite_log (userId, groupId, groupName, invitedBy, action) VALUES (?, ?, ?, ?, ?)',
            [userId, groupId, groupName, invitedBy || 'unknown', action]
        );
        save();
    } catch (err) {
        console.error('Error logging invite:', err.message);
    }
};

/**
 * Get recent invite logs for a group.
 */
const getInviteLogs = (groupId, limit = 10) => {
    try {
        const results = db.exec(
            'SELECT userId, invitedBy, action, timestamp FROM invite_log WHERE groupId = ? ORDER BY id DESC LIMIT ?',
            [groupId, limit]
        );
        if (results.length === 0) return [];
        return results[0].values.map(row => ({
            userId: row[0],
            invitedBy: row[1],
            action: row[2],
            timestamp: row[3]
        }));
    } catch (err) {
        console.error('Error fetching invite logs:', err.message);
        return [];
    }
};

/**
 * Check if a user has already registered who invited them in a group.
 */
const hasIntroLog = (userId, groupId) => {
    try {
        const results = db.exec(
            "SELECT COUNT(*) FROM invite_log WHERE userId = ? AND groupId = ? AND action = 'intro'",
            [userId, groupId]
        );
        if (results.length === 0) return false;
        return results[0].values[0][0] > 0;
    } catch (err) {
        console.error('Error checking intro log:', err.message);
        return false;
    }
};

/**
 * Get a leaderboard of who invited the most people in a group.
 */
const getInviteLeaderboard = (groupId, limit = 10) => {
    try {
        const results = db.exec(
            `SELECT invitedBy, COUNT(*) as count 
             FROM invite_log 
             WHERE groupId = ? AND invitedBy != 'unknown' AND (action = 'join' OR action = 'intro')
             GROUP BY invitedBy 
             ORDER BY count DESC 
             LIMIT ?`,
            [groupId, limit]
        );
        if (results.length === 0) return [];
        return results[0].values.map(row => ({
            invitedBy: row[0],
            count: row[1]
        }));
    } catch (err) {
        console.error('Error fetching invite leaderboard:', err.message);
        return [];
    }
};

// ─── Predictions ─────────────────────────────────────────────────────────────

/**
 * Save a prediction market link to the database.
 */
const savePrediction = (messageId, sender, groupId, url, description) => {
    try {
        db.run(
            'INSERT INTO predictions (messageId, sender, groupId, url, description) VALUES (?, ?, ?, ?, ?)',
            [messageId, sender, groupId, url, description || '']
        );
        save();
    } catch (err) {
        console.error('Error saving prediction:', err.message);
    }
};

/**
 * Get recent predictions for a group.
 */
const getRecentPredictions = (groupId, limit = 10) => {
    try {
        const results = db.exec(
            'SELECT sender, url, description, timestamp FROM predictions WHERE groupId = ? ORDER BY id DESC LIMIT ?',
            [groupId, limit]
        );
        if (results.length === 0) return [];
        return results[0].values.map(row => ({
            sender: row[0],
            url: row[1],
            description: row[2],
            timestamp: row[3]
        }));
    } catch (err) {
        console.error('Error fetching predictions:', err.message);
        return [];
    }
};

/**
 * Search predictions by keyword in their description or URL.
 */
const searchPredictions = (groupId, query, limit = 10) => {
    try {
        const results = db.exec(
            `SELECT sender, url, description, timestamp FROM predictions 
             WHERE groupId = ? AND (LOWER(description) LIKE LOWER(?) OR LOWER(url) LIKE LOWER(?))
             ORDER BY id DESC LIMIT ?`,
            [groupId, `%${query}%`, `%${query}%`, limit]
        );
        if (results.length === 0) return [];
        return results[0].values.map(row => ({
            sender: row[0],
            url: row[1],
            description: row[2],
            timestamp: row[3]
        }));
    } catch (err) {
        console.error('Error searching predictions:', err.message);
        return [];
    }
};

/**
 * Get the total number of predictions stored for a group.
 */
const getPredictionCount = (groupId) => {
    try {
        const results = db.exec(
            'SELECT COUNT(*) FROM predictions WHERE groupId = ?',
            [groupId]
        );
        if (results.length === 0) return 0;
        return results[0].values[0][0];
    } catch (err) {
        console.error('Error counting predictions:', err.message);
        return 0;
    }
};

// ─── Close ───────────────────────────────────────────────────────────────────

/**
 * Close the database connection gracefully.
 */
const close = () => {
    try {
        if (db) {
            save();
            db.close();
            console.log('Database connection closed.');
        }
    } catch (err) {
        console.error('Error closing database:', err.message);
    }
};

module.exports = { 
    initDb, logMessage, getActivityLeaderboard,
    logInvite, getInviteLogs, hasIntroLog, getInviteLeaderboard,
    savePrediction, getRecentPredictions, searchPredictions, getPredictionCount,
    close 
};
