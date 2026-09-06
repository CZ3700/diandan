"use client";
import { useEffect, useMemo, useState } from "react";
import { DESIGN_TOKEN_CONTRACT } from "@fan-support/design-tokens";
import {
  adminContentResponseSchema,
  baseContentResponseSchema,
  contentAuthoringContentSchema,
  contentAuthoringChangesSchema,
  contentAuthoringResponseSchema,
  translationWorkspaceResponseSchema,
  translationTransferResponseSchema,
  type AdminCatalogOwner,
  type ContentAuthoringContent,
  type ContentAuthoringSnapshot,
  type SupportedLocale,
  type TranslationWorkspaceResponse,
  baseContentTargetSchema,
} from "@fan-support/contracts";
import {
  AdminClientError,
  type AdminClient,
  type AdminSession,
} from "./client";
import { errorText, type Translate } from "./components";
import {
  editableFields,
  replaceAliasLocale,
  translationChanges,
} from "./editor-model";
type Workspace = Extract<TranslationWorkspaceResponse, { outcome: "SUCCESS" }>;
function newContent(
  kind: AdminCatalogOwner["target"]["kind"],
): ContentAuthoringContent | null {
  const origin = "HUMAN" as const;
  const locale = "en" as const;
  if (kind === "IDOL")
    return {
      kind,
      structure: {
        themeAccent: DESIGN_TOKEN_CONTRACT.values["--color-accent"],
        heroTextTone: "light",
        displayOrder: 0,
      },
      media: [],
      translations: [
        {
          locale,
          origin,
          fields: {
            displayName: "",
            shortBio: "",
            fullBio: "",
            seoTitle: "",
            seoDescription: "",
          },
        },
      ],
    };
  if (kind === "HOMEPAGE")
    return {
      kind,
      structure: { slots: [] },
      translations: [
        {
          locale,
          origin,
          fields: {
            heroTitle: "",
            heroSubtitle: "",
            ctaLabel: "",
            announcement: "",
            slotLabels: [],
            seoTitle: "",
            seoDescription: "",
          },
        },
      ],
    };
  if (kind === "MEDIA_METADATA")
    return {
      kind,
      structure: {
        presentationKind: "INFORMATIVE",
        focalPoint: { x: 0.5, y: 0.5 },
      },
      translations: [
        { locale, origin, fields: { alt: "", title: "", caption: "" } },
      ],
    };
  return null;
}
function cleanOptionalFields(kind: string, fields: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(fields).filter(
      ([key, value]) =>
        !(
          value === "" &&
          ((kind === "MEDIA_METADATA" &&
            (key === "title" || key === "caption")) ||
            (kind === "HOMEPAGE" && key === "announcement"))
        ),
    ),
  );
}
export function useContentEditor({
  client,
  session,
  owner,
  t,
  initialLocale,
  onRefresh,
}: {
  client: AdminClient;
  session: AdminSession;
  owner: AdminCatalogOwner;
  t: Translate;
  initialLocale: SupportedLocale;
  onDirty: (value: boolean) => void;
  onRefresh: () => void;
  onOpen: (owner: AdminCatalogOwner) => void;
}) {
  const [locale, setLocale] = useState<SupportedLocale>(
    session.localeScopes.includes(initialLocale)
      ? initialLocale
      : (session.localeScopes[0] ?? "en"),
  );
  const [revisionId, setRevisionId] = useState(
    owner.draftRevisionId ??
      owner.latestRevisionId ??
      owner.publishedRevisionId,
  );
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [snapshot, setSnapshot] = useState<ContentAuthoringSnapshot | null>(
    null,
  );
  const [draft, setDraft] = useState<ContentAuthoringContent | null>(null);
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [aliases, setAliases] = useState("");
  const [aliasesDirty, setAliasesDirty] = useState(false);
  const [structureDirty, setStructureDirty] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("CONTENT_UPDATE");
  const [refreshIndex, setRefreshIndex] = useState(0);
  const canEdit =
    session.permissions.includes("content.edit") && owner.status !== "archived";
  const canReview = session.permissions.includes("content.translation.review");
  const canPublish = session.permissions.includes("content.publish");
  const contentTarget = useMemo(
    () =>
      revisionId
        ? baseContentTargetSchema.parse({
            owner: owner.target,
            revisionId,
            locale,
          })
        : null,
    [owner.target, revisionId, locale],
  );
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    setWorkspace(null);
    setSnapshot(null);
    setDraft(null);
    setDirty(false);
    setAliasesDirty(false);
    setStructureDirty(false);
    setErrors([]);
    if (!revisionId) {
      const content = newContent(owner.target.kind);
      setDraft(content);
      setFields(content?.translations[0]?.fields ?? {});
      setLocale("en");
      setLoading(false);
      return;
    }
    void (async () => {
      const result = await client.call(
        "translation-read",
        {
          schemaVersion: 1,
          target: { owner: owner.target, revisionId, locale },
        },
        translationWorkspaceResponseSchema,
      );
      if (!current) return;
      setWorkspace(result);
      setFields(editableFields(result.source, result.selected?.content.fields));
      try {
        const full = await client.call(
          "authoring-read",
          { schemaVersion: 1, target: owner.target, revisionId },
          contentAuthoringResponseSchema,
        );
        if (current && full.kind === "REVISION") {
          setSnapshot(full.snapshot);
          setDraft(full.snapshot.content);
          setAliases(
            full.snapshot.extensions.aliases?.aliases
              .filter((alias) => alias.locale === locale)
              .map((alias) => alias.text)
              .join("\n") ?? "",
          );
        }
      } catch (e) {
        if (!(e instanceof AdminClientError) || e.code !== "FORBIDDEN") throw e;
      }
    })()
      .catch((e: unknown) => {
        if (current) setError(errorText(e, t));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [client, owner.target, revisionId, locale, refreshIndex, t]);
  const refresh = () => {
    setRefreshIndex((i) => i + 1);
    onRefresh();
  };
  const run = (work: () => Promise<void>, successMessage = t("success")) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setErrors([]);
    setMessage("");
    void work()
      .then(() => setMessage(successMessage))
      .catch((e: unknown) => {
        setError(errorText(e, t));
        if (
          e &&
          typeof e === "object" &&
          "issues" in e &&
          Array.isArray(e.issues)
        )
          setErrors(
            e.issues.flatMap((issue: unknown) =>
              issue &&
              typeof issue === "object" &&
              "path" in issue &&
              Array.isArray(issue.path)
                ? issue.path.filter((part: unknown) => typeof part === "string")
                : [],
            ),
          );
      })
      .finally(() => setBusy(false));
  };
  const changeLocale = (next: SupportedLocale) => {
    if (dirty && !window.confirm(t("discard"))) return;
    setLocale(next);
  };
  const save = async () => {
    let result;
    if (!revisionId) {
      if (!draft) throw new AdminClientError("INVALID_COMMAND");
      const content = contentAuthoringContentSchema.parse({
        ...draft,
        translations: [
          {
            locale: "en",
            origin: "HUMAN",
            fields: cleanOptionalFields(draft.kind, fields),
          },
        ],
      });
      result = await client.call(
        "authoring-create",
        {
          schemaVersion: 1,
          target: owner.target,
          expectedVersion: owner.authoringVersion,
          reasonCode: reason,
          content,
        },
        contentAuthoringResponseSchema,
        true,
      );
    } else {
      if (!workspace?.editability.canSave)
        throw new AdminClientError("FORBIDDEN");
      const text = translationChanges(
        owner.target.kind,
        locale,
        cleanOptionalFields(owner.target.kind, fields),
      );
      const changes = contentAuthoringChangesSchema.parse({
        ...text,
        ...(structureDirty && draft
          ? {
              structure: draft.structure,
              ...("media" in draft ? { media: draft.media } : {}),
            }
          : {}),
        ...(aliasesDirty && draft?.kind === "IDOL"
          ? {
              aliases: replaceAliasLocale(
                snapshot?.extensions.aliases?.aliases ?? [],
                locale,
                aliases,
              ),
            }
          : {}),
      });
      result = await client.call(
        "authoring-copy",
        {
          schemaVersion: 1,
          target: owner.target,
          sourceRevisionId: revisionId,
          expectedVersion: workspace.authoringHeadVersion,
          expectedSourceHash: workspace.contentHash,
          reasonCode: reason,
          changes,
        },
        contentAuthoringResponseSchema,
        true,
      );
    }
    if (result.kind !== "MUTATION")
      throw new AdminClientError("INVALID_RESPONSE");
    setDirty(false);
    setRevisionId(result.resultId);
    refresh();
    setMessage(t("saved"));
  };
  const review = async (action: "submit" | "approve") => {
    const selected = workspace?.selected;
    if (!selected) throw new AdminClientError("INVALID_COMMAND");
    await client.call(
      `review-${action}`,
      {
        schemaVersion: 1,
        target: selected.context.target,
        expectedVersion: selected.context.audit.reviewSequence,
        expectedContentHash: selected.context.audit.sourceHash,
        expectedSourceHash: selected.context.currentEnglishSourceHash,
        reasonCode: reason,
      },
      baseContentResponseSchema,
      true,
    );
    refresh();
  };
  const reviewAliases = async (action: "submit" | "approve") => {
    const target = { kind: "IDOL_ALIASES", revisionId };
    const response = await client.call(
      "alias-review-read",
      { schemaVersion: 1, target },
      adminContentResponseSchema,
    );
    if (response.kind !== "REVIEW")
      throw new AdminClientError("INVALID_RESPONSE");
    const context = response.context;
    await client.call(
      `alias-review-${action}`,
      {
        schemaVersion: 1,
        target,
        expectedVersion: context.sequence,
        expectedContentHash: context.contentHash,
        expectedSourceHash: context.sourceHash,
        reasonCode: reason,
      },
      adminContentResponseSchema,
      true,
    );
    refresh();
  };
  const exportPackage = async () => {
    const response = await client.call(
      "translation-export",
      {
        schemaVersion: 1,
        target: { owner: owner.target, revisionId },
        locales: session.localeScopes,
        reasonCode: reason,
      },
      translationTransferResponseSchema,
      true,
    );
    if (response.kind !== "TRANSLATION_EXPORT")
      throw new AdminClientError("INVALID_RESPONSE");
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(response.package, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `translations-${response.package.packageId}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const readOnly =
    busy || !canEdit || Boolean(workspace && !workspace.editability.canSave);
  const context = workspace?.selected?.context;
  return {
    locale,
    revisionId,
    workspace,
    snapshot,
    draft,
    fields,
    aliases,
    dirty,
    busy,
    loading,
    error,
    errors,
    message,
    reason,
    canEdit,
    canReview,
    canPublish,
    contentTarget,
    refresh,
    run,
    changeLocale,
    save,
    review,
    reviewAliases,
    exportPackage,
    readOnly,
    context,
    setDraft,
    setStructureDirty,
    setDirty,
    setFields,
    setAliases,
    setAliasesDirty,
    setReason,
    setRevisionId,
  };
}
