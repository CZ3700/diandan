import { describe, expect, test } from "vitest";

import * as client from "./client.js";

describe("client entry", () => {
  test("keeps the runtime surface limited to interactive primitives", () => {
    expect(client.Media).toBeTypeOf("function");
    expect(client.Quantity).toBeTypeOf("function");
    expect(Object.keys(client).sort()).toEqual(["Media", "Quantity"]);
  });
});
