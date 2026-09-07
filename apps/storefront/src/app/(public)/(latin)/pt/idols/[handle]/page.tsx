import {
  createStorefrontPage,
  createStorefrontMetadata,
} from "../../../../../../storefront/page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createStorefrontMetadata("pt", "artist");
export default createStorefrontPage("pt", "artist");
