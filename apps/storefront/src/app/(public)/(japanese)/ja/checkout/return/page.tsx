import {
  createCheckoutPage,
  createCheckoutMetadata,
} from "../../../../../../storefront/checkout-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createCheckoutMetadata("ja", true);
export default createCheckoutPage("ja", true);
