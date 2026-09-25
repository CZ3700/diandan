import {
  createGiftStorefrontPage,
  createGiftStorefrontMetadata,
} from "../../../../../../storefront/gift-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createGiftStorefrontMetadata("vi", "policy");
export default createGiftStorefrontPage("vi", "policy");
