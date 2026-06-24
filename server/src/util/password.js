'use strict';
const crypto = require('crypto');

function hash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verify(password, stored) {
  try {
    const [scheme, salt, derived] = String(stored).split('$');
    if (scheme !== 'scrypt' || !salt || !derived) return false;
    const test = crypto.scryptSync(String(password), salt, 32);
    const ref = Buffer.from(derived, 'hex');
    return test.length === ref.length && crypto.timingSafeEqual(test, ref);
  } catch (e) { return false; }
}

module.exports = { hash, verify };
