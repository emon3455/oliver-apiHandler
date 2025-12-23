// Mock dotenv
module.exports = {
  config: jest.fn(() => ({ parsed: {} }))
};
