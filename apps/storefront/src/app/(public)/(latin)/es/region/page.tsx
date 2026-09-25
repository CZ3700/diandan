import {
  createGiftStorefrontPage,
  createGiftStorefrontMetadata,
} from "../../../../../storefront/gift-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createGiftStorefrontMetadata("es", "region");
export default createGiftStorefrontPage("es", "region");
