import { Module, type NestApplicationOptions } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { expect, test } from "vitest";

type BootstrapModule = Readonly<{
  apiNestApplicationOptions?: Readonly<NestApplicationOptions>;
}>;

@Module({
  providers: [
    {
      provide: "EXPECTED_STARTUP_FAILURE",
      useFactory: () => {
        throw new Error("EXPECTED_NEST_STARTUP_FAILURE");
      },
    },
  ],
})
class FailingModule {}

test("turns Nest initialization failures into catchable rejections", async () => {
  const bootstrap = (await import("./bootstrap.js").catch(() => undefined)) as
    BootstrapModule | undefined;

  expect(bootstrap, "API bootstrap module must exist").toBeDefined();
  expect(bootstrap?.apiNestApplicationOptions).toEqual({
    abortOnError: false,
    logger: false,
  });
  if (bootstrap?.apiNestApplicationOptions === undefined) {
    return;
  }

  await expect(
    NestFactory.create(
      FailingModule,
      new FastifyAdapter({ logger: false }),
      bootstrap.apiNestApplicationOptions,
    ),
  ).rejects.toThrow("EXPECTED_NEST_STARTUP_FAILURE");
});
