import {
  PreviewPage,
  type PreviewSearchParams,
} from "../../../../workspace/pages";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<PreviewSearchParams>;
}) {
  return <PreviewPage locale="zh-CN" searchParams={await searchParams} />;
}
