import {
  createGiftStorefrontPage,
  createGiftStorefrontMetadata,
} from "../../../../../storefront/gift-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createGiftStorefrontMetadata("en", "region");
export default createGiftStorefrontPage("en", "region");
