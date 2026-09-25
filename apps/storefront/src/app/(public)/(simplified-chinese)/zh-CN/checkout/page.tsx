import {
  createCheckoutPage,
  createCheckoutMetadata,
} from "../../../../../storefront/checkout-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createCheckoutMetadata("zh-CN");
export default createCheckoutPage("zh-CN");
