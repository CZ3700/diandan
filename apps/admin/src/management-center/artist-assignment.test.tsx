import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SUPPORTED_LOCALES } from "@fan-support/contracts";
import { ArtistAssignment, brokerName } from "./artist-assignment";
import { managementCopy } from "./copy";
import { ManagementShell } from "./shell";

const mina = {
  brokerId: "10000000-0000-4000-8000-000000000002",
  displayName: "Mina Park",
  active: true,
};
const rui = {
  brokerId: "10000000-0000-4000-8000-000000000003",
  displayName: "Rui Tanaka",
  active: false,
};
const render = (props: {
  value: string | null;
  state?: "IDLE" | "SAVING" | "SAVED" | "FAILED" | "STALE";
  existing?: boolean;
}) =>
  renderToStaticMarkup(
    <ArtistAssignment
      copy={managementCopy("zh-CN")}
      brokers={[mina, rui]}
      state="IDLE"
      existing
      onChange={() => {}}
      {...props}
    />,
  );
it("offers unassigned and active brokers, and keeps a suspended current broker visible", () => {
  const unassigned = render({ value: null });
  expect(unassigned).toContain("归属经纪人");
  expect(unassigned).toContain("未分配（超管直管）");
  expect(unassigned).toContain("Mina Park");
  // A suspended broker cannot be chosen for an artist it does not already have.
  expect(unassigned).not.toContain("Rui Tanaka");
  const current = render({ value: rui.brokerId });
  expect(current).toMatch(
    /<option value="[^"]+" disabled="" selected="">Rui Tanaka（已停用）<\/option>/u,
  );
});
it("explains when the choice takes effect and reports what happened to it", () => {
  expect(render({ value: null })).toContain("修改后立即生效");
  expect(render({ value: null, existing: false })).toContain(
    "艺人添加后立即归到该经纪人名下",
  );
  const saved = render({ value: mina.brokerId, state: "SAVED" });
  expect(saved).toMatch(/role="status"[^>]*>归属已更新。/u);
  const failed = render({ value: null, state: "FAILED" });
  expect(failed).toMatch(/role="alert"[^>]*>归属未能保存，请重试。/u);
  expect(failed).toContain('aria-invalid="true"');
  expect(render({ value: null, state: "STALE" })).toContain(
    "归属已被其他人修改",
  );
  expect(render({ value: null, state: "SAVING" })).toMatch(
    /<select[^>]*disabled/u,
  );
  // The live region exists before anything is announced.
  expect(render({ value: null })).toMatch(/role="status"[^>]*><\/p>/u);
});
it.each(SUPPORTED_LOCALES)("names an inactive broker in %s", (locale) => {
  const copy = managementCopy(locale);
  expect(brokerName(mina, copy)).toBe("Mina Park");
  const label = brokerName(rui, copy);
  expect(label).toContain("Rui Tanaka");
  expect(label).not.toBe("Rui Tanaka");
  expect(label).not.toContain("{name}");
});
it("offers a broker only the artist section", () => {
  const shell = (artistsOnly: boolean) =>
    renderToStaticMarkup(
      <ManagementShell
        locale="zh-CN"
        section="ARTISTS"
        onSection={() => {}}
        artistsOnly={artistsOnly}
        accountAvailable
      >
        <p>content</p>
      </ManagementShell>,
    );
  const sections = (html: string) =>
    [...html.matchAll(/data-management-section="([A-Z_]+)"/gu)].map(
      (match) => match[1],
    );
  expect(sections(shell(true))).toEqual(["ARTISTS", "ACCOUNT"]);
  expect(sections(shell(false))).toEqual([
    "ARTISTS",
    "GIFTS",
    "POSTERS",
    "ACCOUNT",
  ]);
});
