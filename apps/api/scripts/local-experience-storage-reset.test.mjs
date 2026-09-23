import assert from "node:assert/strict";
import test from "node:test";
import { resetLocalStorage } from "./local-experience-storage.mjs";

const instanceId = "ba4116c7-8c35-4289-9f26-6569e321774b";
const stateDirectory = "/owned/local-test";
const config = { instanceId };
function container({
  running = false,
  label = instanceId,
  mount = stateDirectory + "/media",
} = {}) {
  return {
    Config: { Labels: { "com.fan-support.local-instance": label } },
    State: { Running: running },
    Mounts: [{ Type: "bind", Source: mount, Destination: "/data" }],
  };
}
function fixture(value) {
  const calls = [];
  return {
    calls,
    execute: async (binary, args) => {
      calls.push([binary, ...args]);
      return { stdout: JSON.stringify([value]) };
    },
  };
}
test("confirmed reset removes only the exact stopped owned storage container", async () => {
  const io = fixture(container());
  await resetLocalStorage({
    config,
    stateDirectory,
    confirmation: instanceId,
    execute: io.execute,
  });
  assert.deepEqual(io.calls, [
    ["docker", "inspect", "fan-local-s3-" + instanceId],
    ["docker", "rm", "fan-local-s3-" + instanceId],
  ]);
});
test("incorrect confirmation, foreign ownership, running container and moved bind mounts fail closed", async () => {
  for (const [confirmation, value] of [
    ["wrong", container()],
    [instanceId, container({ running: true })],
    [instanceId, container({ label: "foreign" })],
    [instanceId, container({ mount: "/foreign" })],
  ]) {
    const io = fixture(value);
    await assert.rejects(
      resetLocalStorage({
        config,
        stateDirectory,
        confirmation,
        execute: io.execute,
      }),
    );
    assert.equal(
      io.calls.some((call) => call[1] === "rm"),
      false,
    );
    if (confirmation === "wrong") assert.equal(io.calls.length, 0);
  }
});
test("Docker unavailable and removal failure do not report reset success; a missing container is safe", async () => {
  const missing = Object.assign(new Error("missing"), {
    stderr: "Error: No such object: owned",
  });
  await resetLocalStorage({
    config,
    stateDirectory,
    confirmation: instanceId,
    execute: async () => {
      throw missing;
    },
  });
  await assert.rejects(
    resetLocalStorage({
      config,
      stateDirectory,
      confirmation: instanceId,
      execute: async () => {
        throw new Error("Docker unavailable");
      },
    }),
    /Docker|storage/,
  );
  let calls = 0;
  await assert.rejects(
    resetLocalStorage({
      config,
      stateDirectory,
      confirmation: instanceId,
      execute: async () => {
        if (calls++) throw new Error("container started concurrently");
        return { stdout: JSON.stringify([container()]) };
      },
    }),
  );
});
