#!/usr/bin/env node
/**
 * Proves that scripts/handshake.mjs can fail. It runs the check against a stand-in bundle that
 * answers correctly (must pass) and against stand-ins with a planted fault (must fail): a missing
 * file, an empty file, a bundle that never answers, a truncated frame, a frame that is not JSON,
 * a reply of the wrong type and a reply for another request.
 *
 * Usage: node scripts/handshake.selftest.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = join(HERE, "handshake.mjs");
const dir = mkdtempSync(join(tmpdir(), "yad-handshake-selftest-"));

const frame = (obj) =>
  `const j=Buffer.from(${JSON.stringify(JSON.stringify(obj))});const h=Buffer.alloc(4);h.writeUInt32LE(j.length,0);process.stdout.write(Buffer.concat([h,j]));`;
const keepAlive = "setInterval(()=>{},1000);";

// Reads the request frame from stdin and answers it the way the real companion does.
const goodBundle =
  "let b=Buffer.alloc(0);process.stdin.on('data',c=>{b=Buffer.concat([b,c]);if(b.length<4)return;" +
  "const n=b.readUInt32LE(0);if(b.length<4+n)return;const id=JSON.parse(b.subarray(4,4+n).toString()).id;" +
  "const j=Buffer.from(JSON.stringify({type:'HELLO_ACK',correlationId:id}));const h=Buffer.alloc(4);" +
  "h.writeUInt32LE(j.length,0);process.stdout.write(Buffer.concat([h,j]));});" +
  keepAlive;

const cases = [
  { name: "correct reply", source: goodBundle, expectExit: 0 },
  { name: "missing file", source: null, expectExit: 1 },
  { name: "empty file", source: "", expectExit: 1 },
  { name: "never answers", source: keepAlive, expectExit: 1 },
  { name: "truncated frame", source: `const h=Buffer.alloc(4);h.writeUInt32LE(500,0);process.stdout.write(Buffer.concat([h,Buffer.from('{"type":"HELLO_ACK"')]));${keepAlive}`, expectExit: 1 },
  { name: "reply is not JSON", source: `const j=Buffer.from('not json');const h=Buffer.alloc(4);h.writeUInt32LE(j.length,0);process.stdout.write(Buffer.concat([h,j]));${keepAlive}`, expectExit: 1 },
  { name: "wrong reply type", source: frame({ type: "ERROR", correlationId: "hs-1" }) + keepAlive, expectExit: 1 },
  { name: "reply for another request", source: frame({ type: "HELLO_ACK", correlationId: "other" }) + keepAlive, expectExit: 1 },
];

let failures = 0;
try {
  cases.forEach((c, i) => {
    const file = join(dir, `bundle-${i}.js`);
    if (c.source !== null) writeFileSync(file, c.source);
    const run = spawnSync(process.execPath, [CHECK, file], {
      encoding: "utf8",
      env: { ...process.env, YAD_HANDSHAKE_TIMEOUT_MS: "2500" },
      timeout: 30_000,
    });
    const ok = run.status === c.expectExit;
    console.log(`${ok ? "OK  " : "FAIL"} ${c.name}: exit ${run.status}, expected ${c.expectExit}`);
    if (!ok) {
      failures++;
      console.log((run.stdout + run.stderr).trim().split("\n").slice(0, 3).join("\n"));
    }
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} self-test case(s) failed.`);
  process.exit(1);
}
console.log("\nAll self-test cases behaved as expected.");
