// Mock moment
module.exports = () => ({
  format: (fmt) => '2025-12-23 10:00:00',
  valueOf: () => 1703329200000,
  unix: () => 1703329200,
  toISOString: () => '2025-12-23T10:00:00.000Z'
});

module.exports.tz = () => ({
  format: (fmt) => '2025-12-23 10:00:00',
  valueOf: () => 1703329200000,
  unix: () => 1703329200,
  toISOString: () => '2025-12-23T10:00:00.000Z'
});
