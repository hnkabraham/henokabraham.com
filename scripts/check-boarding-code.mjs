// The boarding pass's QR codes (lib/boarding-code.ts): every board link
// encodes, fits the stub's version 4, and carries the fixed patterns a reader
// looks for. On a Mac each code is also read back by Apple's Vision decoder
// (check-boarding-code.swift), which must return the link exactly; elsewhere
// that step is skipped and says so.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';

const compile = async (path, links = {}) => {
  let code = ts.transpileModule(
    await readFile(new URL(path, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  for (const [from, to] of Object.entries(links))
    code = code.replaceAll(`from '${from}'`, `from '${to}'`);
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
};
const { boardingCode, boardingCodePath } = await import(
  await compile('../lib/boarding-code.ts')
);
const { flights } = await import(
  await compile('../app/flight-data.ts', {
    './watch-face-data': await compile('../app/watch-face-data.ts'),
  })
);
const { boardingLink } = await import(
  await compile('../lib/flight-links.ts', {
    './bay-flight': 'data:text/javascript,export{}',
    './dreamliner-tour': 'data:text/javascript,export const TOUR_CHAPTERS=[]',
  })
);

const links = flights.map((flight) => boardingLink(flight.id));
const codes = links.map((link) => boardingCode(link));
for (const [i, modules] of codes.entries()) {
  assert.equal(modules.length, 33, `${links[i]} fits version 4 (33 modules)`);
  assert.ok(modules.every((row) => row.length === 33));
  // The three finders: a dark 7x7 ring around a light ring around a dark core.
  for (const [x0, y0] of [
    [0, 0],
    [26, 0],
    [0, 26],
  ])
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 7; x++) {
        const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        assert.equal(
          modules[y0 + y][x0 + x],
          ring !== 2,
          `finder at ${x0},${y0}`,
        );
      }
  assert.equal(modules[33 - 8][8], true, 'the dark module');
  assert.match(boardingCodePath(modules), /^(M\d+ \d+h\d+v1h-\d+z)+$/);
}
let read = 'skipped (needs macOS for Apple Vision)';
if (platform() === 'darwin') {
  const binary = join(tmpdir(), 'check-boarding-code');
  execFileSync('swiftc', [
    '-O',
    new URL('./check-boarding-code.swift', import.meta.url).pathname,
    '-o',
    binary,
  ]);
  const input = codes
    .map((modules) => modules.map((row) => row.map(Number).join('')).join('\n'))
    .join('\n\n');
  const decoded = execFileSync(binary, { input: `${input}\n` })
    .toString()
    .trim()
    .split('\n');
  assert.deepEqual(decoded, links, 'Vision reads every link back exactly');
  read = 'read back by Apple Vision';
}
console.log(
  `Boarding codes: ${links.length} links encoded at version 4, fixed patterns in place, ${read}.`,
);
