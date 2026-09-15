import {
  createOrderPage,
  createOrderMetadata,
} from "../../../../../../storefront/order-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createOrderMetadata("ja", "thank-you");
export default createOrderPage("ja", "thank-you");
