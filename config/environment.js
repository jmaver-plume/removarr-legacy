require('dotenv').config();
const crypto = require('crypto');

class EnvironmentConfig {
  constructor() {
    this.config = this.loadConfig();
  }

  generateSessionSecret() {
    return crypto.randomBytes(32).toString('hex');
  }

  loadConfig() {
    // Auto-generate session secret if not provided
    const sessionSecret = process.env.SESSION_SECRET || this.generateSessionSecret();
    
    if (!process.env.SESSION_SECRET) {
      console.log('⚠️  No SESSION_SECRET found, using auto-generated secret');
      console.log('   For production, set SESSION_SECRET in environment variables');
    }

    return {
      server: {
        port: process.env.PORT || 3000,
        sessionSecret: sessionSecret
      },
      database: {
        path: process.env.DB_PATH || process.env.DATABASE_PATH || './database.sqlite'
      }
    };
  }

  get() {
    return this.config;
  }
}

module.exports = new EnvironmentConfig();
