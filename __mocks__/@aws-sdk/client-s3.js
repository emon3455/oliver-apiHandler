// Mock AWS SDK
module.exports = {
  S3Client: jest.fn(() => ({
    send: jest.fn(() => Promise.resolve({ ETag: 'mock-etag' }))
  })),
  PutObjectCommand: jest.fn()
};
