import { describe, expect, test } from "vitest";

import {
  withEphemeralPostgres,
  type DockerCommandExecutor,
} from "./ephemeral-postgres.js";

describe("withEphemeralPostgres", () => {
  test("keeps credentials out of Docker arguments and removes only its labelled container", async () => {
    const calls: Array<
      Readonly<{
        arguments_: readonly string[];
        environment: Readonly<Record<string, string | undefined>>;
      }>
    > = [];
    let expectedLabels: Readonly<Record<string, string>> = {};
    const docker: DockerCommandExecutor = {
      run: async (arguments_, environment = {}) => {
        calls.push({ arguments_, environment });
        if (arguments_[0] === "run") {
          const labelValues = arguments_
            .map((value, index) =>
              arguments_[index - 1] === "--label" ? value : undefined,
            )
            .filter((value): value is string => value !== undefined)
            .map((value) => value.split("=", 2))
            .filter((parts): parts is [string, string] => parts.length === 2);
          expectedLabels = Object.fromEntries(labelValues);
          return { stdout: "container-id\n" };
        }
        if (arguments_[0] === "port") {
          return { stdout: "127.0.0.1:49152\n" };
        }
        if (arguments_[0] === "inspect") {
          return { stdout: `${JSON.stringify(expectedLabels)}\n` };
        }
        if (arguments_[0] === "rm") {
          return { stdout: "removed\n" };
        }
        throw new Error("unexpected docker call");
      },
    };

    await expect(
      withEphemeralPostgres(
        async (clientConfig) => {
          expect(clientConfig).toMatchObject({
            host: "127.0.0.1",
            port: 49_152,
            user: "fan_support_test",
            database: "fan_support_test",
          });
          expect(clientConfig.password).toMatch(/^[a-f0-9]{64}$/u);
          return "verified";
        },
        {
          docker,
          readinessProbe: async () => true,
        },
      ),
    ).resolves.toBe("verified");

    const runCall = calls.find(({ arguments_ }) => arguments_[0] === "run");
    expect(runCall?.arguments_).toContain("127.0.0.1::5432");
    expect(runCall?.arguments_).not.toContain("--rm");
    expect(runCall?.arguments_.join(" ")).not.toContain(
      String(runCall?.environment["POSTGRES_PASSWORD"]),
    );
    expect(runCall?.arguments_).toContain("POSTGRES_PASSWORD");
    expect(runCall?.arguments_).toContain("--tmpfs");
    expect(runCall?.arguments_).toContain(
      "/var/lib/postgresql:rw,noexec,nosuid,size=512m",
    );

    const inspectIndex = calls.findIndex(
      ({ arguments_ }) => arguments_[0] === "inspect",
    );
    const removeIndex = calls.findIndex(
      ({ arguments_ }) => arguments_[0] === "rm",
    );
    expect(inspectIndex).toBeGreaterThan(-1);
    expect(removeIndex).toBeGreaterThan(inspectIndex);
    expect(calls[removeIndex]?.arguments_[1]).toBe("--force");
  });
});
