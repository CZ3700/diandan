import {
  createGiftStorefrontPage,
  createGiftStorefrontMetadata,
} from "../../../../../../storefront/gift-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createGiftStorefrontMetadata("pt", "gift");
export default createGiftStorefrontPage("pt", "gift");
