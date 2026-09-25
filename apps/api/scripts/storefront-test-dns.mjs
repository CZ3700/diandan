import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";

// Loaded only by the owned Next harness process. The operating system DNS and
// every hostname except this reserved fixture name retain their normal behavior.
const original = dns.lookup;
const originalPromise = dns.promises.lookup;
function result(options) {
  return options?.all
    ? [{ address: "127.0.0.1", family: 4 }]
    : { address: "127.0.0.1", family: 4 };
}
dns.lookup = function lookup(hostname, options, callback) {
  if (hostname !== "media.example.invalid")
    return original.call(this, hostname, options, callback);
  const resolvedCallback = typeof options === "function" ? options : callback;
  const resolved = result(options);
  process.nextTick(() =>
    options?.all
      ? resolvedCallback(null, resolved)
      : resolvedCallback(null, resolved.address, resolved.family),
  );
};
dns.promises.lookup = async function lookup(hostname, options) {
  return hostname === "media.example.invalid"
    ? result(options)
    : originalPromise.call(this, hostname, options);
};
syncBuiltinESMExports();
