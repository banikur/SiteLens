import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSessionToken,
  hashSecret,
  hashSessionToken,
  verifySecret,
} from '../src/server/auth/crypto.ts';

test('hashSecret and verifySecret validate matching passwords and reject wrong ones', () => {
  const hash = hashSecret('SiteLens#Pilot2026');
  assert.equal(verifySecret('SiteLens#Pilot2026', hash), true);
  assert.equal(verifySecret('WrongPassword', hash), false);
  assert.equal(verifySecret('SiteLens#Pilot2026', null), false);
});

test('hashSecret and verifySecret work for numeric field PINs', () => {
  const pinHash = hashSecret('482910');
  assert.equal(verifySecret('482910', pinHash), true);
  assert.equal(verifySecret('000000', pinHash), false);
});

test('generateSessionToken and hashSessionToken produce deterministic SHA-256 hashes', () => {
  const token = generateSessionToken();
  assert.equal(token.length, 64);
  const digest1 = hashSessionToken(token);
  const digest2 = hashSessionToken(token);
  assert.equal(digest1, digest2);
  assert.notEqual(digest1, token);
});

