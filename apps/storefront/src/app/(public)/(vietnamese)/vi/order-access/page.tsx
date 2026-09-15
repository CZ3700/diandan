import {
  createOrderPage,
  createOrderMetadata,
} from "../../../../../storefront/order-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createOrderMetadata("vi", "exchange");
export default createOrderPage("vi", "exchange");
