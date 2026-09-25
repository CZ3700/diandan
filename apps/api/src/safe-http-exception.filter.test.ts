import { HttpException, type ArgumentsHost } from "@nestjs/common";
import { expect, test } from "vitest";

import { SafeHttpExceptionFilter } from "./safe-http-exception.filter.js";

test("normalizes hostile thrown values without inspecting or reflecting them", () => {
  const canary = "PRIVATE_THROWN_VALUE_27519";
  const hostile = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error(canary);
      },
    },
  );
  const headers = new Map<string, unknown>();
  let statusCode: number | undefined;
  let responseBody: unknown;
  const reply = {
    getHeader: (name: string) => headers.get(name),
    header: (name: string, value: unknown) => {
      headers.set(name, value);
      return reply;
    },
    status: (value: number) => {
      statusCode = value;
      return reply;
    },
    send: (value: unknown) => {
      responseBody = value;
      return reply;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => reply }),
  } as unknown as ArgumentsHost;

  expect(() =>
    new SafeHttpExceptionFilter().catch(hostile, host),
  ).not.toThrow();
  expect(statusCode).toBe(500);
  expect(responseBody).toMatchObject({
    schemaVersion: 1,
    code: "INTERNAL_ERROR",
  });
  expect(JSON.stringify(responseBody)).not.toContain(canary);
});

test("fails closed when an HTTP exception supplies an invalid status", () => {
  const headers = new Map<string, unknown>();
  let statusCode: number | undefined;
  let responseBody: unknown;
  const reply = {
    getHeader: (name: string) => headers.get(name),
    header: (name: string, value: unknown) => {
      headers.set(name, value);
      return reply;
    },
    status: (value: number) => {
      statusCode = value;
      return reply;
    },
    send: (value: unknown) => {
      responseBody = value;
      return reply;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => reply }),
  } as unknown as ArgumentsHost;

  new SafeHttpExceptionFilter().catch(
    new HttpException("PRIVATE_INVALID_STATUS_62817", 799),
    host,
  );

  expect(statusCode).toBe(500);
  expect(responseBody).toMatchObject({
    schemaVersion: 1,
    code: "INTERNAL_ERROR",
  });
  expect(JSON.stringify(responseBody)).not.toContain(
    "PRIVATE_INVALID_STATUS_62817",
  );
});
