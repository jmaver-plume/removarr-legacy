#!/usr/bin/env node

/**
 * Interactive CLI tool to configure Removarr settings
 * 
 * Usage: node scripts/configure.js
 */

const readline = require('readline');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

require('dotenv').config();

const dbPath = process.env.DB_PATH;
const db = new sqlite3.Database(dbPath);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Promisify question
function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function getExistingSettings() {
  return new Promise((resolve, reject) => {
    db.all('SELECT key, value FROM settings', (err, rows) => {
      if (err) {
        // Table might not exist yet
        resolve({});
      } else {
        const settings = {};
        rows.forEach(row => settings[row.key] = row.value);
        resolve(settings);
      }
    });
  });
}

function setSetting(key, value) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
      [key, value],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

async function configure() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Removarr Configuration Tool');
  console.log('═══════════════════════════════════════════════════\n');

  // Create settings table if it doesn't exist
  await new Promise((resolve, reject) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const existing = await getExistingSettings();
  
  console.log('Press Enter to keep existing values (shown in brackets)\n');

  // Sonarr Configuration
  console.log('━━━ Sonarr Configuration ━━━');
  const sonarrUrl = await question(`Sonarr URL [${existing.sonarr_url || 'http://localhost:8989'}]: `);
  const sonarrApiKey = await question(`Sonarr API Key [${existing.sonarr_api_key ? '***hidden***' : 'none'}]: `);
  
  // Radarr Configuration
  console.log('\n━━━ Radarr Configuration ━━━');
  const radarrUrl = await question(`Radarr URL [${existing.radarr_url || 'http://localhost:7878'}]: `);
  const radarrApiKey = await question(`Radarr API Key [${existing.radarr_api_key ? '***hidden***' : 'none'}]: `);
  
  // Authentication
  console.log('\n━━━ Admin Authentication ━━━');
  const adminUsername = await question(`Admin Username [${existing.admin_username || 'admin'}]: `);
  const adminPassword = await question(`Admin Password [${existing.admin_password ? '***hidden***' : 'none'}]: `);
  
  // Voters
  console.log('\n━━━ Voting Configuration ━━━');
  const currentVoters = existing.voters || 'Petra,Matej';
  const votersInput = await question(`Voters (comma-separated, min 2) [${currentVoters}]: `);

  rl.close();

  // Apply defaults and save
  console.log('\n💾 Saving configuration...');

  const settings = {
    sonarr_url: sonarrUrl || existing.sonarr_url || 'http://localhost:8989',
    sonarr_api_key: sonarrApiKey || existing.sonarr_api_key || '',
    radarr_url: radarrUrl || existing.radarr_url || 'http://localhost:7878',
    radarr_api_key: radarrApiKey || existing.radarr_api_key || '',
    admin_username: adminUsername || existing.admin_username || 'admin',
    admin_password: adminPassword || existing.admin_password || 'admin',
    voters: votersInput || existing.voters || 'Petra,Matej'
  };

  // Validate
  const errors = [];
  
  try {
    new URL(settings.sonarr_url);
  } catch (e) {
    errors.push('Invalid Sonarr URL');
  }

  try {
    new URL(settings.radarr_url);
  } catch (e) {
    errors.push('Invalid Radarr URL');
  }

  const votersList = settings.voters.split(',').map(v => v.trim()).filter(v => v);
  if (votersList.length < 2) {
    errors.push('At least 2 voters are required');
  }

  if (errors.length > 0) {
    console.error('\n❌ Configuration errors:');
    errors.forEach(err => console.error(`   - ${err}`));
    process.exit(1);
  }

  // Save all settings
  try {
    for (const [key, value] of Object.entries(settings)) {
      await setSetting(key, value);
    }

    console.log('\n✅ Configuration saved successfully!');
    console.log('\nYour settings:');
    console.log(`   Sonarr: ${settings.sonarr_url}`);
    console.log(`   Radarr: ${settings.radarr_url}`);
    console.log(`   Admin: ${settings.admin_username}`);
    console.log(`   Voters: ${settings.voters.split(',').join(', ')}`);
    console.log('\nYou can now start the application with: npm start');
    
  } catch (error) {
    console.error('\n❌ Error saving configuration:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

// Handle Ctrl+C gracefully
rl.on('SIGINT', () => {
  console.log('\n\n❌ Configuration cancelled');
  rl.close();
  db.close();
  process.exit(0);
});

configure().catch(err => {
  console.error('Error:', err);
  rl.close();
  db.close();
  process.exit(1);
});
