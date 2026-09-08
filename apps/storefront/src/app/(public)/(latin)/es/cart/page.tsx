import {
  createCartPage,
  createCartMetadata,
} from "../../../../../storefront/cart-page-factory";
export const dynamic = "force-dynamic";
export const generateMetadata = createCartMetadata("es");
export default createCartPage("es");
