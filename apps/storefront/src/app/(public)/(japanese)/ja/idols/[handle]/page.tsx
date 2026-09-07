import {
  createStorefrontPage,
  createStorefrontMetadata,
} from "../../../../../../storefront/page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createStorefrontMetadata("ja", "artist");
export default createStorefrontPage("ja", "artist");
