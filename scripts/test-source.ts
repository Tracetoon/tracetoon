import { resolve } from 'node:path';
import { prepareDependencies } from './dependencies.ts';
import {
  longestFirst,
  parseShard,
  readTestTimes,
  runTestFiles,
  shardFiles,
  sourceTestFiles,
  TEST_FILE_WORKERS,
  writeTestTimes,
} from './test-files.ts';
const root = resolve(import.meta.dir, '..');
prepareDependencies();
const args = process.argv.slice(2);
const times = readTestTimes(root);
// CI splits the files across machines (TRACETOON_TEST_SHARD=i/n); unset runs them all.
const shard = parseShard(process.env.TRACETOON_TEST_SHARD);
const files = shard
  ? shardFiles(root, sourceTestFiles(root), times, shard)
  : longestFirst(root, sourceTestFiles(root), times);
if (shard)
  console.log(`Shard ${shard.index}/${shard.count}: ${files.length} test files.`);
const results = await runTestFiles({ root, files, args });
// A filtered run (extra bun arguments) does not represent a file's full time.
if (!args.length) writeTestTimes(root, results);
const failed = results.filter((r) => r.code !== 0);
console.log(
  `Source test files: ${results.length - failed.length} passed, ${failed.length} failed (up to ${TEST_FILE_WORKERS} fresh processes).`,
);
// Exit explicitly after flushing: Bun on Windows can fail to exit on its own.
await new Promise<void>((done) => process.stdout.write('', () => done()));
process.exit(failed.length ? 1 : 0);
