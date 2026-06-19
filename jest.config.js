// Jest runs the data layer (db/, lib/) in plain Node against better-sqlite3,
// so the real SQL is exercised without the native expo-sqlite module. UI/RN
// code is intentionally out of scope here.
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/db", "<rootDir>/lib"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^expo-crypto$": "<rootDir>/__mocks__/expo-crypto.ts",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      { tsconfig: { module: "commonjs", esModuleInterop: true, strict: true } },
    ],
  },
};
