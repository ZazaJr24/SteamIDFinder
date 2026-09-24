// Builds release/CubeCraftLegends.zip: the built game plus start scripts.
import { readdirSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';

const NAME = 'CubeCraftLegends';
const files = {};
const walk = (dir) =>
  readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
for (const f of walk('dist')) files[`${NAME}/game/${relative('dist', f).split('\\').join('/')}`] = readFileSync(f);
const crlf = (name) => new TextEncoder().encode(readFileSync(join('package', name), 'utf8').replace(/\r?\n/g, '\r\n'));
files[`${NAME}/start.bat`] = crlf('start.bat');
files[`${NAME}/server.ps1`] = crlf('server.ps1');
files[`${NAME}/LIESMICH.txt`] = crlf('LIESMICH.txt');
files[`${NAME}/start.sh`] = [readFileSync(join('package', 'start.sh')), { os: 3, attrs: 0o100755 << 16 }];
mkdirSync('release', { recursive: true });
const zip = zipSync(files, { level: 9 });
writeFileSync(`release/${NAME}.zip`, zip);
console.log(`release/${NAME}.zip (${(zip.length / 1024 / 1024).toFixed(2)} MB, ${Object.keys(files).length} files)`);
