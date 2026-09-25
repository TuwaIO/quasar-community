import '@testing-library/jest-dom';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.PAYLOAD_SECRET = 'a'.repeat(32);
