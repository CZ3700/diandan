import {
  createOrderPage,
  createOrderMetadata,
} from "../../../../../../storefront/order-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createOrderMetadata("es", "thank-you");
export default createOrderPage("es", "thank-you");
