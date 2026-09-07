import {
  createStorefrontPage,
  createStorefrontMetadata,
} from "../../../../../storefront/page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createStorefrontMetadata("zh-CN", "artists");
export default createStorefrontPage("zh-CN", "artists");
