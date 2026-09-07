import {
  createStorefrontPage,
  createStorefrontMetadata,
} from "../../../../storefront/page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createStorefrontMetadata("vi", "home");
export default createStorefrontPage("vi", "home");
