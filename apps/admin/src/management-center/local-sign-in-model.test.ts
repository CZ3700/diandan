import { expect, test } from "vitest";
import {
  codeFromInput,
  failureMessage,
  newPasswordProblem,
} from "./local-sign-in-model";

const failure = (code: string, passwordProblem?: string) =>
  ({
    schemaVersion: 1,
    outcome: "FAILURE",
    code,
    ...(passwordProblem ? { passwordProblem } : {}),
  }) as never;

test("each failure names what happened and whether the sign-in starts over", () => {
  expect(failureMessage(failure("INVALID_CREDENTIALS"), "TOTP")).toEqual({
    message: "invalidCredentials",
    restart: false,
  });
  expect(failureMessage(failure("ACCOUNT_LOCKED"), "TOTP")).toEqual({
    message: "locked",
    restart: true,
  });
  expect(failureMessage(failure("LOGIN_RESTART_REQUIRED"), "TOTP")).toEqual({
    message: "restart",
    restart: true,
  });
  expect(failureMessage(failure("INVALID_CODE"), "TOTP").message).toBe(
    "invalidCode",
  );
  expect(failureMessage(failure("INVALID_CODE"), "RECOVERY_CODE").message).toBe(
    "invalidRecovery",
  );
  expect(failureMessage(failure("ACCESS_UNAVAILABLE"), "TOTP")).toEqual({
    message: "unavailable",
    restart: false,
  });
  for (const [problem, message] of [
    ["TOO_SHORT", "tooShort"],
    ["TOO_LONG", "tooLong"],
    ["SAME_AS_LOGIN", "sameAsLogin"],
    ["SAME_AS_CURRENT", "sameAsCurrent"],
  ])
    expect(
      failureMessage(failure("PASSWORD_REJECTED", problem), "TOTP").message,
    ).toBe(message);
});

test("codes are normalized before they leave the browser", () => {
  expect(codeFromInput("TOTP", " 123 456 ")).toBe("123456");
  expect(codeFromInput("TOTP", "12345")).toBe(null);
  expect(codeFromInput("TOTP", "12a456")).toBe(null);
  expect(codeFromInput("RECOVERY_CODE", " abcd-efgh-jkmn ")).toBe(
    "ABCD-EFGH-JKMN",
  );
  expect(codeFromInput("RECOVERY_CODE", "abc")).toBe(null);
});

test("a new password is checked the same way the server checks it, plus the confirmation", () => {
  expect(newPasswordProblem("short", "short", "night.shift")).toBe("tooShort");
  expect(
    newPasswordProblem("x".repeat(129), "x".repeat(129), "night.shift"),
  ).toBe("tooLong");
  expect(
    newPasswordProblem(
      "Night.Shift.Team",
      "Night.Shift.Team",
      "night.shift.team",
    ),
  ).toBe("sameAsLogin");
  expect(
    newPasswordProblem("a long pass phrase", "a long pass phrasE", "night"),
  ).toBe("mismatch");
  // Thai and CJK characters count one each, like the server's code-point length.
  expect(
    newPasswordProblem("รหัสผ่านที่ยาวพอ", "รหัสผ่านที่ยาวพอ", "night"),
  ).toBe(null);
  expect(newPasswordProblem("工作室夜班密码", "工作室夜班密码", "night")).toBe(
    "tooShort",
  );
});
