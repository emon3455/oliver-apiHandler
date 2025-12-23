// Mock log routes configuration
module.exports = {
  logFlags: {
    startup: { enabled: true, level: 'info' },
    api: { enabled: true, level: 'info' },
    error: { enabled: true, level: 'error' }
  },
  destinations: {
    console: true,
    file: false,
    s3: false
  }
};
