import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request, type RequestOptions } from "node:https";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
/** Owned TEST CA and exact SAN, never changes system trust or disables TLS verification. */
export async function tlsHarness(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
) {
  const directory = await mkdtemp(join(tmpdir(), "gateway-conformance-"));
  const run = (args: string[]) => {
    const result = spawnSync("openssl", args, {
      cwd: directory,
      stdio: "ignore",
    });
    if (result.status !== 0)
      throw new Error("TEST certificate generation failed");
  };
  try {
    run([
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      "ca.key",
      "-out",
      "ca.crt",
      "-days",
      "1",
      "-subj",
      "/CN=Gateway TEST CA",
    ]);
    await writeFile(
      join(directory, "leaf.ext"),
      "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:gateway.example.invalid\n",
    );
    run([
      "req",
      "-new",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      "leaf.key",
      "-out",
      "leaf.csr",
      "-subj",
      "/CN=gateway.example.invalid",
    ]);
    run([
      "x509",
      "-req",
      "-in",
      "leaf.csr",
      "-CA",
      "ca.crt",
      "-CAkey",
      "ca.key",
      "-CAcreateserial",
      "-out",
      "leaf.crt",
      "-days",
      "1",
      "-extfile",
      "leaf.ext",
    ]);
    await chmod(join(directory, "ca.key"), 0o600);
    await chmod(join(directory, "leaf.key"), 0o600);
    const ca = await readFile(join(directory, "ca.crt"));
    const server = createServer(
      {
        key: await readFile(join(directory, "leaf.key")),
        cert: await readFile(join(directory, "leaf.crt")),
      },
      handler,
    );
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("TEST listener missing");
    const fetcher =
      (trust = true): typeof fetch =>
      async (input, init) => {
        const url = new URL(String(input));
        const options: RequestOptions = {
          hostname: "127.0.0.1",
          port: address.port,
          servername: url.hostname,
          rejectUnauthorized: true,
          ...(trust ? { ca } : {}),
          path: url.pathname + url.search,
          method: init?.method,
          headers: {
            ...Object.fromEntries(new Headers(init?.headers)),
            host: url.host,
          },
          signal: init?.signal ?? undefined,
        };
        return new Promise((resolve, reject) => {
          const outgoing = request(options, (response) => {
            const headers = new Headers();
            for (const [name, values] of Object.entries(response.headers))
              for (const value of Array.isArray(values)
                ? values
                : values === undefined
                  ? []
                  : [values])
                headers.append(name, value);
            resolve(
              new Response(
                Readable.toWeb(
                  response,
                ) as unknown as ReadableStream<Uint8Array>,
                { status: response.statusCode ?? 500, headers },
              ),
            );
          });
          outgoing.on("error", reject);
          if (init?.body) outgoing.write(init.body);
          outgoing.end();
        });
      };
    return {
      origin: `https://gateway.example.invalid:${address.port}`,
      fetcher,
      close: async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
