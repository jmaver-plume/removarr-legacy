const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const envConfig = require('../config/environment');
const settingsService = require('../config/settings-service');

class Database {
  constructor() {
    const config = envConfig.get();
    this.dbPath = config.database.path;
    this.db = new sqlite3.Database(this.dbPath);
    this.init();
  }

  init() {
    console.log('🔧 Initializing database...');
    this.db.serialize(() => {
      // Media table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS media (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          external_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          title_slug TEXT,
          type TEXT NOT NULL CHECK(type IN ('movie', 'series')),
          year INTEGER,
          overview TEXT,
          poster_url TEXT,
          downloaded BOOLEAN DEFAULT 0,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'deleted')),
          added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          deleted_at DATETIME,
          UNIQUE(external_id, type)
        )
      `, (err) => {
        if (err) {
          console.error('❌ Error creating media table:', err);
        } else {
          console.log('✅ Media table ready');
        }
      });

      // Check current table schema and migrate if needed
      this.db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='media'`, (err, row) => {
        if (!err && row) {
          console.log('📋 Current media table schema detected');
          
          // Check if old UNIQUE constraint exists
          if (row.sql.includes('external_id INTEGER UNIQUE NOT NULL')) {
            console.log('🔄 Migrating table: removing old UNIQUE constraint on external_id...');
            
            this.db.serialize(() => {
              // Disable foreign keys temporarily
              this.db.run('PRAGMA foreign_keys=OFF');
              
              this.db.run('BEGIN TRANSACTION');
              
              // Create new table with correct schema
              this.db.run(`
                CREATE TABLE media_new (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  external_id INTEGER NOT NULL,
                  title TEXT NOT NULL,
                  title_slug TEXT,
                  type TEXT NOT NULL CHECK(type IN ('movie', 'series')),
                  year INTEGER,
                  overview TEXT,
                  poster_url TEXT,
                  downloaded BOOLEAN DEFAULT 0,
                  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'deleted')),
                  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  deleted_at DATETIME,
                  UNIQUE(external_id, type)
                )
              `, (err) => {
                if (err) {
                  console.error('❌ Failed to create new table:', err);
                  this.db.run('ROLLBACK');
                  return;
                }
                console.log('✅ Created new table structure');
              });
              
              // Copy data
              this.db.run(`
                INSERT INTO media_new 
                SELECT id, external_id, title, title_slug, type, year, overview, poster_url, 0, status, added_at, deleted_at
                FROM media
              `, (err) => {
                if (err) {
                  console.error('❌ Failed to copy data:', err);
                  this.db.run('ROLLBACK');
                  return;
                }
                console.log('✅ Copied data to new table');
              });
              
              // Drop old table
              this.db.run('DROP TABLE media', (err) => {
                if (err) {
                  console.error('❌ Failed to drop old table:', err);
                  this.db.run('ROLLBACK');
                  return;
                }
                console.log('✅ Dropped old table');
              });
              
              // Rename new table
              this.db.run('ALTER TABLE media_new RENAME TO media', (err) => {
                if (err) {
                  console.error('❌ Failed to rename table:', err);
                  this.db.run('ROLLBACK');
                  return;
                }
                console.log('✅ Renamed new table');
              });
              
              this.db.run('COMMIT', (err) => {
                if (err) {
                  console.error('❌ Migration failed:', err);
                  this.db.run('ROLLBACK');
                } else {
                  console.log('✅ Migration completed successfully');
                }
              });
              
              // Re-enable foreign keys
              this.db.run('PRAGMA foreign_keys=ON');
            });
          } else {
            console.log('✅ Table schema is correct, no migration needed');
          }
        }
      });

      // Add title_slug column if it doesn't exist (migration)
      this.db.run(`
        ALTER TABLE media ADD COLUMN title_slug TEXT
      `, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('❌ Error adding title_slug column:', err);
        }
      });

      // Add downloaded column if it doesn't exist (migration)
      this.db.run(`
        ALTER TABLE media ADD COLUMN downloaded BOOLEAN DEFAULT 0
      `, (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.error('❌ Error adding downloaded column:', err);
        }
      });

      // Votes table - now stores votes for each voter name
      this.db.run(`
        CREATE TABLE IF NOT EXISTS votes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          media_id INTEGER NOT NULL,
          voter_name TEXT NOT NULL,
          vote TEXT NOT NULL CHECK(vote IN ('yes', 'no')),
          voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (media_id) REFERENCES media (id),
          UNIQUE(media_id, voter_name)
        )
      `);

      // Settings table - stores configuration values
      this.db.run(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // No need to initialize default user anymore
    });
  }

  // Settings management methods
  getSetting(key, callback) {
    this.db.get(
      'SELECT value FROM settings WHERE key = ?',
      [key],
      (err, row) => {
        if (callback) callback(err, row ? row.value : null);
      }
    );
  }

  setSetting(key, value, callback) {
    this.db.run(
      'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      [key, value],
      function(err) {
        if (callback) callback(err, this.changes);
      }
    );
  }

  getAllSettings(callback) {
    this.db.all(
      'SELECT key, value FROM settings',
      (err, rows) => {
        if (err) return callback(err, null);
        const settings = {};
        rows.forEach(row => {
          settings[row.key] = row.value;
        });
        callback(null, settings);
      }
    );
  }

  deleteSetting(key, callback) {
    this.db.run(
      'DELETE FROM settings WHERE key = ?',
      [key],
      function(err) {
        if (callback) callback(err, this.changes);
      }
    );
  }

  addMedia(externalId, title, type, year, overview, posterUrl, titleSlug, downloaded, callback) {
    // Handle optional downloaded parameter
    if (typeof downloaded === 'function') {
      callback = downloaded;
      downloaded = false;
    }
    
    // First check if media already exists
    this.db.get(
      'SELECT id FROM media WHERE external_id = ? AND type = ?',
      [externalId, type],
      (err, existing) => {
        if (err) {
          if (callback) callback(err, null);
          return;
        }
        
        if (existing) {
          // Media exists, update it instead
          this.db.run(
            'UPDATE media SET title = ?, year = ?, overview = ?, poster_url = ?, title_slug = ?, downloaded = ? WHERE external_id = ? AND type = ?',
            [title, year, overview, posterUrl, titleSlug, downloaded ? 1 : 0, externalId, type],
            function(err) {
              if (callback) callback(err, existing.id);
            }
          );
        } else {
          // Insert new media
          this.db.run(
            'INSERT INTO media (external_id, title, type, year, overview, poster_url, title_slug, downloaded) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [externalId, title, type, year, overview, posterUrl, titleSlug, downloaded ? 1 : 0],
            function(err) {
              if (callback) callback(err, this.lastID);
            }
          );
        }
      }
    );
  }

  updateDownloadStatus(externalId, type, downloaded, callback) {
    this.db.run(
      'UPDATE media SET downloaded = ? WHERE external_id = ? AND type = ?',
      [downloaded ? 1 : 0, externalId, type],
      function(err) {
        if (callback) callback(err, this.changes);
      }
    );
  }

  removeMedia(externalId, callback) {
    this.db.run(
      'UPDATE media SET status = "deleted", deleted_at = CURRENT_TIMESTAMP WHERE external_id = ?',
      [externalId],
      function(err) {
        if (callback) callback(err, this.changes);
      }
    );
  }

  getPendingMedia(callback) {
    this.db.all(
      `SELECT m.*, 
              COUNT(v.id) as total_votes,
              COUNT(CASE WHEN v.vote = 'yes' THEN 1 END) as yes_votes,
              COUNT(CASE WHEN v.vote = 'no' THEN 1 END) as no_votes
       FROM media m 
       LEFT JOIN votes v ON m.id = v.media_id 
       WHERE m.status = 'pending' 
       GROUP BY m.id 
       ORDER BY m.title ASC`,
      callback
    );
  }

  submitVote(mediaId, voterName, vote, callback) {
    this.db.run(
      'INSERT OR REPLACE INTO votes (media_id, voter_name, vote) VALUES (?, ?, ?)',
      [mediaId, voterName, vote],
      function(err) {
        if (callback) callback(err, this.changes);
      }
    );
  }

  getVotesByMedia(mediaId, callback) {
    this.db.all(
      'SELECT * FROM votes WHERE media_id = ?',
      [mediaId],
      callback
    );
  }

  getMediaVotes(mediaId, callback) {
    this.db.all(
      'SELECT voter_name, vote FROM votes WHERE media_id = ?',
      [mediaId],
      (err, votes) => {
        if (err) return callback(err, {});
        
        const voteMap = {};
        votes.forEach(vote => {
          voteMap[vote.voter_name] = vote.vote;
        });
        callback(null, voteMap);
      }
    );
  }

  checkAllVotesDelete(mediaId, callback) {
    this.db.all(
      'SELECT voter_name, vote FROM votes WHERE media_id = ?',
      [mediaId],
      (err, votes) => {
        if (err) return callback(err, false);
        
        // Get voters from settings
        const voters = settingsService.get().voters;
        
        // Check if we have votes from all voters and all are 'no' (delete)
        const voterVotes = {};
        votes.forEach(vote => {
          voterVotes[vote.voter_name] = vote.vote;
        });
        
        const allVotersVoted = voters.every(voter => voterVotes[voter]);
        const allVotedDelete = allVotersVoted && voters.every(voter => voterVotes[voter] === 'no');
        
        callback(null, allVotedDelete);
      }
    );
  }

  approveMedia(mediaId, callback) {
    this.db.run(
      'UPDATE media SET status = "approved" WHERE id = ?',
      [mediaId],
      function(err) {
        if (callback) callback(err, this.changes);
      }
    );
  }

  getVoters() {
    return settingsService.get().voters;
  }

  close() {
    this.db.close();
  }

  // Utility function to get the best image URL (fanart first, poster as fallback)
  static getBestImageUrl(images) {
    if (!Array.isArray(images)) return '';
    
    // First try to find fanart
    const fanartImage = images.find(img => img.coverType === 'fanart');
    if (fanartImage?.remoteUrl) {
      return fanartImage.remoteUrl;
    }
    
    // Fallback to poster
    const posterImage = images.find(img => img.coverType === 'poster');
    if (posterImage?.remoteUrl) {
      return posterImage?.remoteUrl;
    }
    
    return '';
  }
}

module.exports = Database;