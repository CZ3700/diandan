import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";

// Preloaded only in the owned production Next acceptance process, never OS DNS.
const names = new Set(["admin.example.invalid", "api.example.invalid"]);
const lookup = dns.lookup;
const promiseLookup = dns.promises.lookup;
const result = (options) =>
  options?.all
    ? [{ address: "127.0.0.1", family: 4 }]
    : { address: "127.0.0.1", family: 4 };
dns.lookup = function (hostname, options, callback) {
  if (!names.has(hostname))
    return lookup.call(this, hostname, options, callback);
  const cb = typeof options === "function" ? options : callback;
  process.nextTick(() =>
    options?.all ? cb(null, result(options)) : cb(null, "127.0.0.1", 4),
  );
};
dns.promises.lookup = async function (hostname, options) {
  return names.has(hostname)
    ? result(options)
    : promiseLookup.call(this, hostname, options);
};
syncBuiltinESMExports();
