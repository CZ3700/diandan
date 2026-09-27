import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";

// Preloaded only in the owned Next fixture process and its children. No OS DNS changes.
// A publicly exposed instance maps each public hostname to its owned loopback address
// ("host=127.0.0.x"): web servers to their own address, every other host to the local edge.
const original = dns.lookup;
const originalPromise = dns.promises.lookup;
const fixtureHosts = new Map(
  [
    "admin.example.invalid",
    "storefront.example.invalid",
    "media.example.invalid",
  ].map((host) => [host, "127.0.0.1"]),
);
for (const entry of (process.env.LOCAL_EXPERIENCE_DNS_HOSTS ?? "").split(",")) {
  const [host, address = "127.0.0.1"] = entry.split("=");
  if (
    /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u.test(host ?? "") &&
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(address)
  )
    fixtureHosts.set(host, address);
}
function result(hostname, options) {
  const address = { address: fixtureHosts.get(hostname), family: 4 };
  return options?.all ? [address] : address;
}
dns.lookup = function lookup(hostname, options, callback) {
  if (!fixtureHosts.has(hostname))
    return original.call(this, hostname, options, callback);
  const resolvedCallback = typeof options === "function" ? options : callback;
  const resolved = result(hostname, options);
  process.nextTick(() =>
    options?.all
      ? resolvedCallback(null, resolved)
      : resolvedCallback(null, resolved.address, resolved.family),
  );
};
dns.promises.lookup = async function lookup(hostname, options) {
  return fixtureHosts.has(hostname)
    ? result(hostname, options)
    : originalPromise.call(this, hostname, options);
};
syncBuiltinESMExports();
