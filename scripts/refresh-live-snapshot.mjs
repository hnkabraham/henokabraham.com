import { refreshLiveData } from '../server/live.ts';
import { writeFile } from 'node:fs/promises';
const entries = [];
await refreshLiveData({
  put: async (key, value) => {
    entries.push({ key, value, expiration_ttl: 604800 });
  },
  get: async () => null,
});
if (entries.length !== 1)
  throw new Error(
    'The project feed must succeed before publishing the initial snapshot.',
  );
await writeFile(
  '/private/tmp/henok-live-snapshot.json',
  JSON.stringify(entries),
);
console.log(
  JSON.stringify(
    entries.map(({ key, value }) => ({ key, data: JSON.parse(value) })),
  ),
);
