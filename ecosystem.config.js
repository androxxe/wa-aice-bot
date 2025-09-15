require('dotenv').config();

module.exports = {
  apps: [
    {
      name: process.env.PM2_NAME || 'wa-aice',
      script: 'dist/app.js',
      autorestart: false,
      watch: false
    }
  ]
}