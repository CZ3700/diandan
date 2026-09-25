import {
  createCheckoutPage,
  createCheckoutMetadata,
} from "../../../../../../storefront/checkout-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createCheckoutMetadata("en", true);
export default createCheckoutPage("en", true);
