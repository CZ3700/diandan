import assert from "node:assert/strict";
import { createServer } from "node:http";
import { request } from "node:https";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { loadLocalState } from "../../../scripts/local-experience-state.mjs";
import { prepareLocalTls, startLocalProxy } from "./local-experience-tls.mjs";
test("TLS gateway forwards an actual owned WebSocket upgrade and bytes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fan-local-upgrade-"));
  const resources = [];
  t.after(async () => {
    for (const close of resources.reverse()) await close();
    await rm(root, { recursive: true, force: true });
  });
  const state = await loadLocalState(root, "test");
  await prepareLocalTls(state);
  const sockets = new Set();
  const backend = createServer();
  backend.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  backend.on("upgrade", (_req, socket) => {
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
    );
    socket.on("data", (bytes) => socket.write(bytes));
  });
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  resources.push(
    () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        backend.close(resolve);
      }),
  );
  await startLocalProxy({
    config: state.config,
    origin: `https://localhost:${state.config.ports.admin}`,
    port: state.config.ports.admin,
    target: `http://127.0.0.1:${backend.address().port}`,
    own: (_name, close) => resources.push(close),
    name: "test TLS",
  });
  const ca = await readFile(state.config.tls.caCertificatePath);
  const response = await new Promise((resolve, reject) => {
    const req = request(
      `https://localhost:${state.config.ports.admin}/_next/hmr`,
      {
        ca,
        hostname: "127.0.0.1",
        servername: "localhost",
        headers: {
          host: `localhost:${state.config.ports.admin}`,
          connection: "Upgrade",
          upgrade: "websocket",
        },
        timeout: 1000,
      },
    );
    req.end();
    req.on("upgrade", (_response, socket) => {
      socket.once("data", (bytes) => {
        socket.destroy();
        resolve(bytes.toString());
      });
      socket.write("owned-ping");
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Upgrade did not complete")));
  });
  assert.equal(response, "owned-ping");
});

test("the TLS gateway binds only an owned loopback address", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "fan-local-bind-"));
  const resources = [];
  t.after(async () => {
    for (const close of resources.reverse()) await close();
    await rm(root, { recursive: true, force: true });
  });
  const state = await loadLocalState(root, "test");
  await prepareLocalTls(state);
  const input = {
    config: state.config,
    port: 0,
    origin: state.config.origins.admin,
    target: "http://127.0.0.1:9",
    own: (_name, close) => resources.push(close),
    name: "bind fixture",
  };
  const server = await startLocalProxy({ ...input, address: "127.0.0.2" });
  assert.equal(server.address().address, "127.0.0.2");
  assert.equal((await startLocalProxy(input)).address().address, "127.0.0.1");
  for (const address of [
    "0.0.0.0",
    "10.0.0.5",
    "172.26.5.34",
    "::",
    "::1",
    "localhost",
    "127.0.0.256",
  ])
    await assert.rejects(
      startLocalProxy({ ...input, address }),
      /loopback address/u,
      address,
    );
  assert.equal(resources.length, 2);
});
