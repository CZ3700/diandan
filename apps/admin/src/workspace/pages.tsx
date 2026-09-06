import "server-only";
import { notFound } from "next/navigation";
import { loadAdminWorkspaceConfig } from "../server/runtime-config";
import {
  baseContentTargetSchema,
  type SupportedLocale,
} from "@fan-support/contracts";
import { AdminWorkspace } from "./workspace";
import { AdminPreview } from "./preview";
export type PreviewSearchParams = Readonly<
  Record<string, string | string[] | undefined>
>;
function requireWorkspace() {
  if (loadAdminWorkspaceConfig().mode !== "TEST") notFound();
}
export function WorkspacePage({ locale }: { locale: SupportedLocale }) {
  requireWorkspace();
  return <AdminWorkspace locale={locale} />;
}
export function PreviewPage({
  locale,
  searchParams,
}: {
  locale: SupportedLocale;
  searchParams: PreviewSearchParams;
}) {
  requireWorkspace();
  if (
    Object.keys(searchParams).some(
      (key) => !["owner", "revision", "viewport"].includes(key),
    ) ||
    typeof searchParams["owner"] !== "string" ||
    typeof searchParams["revision"] !== "string" ||
    !["desktop", "mobile"].includes(String(searchParams["viewport"]))
  )
    notFound();
  let owner: unknown;
  try {
    owner = JSON.parse(searchParams["owner"]);
  } catch {
    notFound();
  }
  const target = baseContentTargetSchema.safeParse({
    owner,
    revisionId: searchParams["revision"],
    locale,
  });
  if (!target.success) notFound();
  return (
    <AdminPreview
      target={target.data}
      viewport={searchParams["viewport"] as "mobile" | "desktop"}
    />
  );
}
