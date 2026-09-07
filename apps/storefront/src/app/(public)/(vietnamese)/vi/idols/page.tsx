import {
  createStorefrontPage,
  createStorefrontMetadata,
} from "../../../../../storefront/page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createStorefrontMetadata("vi", "artists");
export default createStorefrontPage("vi", "artists");
