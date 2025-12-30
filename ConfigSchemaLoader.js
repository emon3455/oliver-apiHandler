// ConfigSchemaLoader.js - Loads and validates configuration files

const fs = require('fs');
const path = require('path');

class ConfigSchemaLoader {
  static loadConfig(configPath) {
    try {
      // Resolve path relative to project root
      const resolvedPath = path.resolve(process.cwd(), configPath);
      
      // Check if file exists
      if (!fs.existsSync(resolvedPath)) {
        console.warn(`Config file not found: ${resolvedPath}`);
        return {};
      }

      // Read and parse JSON
      const rawContent = fs.readFileSync(resolvedPath, 'utf8');
      const config = JSON.parse(rawContent);
      
      return config;
    } catch (err) {
      console.error(`Failed to load config from ${configPath}:`, err.message);
      return {};
    }
  }

  static validateConfig(config, schema) {
    // Basic validation stub - extend as needed
    if (!config || typeof config !== 'object') {
      throw new Error('Invalid config: must be an object');
    }
    return true;
  }
}

module.exports = ConfigSchemaLoader;
