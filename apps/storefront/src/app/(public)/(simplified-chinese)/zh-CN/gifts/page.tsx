import { createGiftDirectoryPage } from "../../../../../storefront/gift-directory-page-factory";
import { createGiftStorefrontMetadata } from "../../../../../storefront/gift-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createGiftStorefrontMetadata("zh-CN", "gifts");
export default createGiftDirectoryPage("zh-CN");
