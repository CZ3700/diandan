import {
  createStorefrontPage,
  createStorefrontMetadata,
} from "../../../../storefront/page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createStorefrontMetadata("ja", "home");
export default createStorefrontPage("ja", "home");
