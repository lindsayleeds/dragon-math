const crypto = require('crypto');

// Shared join-code generation for classrooms and tribes.
//
// Unambiguous alphabet — no 0/O/1/I/L so a code read off a board or screen is
// typeable without confusion.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 6;

function randomCode() {
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return out;
}

module.exports = { CODE_ALPHABET, CODE_LEN, randomCode };
