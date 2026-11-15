/**
 * Durable outbox for call reports: a report is never lost when the platform API is
 * down, survives a restart, is sent once at a time, and bad reports are set aside.
 * Run: node test/usageOutbox.test.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const createUsageOutbox = require("../services/usageOutbox");

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`       ${err.message}`);
    process.exitCode = 1;
  }
}

const silent = { info() {}, warn() {}, error() {} };
function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "outbox-")), "usage-outbox.json");
}
function onDisk(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

(async () => {
  console.log("usage outbox\n");

  await check("a report the platform accepts is sent once and removed", async () => {
    const file = tempFile();
    const sent = [];
    const box = createUsageOutbox({ filePath: file, logger: silent, send: async (kind, p) => (sent.push([kind, p]), { ok: true }) });
    await box.enqueue("usage", { callSid: "CA1", secondsConsumed: 60 }, "usage:CA1");
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(box.size(), 0);
    assert.deepStrictEqual(onDisk(file), []);
  });

  await check("platform down: the report stays on disk and is retried until it goes through", async () => {
    const file = tempFile();
    let clock = 1000;
    let up = false;
    const calls = [];
    const box = createUsageOutbox({
      filePath: file,
      logger: silent,
      now: () => clock,
      baseDelayMs: 5000,
      send: async (kind, p) => {
        calls.push(p.callSid);
        return up ? { ok: true } : { ok: false, error: "ECONNREFUSED" };
      },
    });
    await box.enqueue("usage", { callSid: "CA2", secondsConsumed: 90 }, "usage:CA2");
    assert.strictEqual(box.size(), 1);
    assert.strictEqual(onDisk(file).length, 1);
    clock += 1000;
    await box.flushDue(); // not due yet (5 s pause)
    assert.strictEqual(calls.length, 1);
    clock += 5000;
    await box.flushDue(); // due, still down: next pause 10 s
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(box.pending()[0].attempts, 2);
    up = true;
    clock += 10000;
    await box.flushDue();
    assert.strictEqual(calls.length, 3);
    assert.strictEqual(box.size(), 0);
    assert.deepStrictEqual(onDisk(file), []);
  });

  await check("a server error or rate limit is retried, never dropped", async () => {
    for (const status of [500, 502, 503, 409, 429, 401]) {
      const box = createUsageOutbox({ filePath: tempFile(), logger: silent, send: async () => ({ ok: false, status }) });
      await box.enqueue("usage", { callSid: `CA_${status}` });
      assert.strictEqual(box.size(), 1, String(status));
    }
  });

  await check("reports waiting when the server restarts are sent by the new process", async () => {
    const file = tempFile();
    const first = createUsageOutbox({ filePath: file, logger: silent, send: async () => ({ ok: false, error: "down" }) });
    await first.enqueue("usage", { callSid: "CA3", secondsConsumed: 30 }, "usage:CA3");
    await first.enqueue("trial", { callSid: "CA4", secondsConsumed: 40 }, "trial:CA4");
    first.stop();
    const sent = [];
    const second = createUsageOutbox({ filePath: file, logger: silent, send: async (kind, p) => (sent.push(`${kind}:${p.callSid}`), { ok: true }) });
    second.start();
    await new Promise((r) => setTimeout(r, 50));
    second.stop();
    assert.deepStrictEqual(sent.sort(), ["trial:CA4", "usage:CA3"]);
    assert.strictEqual(second.size(), 0);
  });

  await check("the same call queued twice is one report", async () => {
    let sends = 0;
    const box = createUsageOutbox({ filePath: tempFile(), logger: silent, send: async () => (sends++, { ok: false, error: "down" }) });
    await box.enqueue("usage", { callSid: "CA5" }, "usage:CA5");
    await box.enqueue("usage", { callSid: "CA5" }, "usage:CA5");
    assert.strictEqual(box.size(), 1);
  });

  await check("a report is never sent twice at the same time", async () => {
    let inFlight = 0;
    let most = 0;
    const box = createUsageOutbox({
      filePath: tempFile(),
      logger: silent,
      now: () => 0,
      send: async () => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight -= 1;
        return { ok: false, error: "slow" };
      },
    });
    await Promise.all([box.enqueue("usage", { callSid: "CA6" }, "usage:CA6"), box.flushDue(), box.flushDue()]);
    assert.strictEqual(most, 1);
  });

  await check("a report the platform rejects as invalid goes to the dead-letter file", async () => {
    const file = tempFile();
    const box = createUsageOutbox({ filePath: file, logger: silent, send: async () => ({ ok: false, status: 404, error: "User not found" }) });
    await box.enqueue("usage", { callSid: "CA7", userId: "gone" }, "usage:CA7");
    assert.strictEqual(box.size(), 0);
    const dead = fs.readFileSync(`${file}.dead`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.strictEqual(dead[0].id, "usage:CA7");
    assert.strictEqual(dead[0].status, 404);
  });

  await check("pauses grow and stop at 10 minutes", async () => {
    let clock = 0;
    const box = createUsageOutbox({ filePath: tempFile(), logger: silent, now: () => clock, send: async () => ({ ok: false, error: "down" }) });
    await box.enqueue("usage", { callSid: "CA8" }, "usage:CA8");
    for (let i = 0; i < 12; i++) {
      clock = box.pending()[0].nextAt;
      await box.flushDue();
    }
    const item = box.pending()[0];
    assert.strictEqual(item.nextAt - clock, 10 * 60 * 1000);
  });

  console.log(`\n${passed} passed`);
})();
