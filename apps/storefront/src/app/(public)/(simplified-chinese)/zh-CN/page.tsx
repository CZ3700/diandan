import {
  createStorefrontPage,
  createStorefrontMetadata,
} from "../../../../storefront/page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createStorefrontMetadata("zh-CN", "home");
export default createStorefrontPage("zh-CN", "home");
