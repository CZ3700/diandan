import {
  createStorefrontPage,
  createStorefrontMetadata,
} from "../../../../../storefront/page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createStorefrontMetadata("es", "artists");
export default createStorefrontPage("es", "artists");
