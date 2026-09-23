import assert from "node:assert/strict";
import test from "node:test";
import { createLocalLifecycle } from "./local-experience-lifecycle.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test("stop during startup waits for late resources and drains them in reverse ownership order", async () => {
  const lifecycle = createLocalLifecycle(),
    entered = deferred(),
    resume = deferred(),
    events = [];
  lifecycle.own("early", async () => {
    events.push("early");
  });
  const starting = lifecycle.start(async () => {
    entered.resolve();
    await resume.promise;
    lifecycle.own("late", async () => {
      events.push("late");
    });
    lifecycle.checkStarting();
    events.push("unexpected continued startup");
  });
  const rejection = assert.rejects(starting, /stopping/);
  await entered.promise;
  let stopped = false;
  const stopping = lifecycle.stop().then((result) => {
    stopped = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(stopped, false);
  assert.deepEqual(events, []);
  resume.resolve();
  await rejection;
  assert.deepEqual(await stopping, []);
  assert.deepEqual(events, ["late", "early"]);
  assert.deepEqual(await lifecycle.stop(), []);
});
test("startup failure does not deadlock cleanup and individual cleanup failures preserve later cleanup", async () => {
  const lifecycle = createLocalLifecycle(),
    closed = [];
  await assert.rejects(
    lifecycle.start(async () => {
      lifecycle.own("database", async () => {
        closed.push("database");
      });
      lifecycle.own("failed service", async () => {
        throw new Error("synthetic");
      });
      throw new Error("synthetic start failure");
    }),
    /synthetic start failure/,
  );
  assert.deepEqual(await lifecycle.stop(), ["failed service"]);
  assert.deepEqual(closed, ["database"]);
});
