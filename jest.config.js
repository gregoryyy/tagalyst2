/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'jsdom',
    roots: ['<rootDir>/src', '<rootDir>/test'],
    moduleNameMapper: {
        '^chrome$': '<rootDir>/test/mocks/chrome.ts',
    },
    setupFilesAfterEnv: ['<rootDir>/test/setupJest.ts'],
    testPathIgnorePatterns: [
        '/node_modules/',
        '<rootDir>/dist/',
        '<rootDir>/content/',
        '<rootDir>/options/',
    ],
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
};
