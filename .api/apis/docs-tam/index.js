"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var oas_1 = __importDefault(require("oas"));
var core_1 = __importDefault(require("api/dist/core"));
var openapi_json_1 = __importDefault(require("./openapi.json"));
var SDK = /** @class */ (function () {
    function SDK() {
        this.spec = oas_1.default.init(openapi_json_1.default);
        this.core = new core_1.default(this.spec, 'docs-tam/1.0.0 (api/6.1.3)');
    }
    /**
     * Optionally configure various options that the SDK allows.
     *
     * @param config Object of supported SDK options and toggles.
     * @param config.timeout Override the default `fetch` request timeout of 30 seconds. This number
     * should be represented in milliseconds.
     */
    SDK.prototype.config = function (config) {
        this.core.setConfig(config);
    };
    /**
     * If the API you're using requires authentication you can supply the required credentials
     * through this method and the library will magically determine how they should be used
     * within your API request.
     *
     * With the exception of OpenID and MutualTLS, it supports all forms of authentication
     * supported by the OpenAPI specification.
     *
     * @example <caption>HTTP Basic auth</caption>
     * sdk.auth('username', 'password');
     *
     * @example <caption>Bearer tokens (HTTP or OAuth 2)</caption>
     * sdk.auth('myBearerToken');
     *
     * @example <caption>API Keys</caption>
     * sdk.auth('myApiKey');
     *
     * @see {@link https://spec.openapis.org/oas/v3.0.3#fixed-fields-22}
     * @see {@link https://spec.openapis.org/oas/v3.1.0#fixed-fields-22}
     * @param values Your auth credentials for the API; can specify up to two strings or numbers.
     */
    SDK.prototype.auth = function () {
        var _a;
        var values = [];
        for (var _i = 0; _i < arguments.length; _i++) {
            values[_i] = arguments[_i];
        }
        (_a = this.core).setAuth.apply(_a, values);
        return this;
    };
    /**
     * If the API you're using offers alternate server URLs, and server variables, you can tell
     * the SDK which one to use with this method. To use it you can supply either one of the
     * server URLs that are contained within the OpenAPI definition (along with any server
     * variables), or you can pass it a fully qualified URL to use (that may or may not exist
     * within the OpenAPI definition).
     *
     * @example <caption>Server URL with server variables</caption>
     * sdk.server('https://{region}.api.example.com/{basePath}', {
     *   name: 'eu',
     *   basePath: 'v14',
     * });
     *
     * @example <caption>Fully qualified server URL</caption>
     * sdk.server('https://eu.api.example.com/v14');
     *
     * @param url Server URL
     * @param variables An object of variables to replace into the server URL.
     */
    SDK.prototype.server = function (url, variables) {
        if (variables === void 0) { variables = {}; }
        this.core.setServer(url, variables);
    };
    /**
     * List supported payment types from Tamara. For example, Pay in full or Pay in
     * installments.
     *
     * @summary Payment Types
     */
    SDK.prototype.paymentTypes = function (metadata) {
        return this.core.fetch('/checkout/payment-types', 'get', metadata);
    };
    /**
     * This endpoint is requested for online checkout integration during the pre-checkout
     * phase, providing available payment options offered by **Tamara** based on the customer's
     * eligibility and the given order value.
     *
     * @summary Check Payment Options Availability
     */
    SDK.prototype.checkPaymentOptionsAvailability = function (body) {
        return this.core.fetch('/checkout/payment-options-pre-check', 'post', body);
    };
    /**
     * This endpoint is requested for in-store checkout  integration during the pre-checkout
     * phase. It checks the customer's ID verification status at **Tamara**, providing
     * information on whether the customer is new(unverified) or existing(previously verified).
     *
     * @summary Customer's ID Verification Status
     */
    SDK.prototype.customerSIdVerificationStatus = function (metadata) {
        return this.core.fetch('/merchants/customer/id-verification-status', 'get', metadata);
    };
    /**
     * This endpoint facilitates the creation of a checkout session, where all payment
     * information is sent within the request to enable customer payments via Tamara. The
     * response will include `order_id`, `checkout_id` , `status` and `checkout_url`. <br />
     * <br /> Please store the `order_id` in your DBs to fetch the information about the order
     * later and direct the customer to the `checkout_url` to seamlessly conclude the
     * transaction through Tamara.
     *
     * @summary Create Checkout Session
     * @throws FetchError<400, types.CreateCheckoutSessionResponse400> Unsupported Country/Currency
     */
    SDK.prototype.createCheckoutSession = function (body) {
        return this.core.fetch('/checkout', 'post', body);
    };
    /**
     * This endpoint facilitates the creation of an In-Store checkout session, where all
     * payment information is sent within the request to send a payment link via SMS message,
     * enabling customer payments via Tamara. <br /> <br /> Please store the `order_id` and
     * `checkout_id` received in response in your DBs as they might be needed later.
     *
     * @summary Create In-store Checkout Session
     * @throws FetchError<400, types.CreateInStoreCheckoutSessionResponse400> Unsupported Country/Currency
     */
    SDK.prototype.createInStoreCheckoutSession = function (body) {
        return this.core.fetch('/checkout/in-store-session', 'post', body);
    };
    /**
     * This endpoint facilitates the creation of an In-Store checkout link that can be
     * converted to a QR code, enabling customer payments via Tamara customer app using the
     * Scan to Pay function. <br /> <br /> Please store the `order_id` and `checkout_id`
     * received in response in your DBs as they might be needed later.
     *
     * @summary Create In-store QR Code Checkout Session
     * @throws FetchError<400, types.CreateInStoreQrCodeResponse400> Unsupported Country/Currency
     */
    SDK.prototype.createInStoreQrCode = function (body, metadata) {
        return this.core.fetch('/checkout/in-store', 'post', body, metadata);
    };
    /**
     * This API endpoint provides the functionality to void any In-Store checkout session. This
     * is particularly useful in-store when customers need to make any changes to their orders
     * being paid with Tamara.
     *
     * @summary Void Checkout Session
     */
    SDK.prototype.voidCheckoutSession = function (metadata) {
        return this.core.fetch('/checkout/{checkout_id}/void', 'post', metadata);
    };
    /**
     * Fetch all the order details available on **Tamara's** side using the unique `order_id`
     * that is issued by **Tamara** for every order whether online or in-store.
     *
     * @summary Get Order Details by Tamara's order_id
     */
    SDK.prototype.getOrderDetails = function (metadata) {
        return this.core.fetch('/orders/{order_id}', 'get', metadata);
    };
    /**
     * Fetch all the order details available on **Tamara's** side using your own
     * `order_reference_id` that you sent to **Tamara** during creating a checkout session for
     * the customer whether online or in-store.
     *
     * @summary Get Order Details by Merchant's order_reference_id
     */
    SDK.prototype.getOrderDetailsByRefId = function (metadata) {
        return this.core.fetch('/merchants/orders/reference-id/{order_reference_id}', 'get', metadata);
    };
    /**
     * Update `order_reference_id` value that is stored at **Tamara's** side at any point after
     * the original checkout session has been created.
     *
     * @summary Update order_reference_id
     */
    SDK.prototype.updateOrderReferenceId = function (body, metadata) {
        return this.core.fetch('/orders/{order_id}/reference-id', 'put', body, metadata);
    };
    /**
     * This endpoint plays a crucial role in the online checkout flow and should be executed
     * upon receipt of the `approved` status webook event from **Tamara**. Its primary function
     * is to update the order status to `authorised` ensuring status synchronization and smooth
     * progression of the online order flow.
     *
     * @summary Authorise Order
     */
    SDK.prototype.authoriseOrder = function (metadata) {
        return this.core.fetch('/orders/{order_id}/authorise', 'post', metadata);
    };
    /**
     * This endpoint is requested to cancel or update the total order amount while order status
     * on `authorised` (before the order is captured or shipping process is done). The order
     * status value will be `canceled` or `updated` based on the modification applied to the
     * total amount.
     *
     * @summary Cancel Order
     * @throws FetchError<409, types.CancelOrderResponse409> Cannot cancel orders in `approved` state
     */
    SDK.prototype.cancelOrder = function (body, metadata) {
        return this.core.fetch('/orders/{order_id}/cancel', 'post', body, metadata);
    };
    /**
     * This endpoint is requested to perform a full or partial capture of the order, confirming
     * the fulfillment or shipment of the items to the customer. The order status value will be
     * `fully_captured` or `partially_captured` based on the total amount value sent in the
     * request.
     *
     * @summary Capture Order
     */
    SDK.prototype.captureOrder = function (body) {
        return this.core.fetch('/payments/capture', 'post', body);
    };
    /**
     * Refund
     *
     * @summary Refund
     */
    SDK.prototype.refund = function (body) {
        return this.core.fetch('/payments/refund', 'post', body);
    };
    /**
     * This API is to be used to process refunds for captured orders.
     *
     * @summary Simplified Refund
     */
    SDK.prototype.simplifiedRefund = function (body, metadata) {
        return this.core.fetch('/payments/simplified-refund/{order_id}', 'post', body, metadata);
    };
    /**
     * Register a new webhook endpoint that Tamara will post selected events to as notification
     * payload
     *
     * @summary Register Webhook URL
     */
    SDK.prototype.registerWebhookUrl = function (body) {
        return this.core.fetch('/webhooks', 'post', body);
    };
    /**
     * Retrieve Webhook URL using Webhook ID
     *
     * @summary Retrieve Webhook URL using Webhook ID
     */
    SDK.prototype.retrieveWebhookUrlUsingWebhookId = function (metadata) {
        return this.core.fetch('/webhooks/{webhookId}', 'get', metadata);
    };
    /**
     * Update Webhook URL using Webhook ID
     *
     * @summary Update Webhook URL using Webhook ID
     */
    SDK.prototype.updateWebhookUrlUsingWebhookId = function (body, metadata) {
        return this.core.fetch('/webhooks/{webhookId}', 'put', body, metadata);
    };
    /**
     * Delete Webhook URL using Webhook ID
     *
     * @summary Delete Webhook URL using Webhook ID
     */
    SDK.prototype.deleteWebhookUrlUsingWebhookId = function (metadata) {
        return this.core.fetch('/webhooks/{webhookId}', 'delete', metadata);
    };
    return SDK;
}());
var createSDK = (function () { return new SDK(); })();
module.exports = createSDK;
