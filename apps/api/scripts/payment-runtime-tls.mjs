import { spawnSync } from "node:child_process";
import { Buffer } from "node:buffer";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import os from "node:os";
import path from "node:path";

const hosts = ["payments.example.invalid", "storefront.example.invalid"];
function openssl(args, cwd) {
  const result = spawnSync("openssl", args, { cwd, stdio: "ignore" });
  if (result.error || result.status !== 0)
    throw new Error("TEST payment TLS generation failed");
}
/** Two exact TEST SANs, private temporary keys, no OS trust or global TLS bypass. */
export async function createPaymentTestTls({ caDirectory } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "p404-payment-tls-"));
  try {
    const authority = caDirectory ?? directory;
    const caPath = path.join(authority, "ca.crt"),
      caKeyPath = path.join(authority, "ca.key");
    if (!caDirectory) {
      openssl(
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          caKeyPath,
          "-out",
          caPath,
          "-days",
          "2",
          "-subj",
          "/CN=P404 TEST only CA",
        ],
        directory,
      );
      await chmod(caKeyPath, 0o600);
    }
    const certificates = {};
    for (const hostname of hosts) {
      const leaf = path.join(directory, hostname);
      await mkdir(leaf);
      const certificatePath = path.join(leaf, "server.crt"),
        privateKeyPath = path.join(leaf, "server.key"),
        csr = path.join(leaf, "server.csr"),
        ext = path.join(leaf, "server.ext");
      await writeFile(
        ext,
        `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${hostname}\n`,
        { mode: 0o600, flag: "wx" },
      );
      openssl(
        [
          "req",
          "-new",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          privateKeyPath,
          "-out",
          csr,
          "-subj",
          `/CN=${hostname}`,
        ],
        directory,
      );
      openssl(
        [
          "x509",
          "-req",
          "-in",
          csr,
          "-CA",
          caPath,
          "-CAkey",
          caKeyPath,
          "-CAserial",
          path.join(directory, "authority.srl"),
          "-CAcreateserial",
          "-out",
          certificatePath,
          "-days",
          "2",
          "-sha256",
          "-extfile",
          ext,
        ],
        directory,
      );
      await chmod(privateKeyPath, 0o600);
      certificates[hostname] = { certificatePath, privateKeyPath };
    }
    const ca = await readFile(caPath);
    const fetcher = async (input, options = {}) => {
      const url = new globalThis.URL(input);
      if (
        url.protocol !== "https:" ||
        !hosts.includes(url.hostname) ||
        url.username ||
        url.password
      )
        throw new TypeError("Unapproved TEST TLS target");
      return new Promise((resolve, reject) => {
        const request = httpsRequest(
          {
            hostname: "127.0.0.1",
            port: Number(url.port || 443),
            servername: url.hostname,
            ca,
            rejectUnauthorized: true,
            path: url.pathname + url.search,
            method: options.method ?? "GET",
            headers: {
              ...Object.fromEntries(new globalThis.Headers(options.headers)),
              host: url.host,
            },
            signal: options.signal,
          },
          (response) => {
            const chunks = [];
            let size = 0;
            response.on("data", (chunk) => {
              size += chunk.length;
              if (size > 2_097_152)
                response.destroy(new Error("TEST TLS response bound"));
              else chunks.push(chunk);
            });
            response.on("error", reject);
            response.on("end", () => {
              const headers = new globalThis.Headers();
              for (const [key, value] of Object.entries(response.headers))
                for (const entry of Array.isArray(value)
                  ? value
                  : value === undefined
                    ? []
                    : [value])
                  headers.append(key, entry);
              resolve(
                new globalThis.Response(
                  [204, 304].includes(response.statusCode)
                    ? null
                    : Buffer.concat(chunks),
                  { status: response.statusCode, headers },
                ),
              );
            });
          },
        );
        request.on("error", reject);
        if (options.body !== undefined) request.write(options.body);
        request.end();
      });
    };
    return {
      directory,
      caPath,
      certificates,
      fetcher,
      close: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
