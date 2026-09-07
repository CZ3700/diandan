import {
  createStorefrontPage,
  createStorefrontMetadata,
} from "../../../../../storefront/page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createStorefrontMetadata("th", "artists");
export default createStorefrontPage("th", "artists");
