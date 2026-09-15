import {
  createOrderPage,
  createOrderMetadata,
} from "../../../../../storefront/order-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createOrderMetadata("en", "exchange");
export default createOrderPage("en", "exchange");
