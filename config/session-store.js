const session = require('express-session');
const sqlite3 = require('sqlite3');

class SQLiteSessionStore extends session.Store {
  constructor(dbPath) {
    super();
    this.db = new sqlite3.Database(dbPath);
    this.ready = new Promise((resolve, reject) => {
      this.db.run('CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL)', err => err ? reject(err) : resolve());
    });
    this.cleanup = setInterval(() => {
      this.ready.then(() => this.db.run('DELETE FROM sessions WHERE expires <= ?', Date.now())).catch(() => {});
    }, 60 * 60 * 1000);
    this.cleanup.unref();
  }

  get(sid, callback) {
    this.db.get('SELECT data FROM sessions WHERE sid = ? AND expires > ?', [sid, Date.now()], (err, row) => {
      if (err || !row) return callback(err, null);
      try { callback(null, JSON.parse(row.data)); } catch (error) { callback(error); }
    });
  }

  set(sid, value, callback = () => {}) {
    const expires = value.cookie.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 86400000;
    this.db.run('INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)', [sid, JSON.stringify(value), expires], callback);
  }

  destroy(sid, callback = () => {}) {
    this.db.run('DELETE FROM sessions WHERE sid = ?', sid, callback);
  }

  touch(sid, value, callback = () => {}) {
    const expires = value.cookie.expires ? new Date(value.cookie.expires).getTime() : Date.now() + 86400000;
    this.db.run('UPDATE sessions SET expires = ? WHERE sid = ?', [expires, sid], callback);
  }
}

module.exports = SQLiteSessionStore;
