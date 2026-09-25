import {
  createStorefrontPage,
  createStorefrontMetadata,
} from "../../../../storefront/page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createStorefrontMetadata("th", "home");
export default createStorefrontPage("th", "home");
