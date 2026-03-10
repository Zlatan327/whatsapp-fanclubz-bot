const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../activity.sqlite');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Create the activity_log table if it doesn't exist
db.exec(`CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    messageId TEXT,
    sender TEXT,
    groupName TEXT,
    body TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Prepared statement for inserting messages
const insertStmt = db.prepare(
    'INSERT INTO activity_log (messageId, sender, groupName, body) VALUES (?, ?, ?, ?)'
);

/**
 * Log a group message to the SQLite database.
 */
const logMessage = (messageId, sender, groupName, body) => {
    try {
        insertStmt.run(messageId, sender, groupName, body);
    } catch (err) {
        console.error('Error logging message:', err.message);
    }
};

/**
 * Close the database connection gracefully.
 */
const close = () => {
    try {
        db.close();
        console.log('Database connection closed.');
    } catch (err) {
        console.error('Error closing database:', err.message);
    }
};

module.exports = { logMessage, close };
