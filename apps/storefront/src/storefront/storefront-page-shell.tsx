import "server-only";
import { readCartRestorationHint } from "../server/cart-restoration-hint";
import { Suspense, type ComponentProps, type ReactNode } from "react";
import { PolicyLinks } from "./commerce-context";
import { readCommerceContext } from "./storefront-page-reads";
import { CartProvider } from "./cart-provider";
import "./cart.css";
import { SiteHeader } from "./site-header";
import { SiteFooter } from "./page-parts";
import { regionEntries } from "./region-entry";

export type StorefrontPageProps = Readonly<{
  searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
  params: Promise<{ handle?: string }>;
}>;

type ShellProps = ComponentProps<typeof SiteHeader> &
  Readonly<{ children: ReactNode; preview?: boolean }>;
type PolicyProps = Pick<ShellProps, "locale" | "copy" | "contextQuery">;

async function FooterPolicyLinks(props: PolicyProps) {
  return <PolicyLinks {...props} context={await readCommerceContext()} />;
}

export async function StorefrontPageShell({
  children,
  active,
  preview = false,
  ...props
}: ShellProps) {
  const restoreOnLoad = preview ? false : await readCartRestorationHint();
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
        policyLinks={
          <Suspense fallback={null}>
            <FooterPolicyLinks
              locale={props.locale}
              copy={props.copy}
              contextQuery={props.contextQuery}
            />
          </Suspense>
        }
      />
    </div>
  );
}
