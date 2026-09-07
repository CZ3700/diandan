import {
  createGiftStorefrontPage,
  createGiftStorefrontMetadata,
} from "../../../../../../storefront/gift-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createGiftStorefrontMetadata("zh-CN", "policy");
export default createGiftStorefrontPage("zh-CN", "policy");
