/**
 * MemoryCache bounds (Phase 1: never grow without limit on a long-running server).
 * Run: node test/cache.test.js
 */
const assert = require("assert");
const { MemoryCache } = require("../services/cache");

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`       ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("MemoryCache\n");

check("default constructor still works (existing callers)", () => {
  const cache = new MemoryCache();
  cache.set("a", 1, 60000);
  assert.strictEqual(cache.get("a"), 1);
});

check("size stays within maxEntries, oldest evicted first", () => {
  const cache = new MemoryCache({ maxEntries: 3 });
  for (const k of ["a", "b", "c", "d", "e"]) cache.set(k, k, 60000);
  assert.strictEqual(cache.store.size, 3);
  assert.strictEqual(cache.get("a"), null);
  assert.strictEqual(cache.get("b"), null);
  assert.strictEqual(cache.get("e"), "e");
});

check("expired entries are purged before evicting live ones", () => {
  let clock = 0;
  const cache = new MemoryCache({ maxEntries: 2, now: () => clock });
  cache.set("a", "keep", 10000);
  cache.set("b", "short", 1000);
  clock = 2000;
  cache.set("c", "new", 10000);
  assert.strictEqual(cache.get("a"), "keep");
  assert.strictEqual(cache.get("c"), "new");
  assert.strictEqual(cache.store.has("b"), false);
});

check("overwriting a key does not evict others", () => {
  const cache = new MemoryCache({ maxEntries: 2 });
  cache.set("a", 1, 60000);
  cache.set("b", 2, 60000);
  cache.set("a", 3, 60000);
  assert.strictEqual(cache.get("a"), 3);
  assert.strictEqual(cache.get("b"), 2);
});

if (!process.exitCode) console.log(`\nAll ${passed} checks passed`);
