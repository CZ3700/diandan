import {
  createOrderPage,
  createOrderMetadata,
} from "../../../../../../storefront/order-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createOrderMetadata("vi", "lookup");
export default createOrderPage("vi", "lookup");
