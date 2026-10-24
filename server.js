const express = require('express');
const session = require('express-session');
const SQLiteSessionStore = require('./config/session-store');
const path = require('path');
const config = require('./config/environment');
const settingsService = require('./config/settings-service');
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const webhookRoutes = require('./routes/webhooks');
const settingsRoutes = require('./routes/settings');

const app = express();
const envConfig = config.get();

// Initialize settings service
async function startServer() {
  try {
    // Initialize settings from database
    await settingsService.initialize(envConfig.database.path);
    
    console.log('✅ Database initialized successfully');
    
    if (settingsService.isConfigured()) {
      const appConfig = settingsService.get();
      console.log(`👤 Admin user: ${appConfig.auth.adminUsername}`);
      console.log(`📊 Configured voters: ${appConfig.voters.join(', ')}`);
      console.log(`🔗 Sonarr: ${appConfig.sonarr.url}`);
      console.log(`🔗 Radarr: ${appConfig.radarr.url}`);
    } else {
      console.log('\n⚠️  Application requires additional configuration:');
      console.log('   - Sonarr URL and API key');
      console.log('   - Radarr URL and API key');
      console.log('   - Voter names (at least 2)\n');
      console.log('   Configure via API: PUT /removarr/api/settings');
      console.log('   Or use: npm run configure\n');
    }

    const sessionStore = new SQLiteSessionStore(envConfig.database.path);
    await sessionStore.ready;
    if (!process.env.SESSION_SECRET && !settingsService.settings.session_secret) {
      await new Promise((resolve, reject) => {
        settingsService.db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
          ['session_secret', envConfig.server.sessionSecret], err => err ? reject(err) : resolve());
      });
      await settingsService.reload();
    }

    // Middleware
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());
    app.use(session({
      secret: process.env.SESSION_SECRET || settingsService.settings.session_secret,
      store: sessionStore,
      name: 'removarr.sid',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
    }));

    // Static files
    app.use('/removarr', express.static('public'));

    // View engine
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));

    // Authentication middleware
    const requireAuth = (req, res, next) => {
      if (req.session.userId) {
        next();
      } else {
        res.redirect('/removarr/login');
      }
    };

    // Routes with /removarr prefix
    app.use('/removarr', authRoutes);
    app.use('/removarr/api', requireAuth, apiRoutes);
    app.use('/removarr/api/settings', requireAuth, settingsRoutes);
    app.use('/removarr/webhook', webhookRoutes);

    // Dashboard route
    app.get('/removarr', requireAuth, (req, res) => {
      res.render('dashboard', { user: req.session.username });
    });

    // Redirect root to /removarr
    app.get('/', (_, res) => {
      res.redirect('/removarr');
    });

    // Start server
    app.listen(envConfig.server.port, () => {
      console.log(`🚀 Removarr running on http://localhost:${envConfig.server.port}/removarr`);
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();