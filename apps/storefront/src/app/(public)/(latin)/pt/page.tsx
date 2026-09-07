import {
  createStorefrontPage,
  createStorefrontMetadata,
} from "../../../../storefront/page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createStorefrontMetadata("pt", "home");
export default createStorefrontPage("pt", "home");
