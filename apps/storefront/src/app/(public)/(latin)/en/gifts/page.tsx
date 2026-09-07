import {
  createGiftStorefrontPage,
  createGiftStorefrontMetadata,
} from "../../../../../storefront/gift-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createGiftStorefrontMetadata("en", "gifts");
export default createGiftStorefrontPage("en", "gifts");
