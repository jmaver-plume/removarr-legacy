const settingsService = require('./settings-service');

class AuthService {
  validateUser(username, password) {
    const config = settingsService.get().auth;
    return username === config.adminUsername && 
           password === config.adminPassword;
  }

  getUser() {
    const config = settingsService.get().auth;
    return {
      id: 1,
      username: config.adminUsername
    };
  }
}

module.exports = new AuthService();
