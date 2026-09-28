import "server-only";
import { readPublicStorefrontNavigation } from "../server/public-storefront-navigation";
import {
  NavigationProvider,
  type NavigationPreviewOptions,
} from "./navigation-provider";
import { readCartRestorationHint } from "../server/cart-restoration-hint";
import { Suspense, type ComponentProps, type ReactNode } from "react";
import { PolicyLinks } from "./commerce-context";
import { readCommerceContext } from "./storefront-page-reads";
import { CartProvider } from "./cart-provider";
import "./cart.css";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./page-parts";
import { regionEntries } from "./region-entry";
import { publicNavigationQuery } from "./navigation-target";
import { InformationPageFooter } from "./information-page-footer";

export type StorefrontPageProps = Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
  params: Promise<{ handle?: string }>;
}>;

type ShellProps = ComponentProps<typeof SiteHeader> &
  Readonly<{
    children: ReactNode;
    preview?: boolean;
    navigationPreview?: NavigationPreviewOptions | undefined;
  }>;
type PolicyProps = Pick<ShellProps, "locale" | "copy" | "contextQuery">;

async function FooterPolicyLinks(props: PolicyProps) {
  return <PolicyLinks {...props} context={await readCommerceContext()} />;
}

export async function StorefrontPageShell({
  children,
  active,
  preview = false,
  navigationPreview,
  ...props
}: ShellProps) {
  const [restoreOnLoad, navigation] = await Promise.all([
    preview ? false : readCartRestorationHint(),
    readPublicStorefrontNavigation(),
  ]);
  const region = regionEntries(props.locale, props.copy, props.contextQuery);
  const body = (
    <>
      <SiteHeader {...props} active={active} regionEntry={region.header} />
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
    </>
  );
  return (
    <NavigationProvider
      result={navigation}
      preview={preview ? navigationPreview : undefined}
    >
      <div
        className="storefront"
        lang={props.locale}
        inert={preview || undefined}
        data-layout-preview={preview || undefined}
      >
        {preview ? (
          body
        ) : (
          <CartProvider
            key={props.locale}
            locale={props.locale}
            restoreOnLoad={restoreOnLoad}
          >
            {body}
          </CartProvider>
        )}
        <SiteFooter
          {...props}
          region={region.footer}
          informationLinks={
            <Suspense fallback={null}>
              <InformationPageFooter
                locale={props.locale}
                contextQuery={props.contextQuery}
              />
            </Suspense>
          }
          policyLinks={
            <Suspense fallback={null}>
              <FooterPolicyLinks
                locale={props.locale}
                copy={props.copy}
                contextQuery={publicNavigationQuery(props.contextQuery)}
              />
            </Suspense>
          }
        />
      </div>
    </NavigationProvider>
  );
}
