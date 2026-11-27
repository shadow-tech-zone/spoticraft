/* DES FIPS 46-3 published test vectors + JioSaavn round-trip. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { desEncryptBlock, desEncryptEcb, decryptSaavnUrl } from '../src/des.js';

test('FIPS vector: key 133457799BBCDFF1, pt 0123456789ABCDEF', () => {
  const out = desEncryptBlock(
    Buffer.from('0123456789ABCDEF', 'hex'),
    Buffer.from('133457799BBCDFF1', 'hex'),
  ).toString('hex').toUpperCase();
  assert.equal(out, '85E813540F0AB405');
});

test('FIPS vector: key 0123456789ABCDEF, pt "Now is t"', () => {
  const out = desEncryptBlock(
    Buffer.from('Now is t', 'utf8'),
    Buffer.from('0123456789ABCDEF', 'hex'),
  ).toString('hex').toUpperCase();
  assert.equal(out, '3FA40E8A984D4815');
});

test('saavn encrypted url round-trip', () => {
  const url = 'https://aac.saavncdn.com/012/abc123_96.mp4';
  const enc = desEncryptEcb(Buffer.from(url, 'utf8'), '38346591').toString('base64');
  assert.equal(decryptSaavnUrl(enc), url);
});
