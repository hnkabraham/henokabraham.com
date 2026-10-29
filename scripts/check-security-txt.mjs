import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
// RFC 9116: Contact and Expires are required, and a file past its Expires
// date is to be ignored, so this fails a month ahead to leave time to renew.
const text = await readFile(
  new URL('../public/.well-known/security.txt', import.meta.url),
  'utf8',
);
const fields = text
  .split('\n')
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => line.split(/: (.*)/s));
for (const [name, value] of fields)
  assert.ok(
    ['Contact', 'Expires', 'Preferred-Languages', 'Canonical'].includes(name) &&
      value,
    `Unexpected line: ${name}`,
  );
const values = (name) =>
  fields.filter(([field]) => field === name).map(([, value]) => value);
assert.ok(values('Contact').length > 0, 'A Contact field is required');
for (const contact of values('Contact'))
  assert.match(
    contact,
    /^https:\/\//,
    'Contacts are HTTPS links, not addresses',
  );
assert.equal(values('Expires').length, 1, 'Exactly one Expires field');
const expires = Date.parse(values('Expires')[0]);
const days = (expires - Date.now()) / 86400000;
assert.ok(
  days > 30,
  `security.txt expires in ${Math.floor(days)} days: move Expires on (under a year ahead)`,
);
assert.ok(days < 366, 'Expires should be less than a year ahead');
assert.deepEqual(values('Canonical'), [
  'https://henokabraham.com/.well-known/security.txt',
]);
console.log(
  `security.txt passed: required fields, HTTPS contacts, expires in ${Math.floor(days)} days.`,
);
