import {
  createStorefrontPage,
  createStorefrontMetadata,
} from "../../../../../../storefront/page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createStorefrontMetadata("vi", "artist");
export default createStorefrontPage("vi", "artist");
