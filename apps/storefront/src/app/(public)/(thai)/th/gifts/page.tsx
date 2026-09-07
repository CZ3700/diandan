import {
  createGiftStorefrontPage,
  createGiftStorefrontMetadata,
} from "../../../../../storefront/gift-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createGiftStorefrontMetadata("th", "gifts");
export default createGiftStorefrontPage("th", "gifts");
