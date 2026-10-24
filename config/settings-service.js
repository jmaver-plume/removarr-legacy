const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');

class SettingsService {
  constructor() {
    this.db = null;
    this.settings = {};
    this.initialized = false;
  }

  generatePassword(length = 16) {
    return crypto.randomBytes(length).toString('base64').slice(0, length);
  }

  async initialize(dbPath) {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(dbPath, async (err) => {
        if (err) {
          console.error('Failed to connect to database for settings:', err);
          return reject(err);
        }

        try {
          // Create settings table if it doesn't exist
          await this.createSettingsTable();
          
          // Initialize default admin credentials if they don't exist
          await this.initializeAdminCredentials();
          
          // Load all settings from database
          await this.loadSettings();
          
          this.initialized = true;
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  createSettingsTable() {
    return new Promise((resolve, reject) => {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          console.error('Failed to create settings table:', err);
          return reject(err);
        }
        resolve();
      });
    });
  }

  async initializeAdminCredentials() {
    return new Promise((resolve, reject) => {
      // Check if admin_username exists
      this.db.get('SELECT value FROM settings WHERE key = ?', ['admin_username'], (err, row) => {
        if (err) {
          return reject(err);
        }

        if (!row) {
          // Admin doesn't exist, create default credentials
          const generatedPassword = this.generatePassword(16);
          
          this.db.serialize(() => {
            const stmt = this.db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
            
            stmt.run('admin_username', 'removarr', (err) => {
              if (err) {
                console.error('Failed to create admin_username:', err);
              }
            });
            
            stmt.run('admin_password', generatedPassword, (err) => {
              if (err) {
                console.error('Failed to create admin_password:', err);
              } else {
                console.log('\n╔════════════════════════════════════════════════════════════════╗');
                console.log('║  🔐 FIRST-TIME SETUP: Admin Credentials Generated             ║');
                console.log('╠════════════════════════════════════════════════════════════════╣');
                console.log(`║  Username: removarr                                            ║`);
                console.log(`║  Password: ${generatedPassword.padEnd(48)} ║`);
                console.log('╠════════════════════════════════════════════════════════════════╣');
                console.log('║  ⚠️  IMPORTANT: Save these credentials now!                    ║');
                console.log('║  You can change them later via the settings API.               ║');
                console.log('╚════════════════════════════════════════════════════════════════╝\n');
              }
            });
            
            stmt.finalize(() => {
              resolve();
            });
          });
        } else {
          // Admin already exists
          resolve();
        }
      });
    });
  }

  loadSettings() {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT key, value FROM settings', (err, rows) => {
        if (err) {
          console.error('Failed to load settings from database:', err);
          return reject(err);
        }

        this.settings = {};
        rows.forEach(row => {
          this.settings[row.key] = row.value;
        });

        resolve();
      });
    });
  }

  get() {
    if (!this.initialized) {
      throw new Error('SettingsService not initialized. Call initialize() first.');
    }

    // Parse voters from comma-separated string
    const voters = this.settings.voters 
      ? this.settings.voters.split(',').map(v => v.trim())
      : [];

    return {
      server: {
        sessionSecret: this.settings.session_secret || 'default-secret-change-me'
      },
      sonarr: {
        url: this.settings.sonarr_url || '',
        apiKey: this.settings.sonarr_api_key || ''
      },
      radarr: {
        url: this.settings.radarr_url || '',
        apiKey: this.settings.radarr_api_key || ''
      },
      auth: {
        adminUsername: this.settings.admin_username || 'admin',
        adminPassword: this.settings.admin_password || 'admin'
      },
      voters: voters
    };
  }

  async reload() {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        return reject(new Error('Database not connected'));
      }

      this.db.all('SELECT key, value FROM settings', (err, rows) => {
        if (err) {
          console.error('Failed to reload settings from database:', err);
          return reject(err);
        }

        this.settings = {};
        rows.forEach(row => {
          this.settings[row.key] = row.value;
        });

        resolve();
      });
    });
  }

  isConfigured() {
    // Check if essential settings are present
    return !!(
      this.settings.sonarr_url &&
      this.settings.sonarr_api_key &&
      this.settings.radarr_url &&
      this.settings.radarr_api_key &&
      this.settings.voters &&
      this.settings.admin_username &&
      this.settings.admin_password
    );
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

module.exports = new SettingsService();
