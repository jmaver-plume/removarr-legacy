const express = require('express');
const authService = require('../config/auth');
const router = express.Router();

// Login page
router.get('/login', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/removarr');
  }
  res.render('login', { error: null });
});

// Login POST
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.render('login', { error: 'Username and password are required' });
  }

  if (authService.validateUser(username, password)) {
    const user = authService.getUser();
    req.session.userId = user.id;
    req.session.username = user.username;
    res.redirect('/removarr');
  } else {
    res.render('login', { error: 'Invalid username or password' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/removarr/login');
  });
});

module.exports = router;