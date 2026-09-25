import { createGiftDirectoryPage } from "../../../../../storefront/gift-directory-page-factory";
import { createGiftStorefrontMetadata } from "../../../../../storefront/gift-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createGiftStorefrontMetadata("ja", "gifts");
export default createGiftDirectoryPage("ja");
