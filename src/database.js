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

    // Activity log table
    db.run(`CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        messageId TEXT,
        sender TEXT,
        groupName TEXT,
        body TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Invite tracking table
    db.run(`CREATE TABLE IF NOT EXISTS invite_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT,
        groupId TEXT,
        groupName TEXT,
        invitedBy TEXT,
        action TEXT DEFAULT 'join',
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Betting subscriptions table
    db.run(`CREATE TABLE IF NOT EXISTS betting_subs (
        userId TEXT,
        groupId TEXT,
        PRIMARY KEY (userId, groupId)
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
 * Log a group membership change (join/leave/kick/ban).
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
 * Counts 'join' and 'intro' actions.
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

/**
 * Subscribe a user to betting notifications in a group.
 */
const addBettingSub = (userId, groupId) => {
    try {
        db.run('INSERT OR IGNORE INTO betting_subs (userId, groupId) VALUES (?, ?)', [userId, groupId]);
        save();
    } catch (err) {
        console.error('Error adding betting sub:', err.message);
    }
};

/**
 * Unsubscribe a user from betting notifications in a group.
 */
const removeBettingSub = (userId, groupId) => {
    try {
        db.run('DELETE FROM betting_subs WHERE userId = ? AND groupId = ?', [userId, groupId]);
        save();
    } catch (err) {
        console.error('Error removing betting sub:', err.message);
    }
};

/**
 * Get all users subscribed to betting notifications in a group.
 */
const getBettingSubs = (groupId) => {
    try {
        const results = db.exec('SELECT userId FROM betting_subs WHERE groupId = ?', [groupId]);
        if (results.length === 0) return [];
        return results[0].values.map(row => row[0]);
    } catch (err) {
        console.error('Error fetching betting subs:', err.message);
        return [];
    }
};

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
    initDb, logMessage, logInvite, getInviteLogs, hasIntroLog, getInviteLeaderboard,
    addBettingSub, removeBettingSub, getBettingSubs, 
    close 
};
