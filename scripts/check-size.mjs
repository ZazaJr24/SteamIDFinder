// Verifies the production build against the CrazyGames limits.
// Hard limits: < 1500 files, total <= 250 MB, initial download <= 50 MB
// (<= 20 MB for the mobile homepage). Our own budget is stricter.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = 'dist';
const MAX_FILES = 1500;
const MAX_TOTAL_MB = 20; // fail: keeps us eligible for the mobile homepage
const TARGET_TOTAL_MB = 10; // warn: our own budget

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

let files;
try {
  files = walk(DIST);
} catch {
  console.error(`No ${DIST}/ folder. Run "npm run build" first.`);
  process.exit(1);
}

const sizes = files.map((f) => ({ file: relative(DIST, f), bytes: statSync(f).size }));
const total = sizes.reduce((sum, s) => sum + s.bytes, 0);
const mb = total / 1024 / 1024;

console.log(`Files: ${files.length} (limit ${MAX_FILES})`);
console.log(`Total: ${mb.toFixed(2)} MB (limit ${MAX_TOTAL_MB} MB, target ${TARGET_TOTAL_MB} MB)`);
for (const s of sizes.sort((a, b) => b.bytes - a.bytes).slice(0, 8)) {
  console.log(`  ${(s.bytes / 1024).toFixed(1).padStart(9)} KB  ${s.file}`);
}

let failed = false;
if (files.length >= MAX_FILES) {
  console.error(`FAIL: ${files.length} files, CrazyGames allows fewer than ${MAX_FILES}.`);
  failed = true;
}
if (mb > MAX_TOTAL_MB) {
  console.error(`FAIL: build is ${mb.toFixed(2)} MB, budget is ${MAX_TOTAL_MB} MB.`);
  failed = true;
} else if (mb > TARGET_TOTAL_MB) {
  console.warn(`WARN: build is above the ${TARGET_TOTAL_MB} MB target.`);
}
process.exit(failed ? 1 : 0);
