import "server-only";
// The order proxy owns same-origin, CSRF, cookie isolation, body limits and response validation.
export {
  proxyOrderRequest as proxyWishWithdrawRequest,
  handleOrderRequest as handleWishWithdrawRequest,
} from "./order-proxy";
