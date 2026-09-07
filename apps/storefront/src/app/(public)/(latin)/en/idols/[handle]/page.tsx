import {
  createStorefrontPage,
  createStorefrontMetadata,
} from "../../../../../../storefront/page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createStorefrontMetadata("en", "artist");
export default createStorefrontPage("en", "artist");
