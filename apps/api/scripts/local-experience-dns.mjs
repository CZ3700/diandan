import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";

// Preloaded only in the owned Next fixture process and its children. No OS DNS changes.
const original = dns.lookup;
const originalPromise = dns.promises.lookup;
const fixtureHosts = new Set([
  "admin.example.invalid",
  "storefront.example.invalid",
  "media.example.invalid",
]);
function result(options) {
  const address = { address: "127.0.0.1", family: 4 };
  return options?.all ? [address] : address;
}
dns.lookup = function lookup(hostname, options, callback) {
  if (!fixtureHosts.has(hostname))
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
  return fixtureHosts.has(hostname)
    ? result(options)
    : originalPromise.call(this, hostname, options);
};
syncBuiltinESMExports();
