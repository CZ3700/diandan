import {
  createOrderPage,
  createOrderMetadata,
} from "../../../../../../storefront/order-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createOrderMetadata("zh-CN", "thank-you");
export default createOrderPage("zh-CN", "thank-you");
