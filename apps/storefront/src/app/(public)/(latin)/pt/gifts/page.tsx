import { createGiftDirectoryPage } from "../../../../../storefront/gift-directory-page-factory";
import { createGiftStorefrontMetadata } from "../../../../../storefront/gift-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createGiftStorefrontMetadata("pt", "gifts");
export default createGiftDirectoryPage("pt");
