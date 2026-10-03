import { afterEach, expect, test, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import type * as React from "react";
import { createAdminClient } from "../workspace/client";
import { policyFixture, owner, actor } from "./fixture";
import type { PolicyDraft } from "./model";
const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  index: 0,
  refIndex: 0,
  effects: [] as (() => unknown)[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  useId: () => "policy-test",
  useCallback: (fn: unknown) => fn,
  useMemo: (fn: () => unknown) => fn(),
  useEffect: (fn: () => unknown) => {
    hooks.effects.push(fn);
  },
  useLayoutEffect: (fn: () => unknown) => {
    fn();
  },
  useRef: (initial: unknown) => {
    const index = hooks.refIndex++;
    hooks.refs[index] ??= { current: initial };
    return hooks.refs[index];
  },
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values))
      hooks.values[index] = typeof initial === "function" ? initial() : initial;
    return [
      hooks.values[index],
      (next: unknown) => {
        hooks.values[index] =
          typeof next === "function" ? next(hooks.values[index]) : next;
      },
    ];
  },
}));
import { PoliciesWorkspace } from "./workspace";
function find(
  node: unknown,
  predicate: (props: Record<string, unknown>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node))
    return node.map((child) => find(child, predicate)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return;
  return predicate(node.props) ? node : find(node.props["children"], predicate);
}
afterEach(() => vi.unstubAllGlobals());
test.each(["network failure", "concurrent head"])(
  "%s preserves dirty protection through language retries and refuses an unconfirmed reload",
  async (scenario) => {
    hooks.values = [];
    hooks.refs = [];
    const confirm = vi.fn(() => false),
      dirty = vi.fn(),
      busy = vi.fn();
    vi.stubGlobal("window", {
      confirm,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const workspace = policyFixture();
    if (
      workspace.outcome !== "SUCCESS" ||
      workspace.selected?.content.kind !== "POLICY"
    )
      throw new Error("fixture");
    const draft: PolicyDraft = {
      ...workspace.selected.content.structure,
      translations: [
        {
          locale: "en",
          origin: "MACHINE",
          fields: workspace.selected.content.fields,
        },
      ],
    };
    const read = vi.fn().mockResolvedValue({ owner, workspace, draft });
    const api = {
      client: createAdminClient(() => "csrf", vi.fn(), vi.fn()),
      read,
      list: vi.fn().mockResolvedValue([owner]),
      save: vi.fn(),
      register: vi.fn(),
      review: vi.fn(),
    };
    function render() {
      hooks.index = 0;
      hooks.refIndex = 0;
      hooks.effects = [];
      return PoliciesWorkspace({
        api,
        locale: "en",
        localeScopes: ["en", "es"],
        permissions: ["content.read", "content.edit"],
        actorId: actor,
        onDirtyChange: dirty,
        onBusy: busy,
      });
    }
    render();
    hooks.effects[1]!();
    await vi.waitFor(() => expect(api.list).toHaveBeenCalledOnce());
    render();
    hooks.effects[2]!();
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    await Promise.resolve();
    let tree = render();
    const editor = find(tree, (props) => "canStructure" in props)!;
    (editor.props["onChange"] as (value: PolicyDraft) => void)({
      ...draft,
      translations: [
        {
          ...draft.translations[0]!,
          fields: {
            ...draft.translations[0]!.fields,
            title: "Unsaved English",
          },
        },
      ],
    });
    tree = render();
    expect(dirty).toHaveBeenLastCalledWith(true);
    (
      find(tree, (props) => props["data-policy-locale"] === "es")!.props[
        "onClick"
      ] as () => void
    )();
    if (scenario === "network failure")
      read.mockRejectedValueOnce(new Error("network failed"));
    else
      read.mockResolvedValue({
        owner,
        workspace: { ...workspace, authoringHeadVersion: 2 },
        draft,
      });
    render();
    hooks.effects[2]!();
    tree = render();
    expect(dirty).toHaveBeenLastCalledWith(true);
    expect(
      find(tree, (props) => "canStructure" in props)?.props["disabled"],
    ).toBe(true);
    expect(find(tree, (props) => "canPublish" in props)).toBeDefined();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    tree = render();
    expect(dirty).toHaveBeenLastCalledWith(true);
    if (scenario === "concurrent head") {
      (
        find(tree, (props) => props["data-policy-locale"] === "en")!.props[
          "onClick"
        ] as () => void
      )();
      render();
      hooks.effects[2]!();
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
      await Promise.resolve();
      tree = render();
      const editorAfterRetry = find(tree, (props) => "canStructure" in props)!;
      expect(editorAfterRetry.props["disabled"]).toBe(true);
      expect(
        (editorAfterRetry.props["draft"] as PolicyDraft).translations[0]?.fields
          .title,
      ).toBe("Unsaved English");
      expect(dirty).toHaveBeenLastCalledWith(true);
    }
    (
      find(tree, (props) => props["children"] === "Reload current version")!
        .props["onClick"] as () => void
    )();
    expect(confirm).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledTimes(scenario === "concurrent head" ? 3 : 2);
  },
);
