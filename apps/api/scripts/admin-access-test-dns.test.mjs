import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { URL } from "node:url";
import test from "node:test";

test("owned Next child resolves only the reserved Admin hostname through scoped callback and promise DNS APIs", () => {
  const helper = new URL("./admin-access-test-dns.mjs", import.meta.url);
  assert.ok(existsSync(helper), "scoped Admin fixture DNS exists");
  const program = `
    import assert from 'node:assert/strict';
    import dns from 'node:dns';
    const forwarded = [];
    dns.lookup = (hostname, options, callback) => {
      forwarded.push(hostname);
      (typeof options === 'function' ? options : callback)(null, '198.51.100.1', 4);
    };
    dns.promises.lookup = async hostname => { forwarded.push(hostname); return { address: '198.51.100.1', family: 4 }; };
    await import(${JSON.stringify(helper.href)});
    const one = { address: '127.0.0.1', family: 4 };
    assert.deepEqual(await dns.promises.lookup('admin.example.invalid'), one);
    assert.deepEqual(await dns.promises.lookup('admin.example.invalid', { all: true }), [one]);
    await new Promise((resolve, reject) => dns.lookup('admin.example.invalid', (error, address, family) => {
      try { assert.ifError(error); assert.deepEqual({ address, family }, one); resolve(); } catch (failure) { reject(failure); }
    }));
    await new Promise((resolve, reject) => dns.lookup('admin.example.invalid', { all: true }, (error, addresses) => {
      try { assert.ifError(error); assert.deepEqual(addresses, [one]); resolve(); } catch (failure) { reject(failure); }
    }));
    await dns.promises.lookup('other.example.invalid');
    await new Promise(resolve => dns.lookup('other.example.invalid', resolve));
    assert.deepEqual(forwarded, ['other.example.invalid', 'other.example.invalid']);
    process.stdout.write('SCOPED_DNS_PASS');
  `;
  assert.equal(
    execFileSync(process.execPath, ["--input-type=module", "--eval", program], {
      encoding: "utf8",
    }),
    "SCOPED_DNS_PASS",
  );
});
