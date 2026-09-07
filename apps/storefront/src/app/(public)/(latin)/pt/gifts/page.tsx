import {
  createGiftStorefrontPage,
  createGiftStorefrontMetadata,
} from "../../../../../storefront/gift-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createGiftStorefrontMetadata("pt", "gifts");
export default createGiftStorefrontPage("pt", "gifts");
