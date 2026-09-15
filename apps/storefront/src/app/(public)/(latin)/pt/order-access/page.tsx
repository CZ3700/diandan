import {
  createOrderPage,
  createOrderMetadata,
} from "../../../../../storefront/order-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createOrderMetadata("pt", "exchange");
export default createOrderPage("pt", "exchange");
