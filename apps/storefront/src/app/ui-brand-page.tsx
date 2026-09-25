import type { DesignFoundationPreviewLocale } from "../design-foundations";
import { parseBrandState } from "./ui-brand-model";
import { UiBrandSpecimen } from "./ui-brand-specimen";

export function createBrandSpecimenPage(locale: DesignFoundationPreviewLocale) {
  return async function BrandPage({
    searchParams,
  }: Readonly<{
    searchParams: Promise<
      Readonly<Record<string, string | string[] | undefined>>
    >;
  }>) {
    const query = await searchParams;
    return (
      <UiBrandSpecimen
        locale={locale}
        initialState={parseBrandState(
          typeof query["demo"] === "string" ? query["demo"] : undefined,
        )}
      />
    );
  };
}
