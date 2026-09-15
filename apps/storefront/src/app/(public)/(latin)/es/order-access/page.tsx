import {
  createOrderPage,
  createOrderMetadata,
} from "../../../../../storefront/order-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createOrderMetadata("es", "exchange");
export default createOrderPage("es", "exchange");
