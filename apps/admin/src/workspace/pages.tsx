import "server-only";
import { notFound } from "next/navigation";
import { loadAdminWorkspaceConfig } from "../server/runtime-config";
import {
  baseContentTargetSchema,
  type SupportedLocale,
} from "@fan-support/contracts";
import { ManagementCenter } from "../management-center/center";
import { getManagementStorefrontOrigin } from "../server/management-config";
import { AdminPreview } from "./preview";
import { AdminWorkspace } from "./workspace";
export type PreviewSearchParams = Readonly<
  Record<string, string | string[] | undefined>
>;
function requireWorkspace() {
  if (loadAdminWorkspaceConfig().mode !== "TEST") notFound();
}
export function WorkspacePage({ locale }: { locale: SupportedLocale }) {
  requireWorkspace();
  return (
    <ManagementCenter
      locale={locale}
      storefrontOrigin={getManagementStorefrontOrigin()}
    />
  );
}
export function AdvancedWorkspacePage({ locale }: { locale: SupportedLocale }) {
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
