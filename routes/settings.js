const express = require('express');
const Database = require('../database/db');
const settingsService = require('../config/settings-service');
const router = express.Router();

const db = new Database();

// Get all settings
router.get('/', (req, res) => {
  db.getAllSettings((err, settings) => {
    if (err) {
      console.error('Error fetching settings:', err);
      return res.status(500).json({ error: 'Failed to fetch settings' });
    }

    // Parse voters from comma-separated string if it exists
    if (settings.voters) {
      settings.voters = settings.voters.split(',').map(v => v.trim());
    }

    // Don't expose sensitive data like passwords and API keys in GET requests
    const safeSettings = {
      sonarr_url: settings.sonarr_url || '',
      radarr_url: settings.radarr_url || '',
      voters: settings.voters || [],
      admin_username: settings.admin_username || '',
      // API keys and passwords are intentionally omitted for security
    };

    res.json(safeSettings);
  });
});

// Get a specific setting
router.get('/:key', (req, res) => {
  const key = req.params.key;

  // Don't allow fetching sensitive keys directly
  const sensitiveKeys = ['admin_password', 'sonarr_api_key', 'radarr_api_key', 'session_secret'];
  if (sensitiveKeys.includes(key)) {
    return res.status(403).json({ error: 'Access to this setting is restricted' });
  }

  db.getSetting(key, (err, value) => {
    if (err) {
      console.error('Error fetching setting:', err);
      return res.status(500).json({ error: 'Failed to fetch setting' });
    }

    if (value === null) {
      return res.status(404).json({ error: 'Setting not found' });
    }

    // Parse voters if requested
    if (key === 'voters' && value) {
      value = value.split(',').map(v => v.trim());
    }

    res.json({ key, value });
  });
});

// Update or create a setting
router.put('/', (req, res) => {
  const updates = req.body;

  if (!updates || typeof updates !== 'object' || Array.isArray(updates) || !Object.keys(updates).length) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  // Validate required fields
  const allowedKeys = [
    'sonarr_url',
    'sonarr_api_key',
    'radarr_url',
    'radarr_api_key',
    'voters',
    'admin_username',
    'admin_password',
    'session_secret'
  ];

  const invalidKeys = Object.keys(updates).filter(key => !allowedKeys.includes(key));
  if (invalidKeys.length > 0) {
    return res.status(400).json({ error: `Invalid keys: ${invalidKeys.join(', ')}` });
  }

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'voters') {
      const names = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
      if (names.some(name => typeof name !== 'string' || !name.trim() || name.includes(',')) || new Set(names.map(name => name.trim())).size < 2 || new Set(names.map(name => name.trim())).size !== names.length) {
        return res.status(400).json({ error: 'Provide at least two unique, nonempty voter names' });
      }
      updates.voters = names.map(name => name.trim()).join(',');
    } else if (typeof value !== 'string') {
      return res.status(400).json({ error: `${key} must be a string` });
    }
    if (key.endsWith('_url') && (!value || !/^https?:\/\//i.test(value))) {
      return res.status(400).json({ error: 'Service URLs must use http or https' });
    }
  }

  // Convert voters array to comma-separated string if provided
  if (updates.voters && Array.isArray(updates.voters)) {
    updates.voters = updates.voters.join(',');
  }

  // Validate voters format
  if (updates.voters && typeof updates.voters === 'string') {
    const votersList = updates.voters.split(',').map(v => v.trim()).filter(v => v);
    if (votersList.length < 2) {
      return res.status(400).json({ error: 'At least 2 voters are required' });
    }
  }

  // Validate URLs if provided
  if (updates.sonarr_url) {
    try {
      new URL(updates.sonarr_url);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid Sonarr URL' });
    }
  }

  if (updates.radarr_url) {
    try {
      new URL(updates.radarr_url);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid Radarr URL' });
    }
  }

  // Update all provided settings
  const keys = Object.keys(updates);
  let completed = 0;
  let hasError = false;

  keys.forEach(key => {
    db.setSetting(key, updates[key], (err) => {
      if (err && !hasError) {
        hasError = true;
        console.error('Error updating setting:', err);
        return res.status(500).json({ error: 'Failed to update settings' });
      }

      completed++;
      if (completed === keys.length && !hasError) {
        // Reload settings into memory
        settingsService.reload().then(() => {
          console.log('✅ Settings reloaded successfully');
          res.json({ success: true, message: 'Settings updated and reloaded successfully' });
        }).catch(reloadErr => {
          console.error('Warning: Settings updated but reload failed:', reloadErr);
          res.json({ success: true, message: 'Settings updated successfully (restart recommended)' });
        });
      }
    });
  });
});

// Update a single setting
router.put('/:key', (req, res) => {
  const key = req.params.key;
  const { value } = req.body;

  if (value === undefined) {
    return res.status(400).json({ error: 'Value is required' });
  }

  // Validate allowed keys
  const allowedKeys = [
    'sonarr_url',
    'sonarr_api_key',
    'radarr_url',
    'radarr_api_key',
    'voters',
    'admin_username',
    'admin_password',
    'session_secret'
  ];

  if (!allowedKeys.includes(key)) {
    return res.status(400).json({ error: 'Invalid setting key' });
  }

  // Convert voters array to comma-separated string if provided
  let finalValue = value;
  if (key === 'voters' && Array.isArray(value)) {
    finalValue = value.join(',');
  }

  // Validate voters format
  if (key === 'voters') {
    const votersList = finalValue.split(',').map(v => v.trim()).filter(v => v);
    if (votersList.length < 2) {
      return res.status(400).json({ error: 'At least 2 voters are required' });
    }
  }

  // Validate URLs
  if (key === 'sonarr_url' || key === 'radarr_url') {
    try {
      new URL(finalValue);
    } catch (error) {
      return res.status(400).json({ error: `Invalid ${key}` });
    }
  }

  db.setSetting(key, finalValue, (err) => {
    if (err) {
      console.error('Error updating setting:', err);
      return res.status(500).json({ error: 'Failed to update setting' });
    }

    // Reload settings into memory
    settingsService.reload().then(() => {
      console.log(`✅ Setting '${key}' updated and reloaded`);
      res.json({ success: true, key, value: finalValue });
    }).catch(reloadErr => {
      console.error('Warning: Setting updated but reload failed:', reloadErr);
      res.json({ success: true, key, value: finalValue, warning: 'Restart recommended' });
    });
  });
});

// Delete a setting
router.delete('/:key', (req, res) => {
  const key = req.params.key;

  db.deleteSetting(key, (err, changes) => {
    if (err) {
      console.error('Error deleting setting:', err);
      return res.status(500).json({ error: 'Failed to delete setting' });
    }

    if (changes === 0) {
      return res.status(404).json({ error: 'Setting not found' });
    }

    res.json({ success: true, message: 'Setting deleted successfully' });
  });
});

module.exports = router;
