declare const $Void: {
    readonly properties: {
        readonly order_was_voided: {
            readonly type: "boolean";
        };
        readonly captured_amount: {
            readonly type: "array";
            readonly items: {
                readonly type: "object";
                readonly properties: {
                    readonly amount: {
                        readonly type: "number";
                    };
                    readonly currency: {
                        readonly type: "string";
                        readonly enum: readonly ["SAR", "AED", "KWD", "BHD", "OMR"];
                    };
                    readonly message: {
                        readonly type: "string";
                    };
                    readonly store_code: {
                        readonly type: "string";
                    };
                };
            };
        };
    };
    readonly "x-readme-ref-name": "void";
    readonly type: "object";
};
declare const Authorise: {
    readonly properties: {
        readonly order_id: {
            readonly type: "string";
            readonly format: "uuid";
        };
        readonly status: {
            readonly type: "string";
        };
        readonly order_expiry_time: {
            readonly type: "string";
        };
        readonly payment_type: {
            readonly type: "string";
            readonly enum: readonly ["PAY_BY_INSTALMENTS", "PAY_NOW"];
        };
        readonly auto_captured: {
            readonly type: "boolean";
        };
        readonly authorized_amount: {
            readonly type: "array";
            readonly items: {
                readonly properties: {
                    readonly amount: {
                        readonly type: "number";
                    };
                    readonly currency: {
                        readonly type: "string";
                        readonly enum: readonly ["SAR", "AED", "KWD", "BHD", "OMR"];
                    };
                };
                readonly type: "object";
            };
        };
        readonly capture_id: {
            readonly type: "string";
            readonly format: "uuid";
        };
    };
    readonly "x-readme-ref-name": "authorise";
    readonly type: "object";
};
declare const AuthoriseOrder: {
    readonly metadata: {
        readonly allOf: readonly [{
            readonly type: "object";
            readonly properties: {
                readonly order_id: {
                    readonly type: "string";
                    readonly format: "uuid";
                    readonly default: "ff776045-513b-4cd7-8b4f-e60673daad84";
                    readonly examples: readonly ["ff776045-513b-4cd7-8b4f-e60673daad84"];
                    readonly $schema: "http://json-schema.org/draft-04/schema#";
                    readonly description: "Unique Tamara `order_id`, obtained from the response of create checkout/in-store checkout session endpoint.";
                };
            };
            readonly required: readonly ["order_id"];
        }];
    };
};
declare const Cancel: {
    readonly properties: {
        readonly cancel_id: {
            readonly type: "string";
            readonly format: "uuid";
        };
        readonly order_id: {
            readonly type: "string";
            readonly format: "uuid";
        };
        readonly status: {
            readonly type: "string";
            readonly enum: readonly ["updated", "canceled"];
        };
        readonly canceled_amount: {
            readonly items: {
                readonly properties: {
                    readonly amount: {
                        readonly type: "number";
                    };
                    readonly currency: {
                        readonly type: "string";
                        readonly enum: readonly ["SAR", "AED", "KWD", "BHD", "OMR"];
                    };
                };
                readonly type: "object";
            };
            readonly type: "array";
        };
    };
    readonly "x-readme-ref-name": "cancel";
    readonly type: "object";
};
declare const CancelOrder: {
    readonly body: {
        readonly type: "object";
        readonly required: readonly ["total_amount"];
        readonly properties: {
            readonly total_amount: {
                readonly type: "object";
                readonly description: "Total amount to be charged back to consumer.";
                readonly properties: {
                    readonly amount: {
                        readonly type: "number";
                        readonly default: 300;
                        readonly examples: readonly [300];
                    };
                    readonly currency: {
                        readonly type: "string";
                        readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                        readonly default: "SAR";
                        readonly examples: readonly ["SAR"];
                    };
                };
            };
            readonly shipping_amount: {
                readonly type: "object";
                readonly description: "Total amount for the shipping of the order.";
                readonly properties: {
                    readonly amount: {
                        readonly type: "number";
                        readonly minimum: 0;
                        readonly default: 0;
                        readonly examples: readonly [300];
                    };
                    readonly currency: {
                        readonly type: "string";
                        readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                        readonly default: "SAR";
                        readonly examples: readonly ["SAR"];
                    };
                };
            };
            readonly tax_amount: {
                readonly type: "object";
                readonly description: "Total amount of taxes, if additionally applied.";
                readonly properties: {
                    readonly amount: {
                        readonly type: "number";
                        readonly minimum: 0;
                        readonly default: 100;
                        readonly examples: readonly [100];
                    };
                    readonly currency: {
                        readonly type: "string";
                        readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                        readonly default: "SAR";
                        readonly examples: readonly ["SAR"];
                    };
                };
            };
            readonly discount_amount: {
                readonly type: "object";
                readonly properties: {
                    readonly amount: {
                        readonly type: "number";
                        readonly minimum: 0;
                        readonly default: 10;
                        readonly examples: readonly [10];
                    };
                    readonly currency: {
                        readonly type: "string";
                        readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                        readonly default: "SAR";
                        readonly examples: readonly ["SAR"];
                    };
                };
            };
            readonly items: {
                readonly type: "array";
                readonly items: {
                    readonly type: "object";
                    readonly required: readonly ["reference_id", "type", "name", "sku", "quantity", "total_amount"];
                    readonly description: "An array of objects to detail the items in this order as seperate objects for each item.";
                    readonly properties: {
                        readonly name: {
                            readonly type: "string";
                            readonly description: "Product name. `<=255 characters`";
                            readonly maximum: 255;
                            readonly examples: readonly ["Lego City 8601"];
                        };
                        readonly quantity: {
                            readonly type: "number";
                            readonly description: "How many of this specific item is being purchased";
                            readonly examples: readonly [1];
                        };
                        readonly reference_id: {
                            readonly type: "string";
                            readonly description: "The unique id of the item from merchant's side";
                            readonly examples: readonly ["123"];
                        };
                        readonly sku: {
                            readonly type: "string";
                            readonly description: "Product SKU. **`<= 128 characters`**";
                            readonly maximum: 128;
                            readonly examples: readonly ["SA-12436"];
                        };
                        readonly item_url: {
                            readonly type: "string";
                            readonly description: "URL of the item from merchant's website. **`<= 1024 characters`**";
                            readonly format: "uri";
                            readonly maximum: 1024;
                            readonly examples: readonly ["SA-12436"];
                        };
                        readonly image_url: {
                            readonly type: "string";
                            readonly description: "URL to an image of the product that can be later displayed to the customer. **`<= 1024 characters`** <br /> **Size** = 2-3 MB maximum <br /> **Resolution** WxH = 1024xY (the Y height of image should be small).";
                            readonly format: "uri";
                            readonly maximum: 1024;
                            readonly examples: readonly ["SA-12436"];
                        };
                        readonly unit_price: {
                            readonly type: "object";
                            readonly properties: {
                                readonly amount: {
                                    readonly type: "number";
                                    readonly examples: readonly [490];
                                };
                                readonly currency: {
                                    readonly type: "string";
                                    readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                    readonly examples: readonly ["SAR"];
                                };
                            };
                        };
                        readonly tax_amount: {
                            readonly type: "object";
                            readonly properties: {
                                readonly amount: {
                                    readonly type: "number";
                                    readonly minimum: 0;
                                    readonly examples: readonly [10];
                                };
                                readonly currency: {
                                    readonly type: "string";
                                    readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                    readonly examples: readonly ["SAR"];
                                };
                            };
                        };
                        readonly discount_amount: {
                            readonly type: "object";
                            readonly properties: {
                                readonly amount: {
                                    readonly type: "number";
                                    readonly examples: readonly [100];
                                };
                                readonly currency: {
                                    readonly type: "string";
                                    readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                    readonly examples: readonly ["SAR"];
                                };
                            };
                        };
                        readonly total_amount: {
                            readonly type: "object";
                            readonly properties: {
                                readonly amount: {
                                    readonly type: "string";
                                    readonly examples: readonly ["100"];
                                };
                                readonly currency: {
                                    readonly type: "string";
                                    readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                    readonly examples: readonly ["SAR"];
                                };
                            };
                        };
                        readonly type: {
                            readonly type: "string";
                            readonly examples: readonly ["Digital"];
                        };
                    };
                };
                readonly default: readonly [{
                    readonly name: "Lego City 8601";
                    readonly type: "Digital";
                    readonly reference_id: "123";
                    readonly sku: "SA-12436";
                    readonly quantity: 1;
                    readonly discount_amount: {
                        readonly amount: 100;
                        readonly currency: "SAR";
                    };
                    readonly tax_amount: {
                        readonly amount: 10;
                        readonly currency: "SAR";
                    };
                    readonly unit_price: {
                        readonly amount: 490;
                        readonly currency: "SAR";
                    };
                    readonly total_amount: {
                        readonly amount: 100;
                        readonly currency: "SAR";
                    };
                }];
            };
        };
        readonly $schema: "http://json-schema.org/draft-04/schema#";
    };
    readonly metadata: {
        readonly allOf: readonly [{
            readonly type: "object";
            readonly properties: {
                readonly order_id: {
                    readonly type: "string";
                    readonly format: "uuid";
                    readonly default: "ff776045-513b-4cd7-8b4f-e60673daad84";
                    readonly examples: readonly ["ff776045-513b-4cd7-8b4f-e60673daad84"];
                    readonly $schema: "http://json-schema.org/draft-04/schema#";
                    readonly description: "Unique Tamara `order_id`, obtained from the response of create checkout/in-store checkout session endpoint.";
                };
            };
            readonly required: readonly ["order_id"];
        }];
    };
    readonly response: {
        readonly "409": {
            readonly $schema: "http://json-schema.org/draft-04/schema#";
        };
    };
};
declare const Capture: {
    readonly properties: {
        readonly capture_id: {
            readonly type: "string";
            readonly format: "uuid";
        };
        readonly order_id: {
            readonly type: "string";
            readonly format: "uuid";
        };
        readonly status: {
            readonly type: "string";
            readonly enum: readonly ["fully_captured", "partially_captured"];
        };
        readonly captured_amount: {
            readonly items: {
                readonly properties: {
                    readonly amount: {
                        readonly type: "number";
                    };
                    readonly currency: {
                        readonly type: "string";
                        readonly enum: readonly ["SAR", "AED", "KWD", "BHD", "OMR"];
                    };
                };
                readonly type: "object";
            };
            readonly type: "array";
        };
    };
    readonly "x-readme-ref-name": "capture";
    readonly type: "object";
};
declare const CaptureOrder: {
    readonly body: {
        readonly type: "object";
        readonly required: readonly ["order_id", "total_amount", "shipping_info"];
        readonly properties: {
            readonly order_id: {
                readonly type: "string";
                readonly description: "Unique Tamara `order_id`, obtained from the response of create checkout/in-store checkout session endpoint.";
                readonly format: "uuid";
                readonly default: "8fe4cce9-d0aa-4020-a863-c708547795e9";
                readonly examples: readonly ["8fe4cce9-d0aa-4020-a863-c708547795e9"];
            };
            readonly total_amount: {
                readonly type: "object";
                readonly description: "Total amount to be captured out of the original order total.";
                readonly properties: {
                    readonly amount: {
                        readonly type: "number";
                        readonly default: 300;
                        readonly examples: readonly [300];
                    };
                    readonly currency: {
                        readonly type: "string";
                        readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                        readonly default: "SAR";
                        readonly examples: readonly ["SAR"];
                    };
                };
            };
            readonly shipping_info: {
                readonly type: "object";
                readonly required: readonly ["shipped_at", "shipping_company"];
                readonly properties: {
                    readonly shipped_at: {
                        readonly type: "string";
                        readonly description: "<date-time>";
                        readonly default: "2020-03-31T19:19:52.677Z";
                        readonly examples: readonly ["2020-03-31T19:19:52.677Z"];
                    };
                    readonly shipping_company: {
                        readonly type: "string";
                        readonly description: "Name of the shipping company. Limited to 100 characters.";
                        readonly maximum: 100;
                        readonly default: "DHL";
                        readonly examples: readonly ["DHL, Aramex, SMSA"];
                    };
                    readonly tracking_number: {
                        readonly type: "string";
                        readonly description: "Tracking number of shipment. Limited to 100 characters.";
                        readonly maximum: 100;
                        readonly default: "100";
                        readonly examples: readonly ["123456"];
                    };
                    readonly tracking_url: {
                        readonly type: "string";
                        readonly description: "URL where the customer can track their shipment. `<=1024 characters`.";
                        readonly format: "uri";
                        readonly default: "https://shipping.com/tracking?id=123456";
                        readonly maximum: 1024;
                        readonly examples: readonly ["https://shipping.com/tracking?id=123456"];
                    };
                };
            };
            readonly items: {
                readonly type: "array";
                readonly items: {
                    readonly type: "object";
                    readonly required: readonly ["reference_id", "type", "name", "sku", "quantity", "total_amount"];
                    readonly description: "An array of objects to detail the items in this order as seperate objects for each item.";
                    readonly properties: {
                        readonly name: {
                            readonly type: "string";
                            readonly description: "Product name. `<=255 characters`.";
                            readonly maximum: 255;
                            readonly examples: readonly ["Lego City 8601"];
                        };
                        readonly quantity: {
                            readonly type: "number";
                            readonly description: "The quantity being fulfilled for this specific item.";
                            readonly examples: readonly [1];
                        };
                        readonly reference_id: {
                            readonly type: "string";
                            readonly description: "The unique id of the item from merchant's side";
                            readonly examples: readonly ["123"];
                        };
                        readonly sku: {
                            readonly type: "string";
                            readonly description: "Product SKU. **`<= 128 characters`**";
                            readonly maximum: 128;
                            readonly examples: readonly ["SA-12436"];
                        };
                        readonly item_url: {
                            readonly type: "string";
                            readonly description: "URL of the item from merchant's website. **`<= 1024 characters`**";
                            readonly format: "uri";
                            readonly maximum: 1024;
                            readonly examples: readonly ["SA-12436"];
                        };
                        readonly image_url: {
                            readonly type: "string";
                            readonly description: "URL to an image of the product that can be later displayed to the customer. **`<= 1024 characters`** <br /> **Size** = 2-3 MB maximum <br /> **Resolution** WxH = 1024xY (the Y height of image should be small).";
                            readonly format: "uri";
                            readonly maximum: 1024;
                            readonly examples: readonly ["SA-12436"];
                        };
                        readonly unit_price: {
                            readonly type: "object";
                            readonly properties: {
                                readonly amount: {
                                    readonly type: "number";
                                    readonly examples: readonly [490];
                                };
                                readonly currency: {
                                    readonly type: "string";
                                    readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                    readonly examples: readonly ["SAR"];
                                };
                            };
                        };
                        readonly tax_amount: {
                            readonly type: "object";
                            readonly properties: {
                                readonly amount: {
                                    readonly type: "number";
                                    readonly minimum: 0;
                                    readonly examples: readonly [10];
                                };
                                readonly currency: {
                                    readonly type: "string";
                                    readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                    readonly examples: readonly ["SAR"];
                                };
                            };
                        };
                        readonly discount_amount: {
                            readonly type: "object";
                            readonly properties: {
                                readonly amount: {
                                    readonly type: "number";
                                    readonly examples: readonly [100];
                                };
                                readonly currency: {
                                    readonly type: "string";
                                    readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                    readonly examples: readonly ["SAR"];
                                };
                            };
                        };
                        readonly total_amount: {
                            readonly type: "object";
                            readonly properties: {
                                readonly amount: {
                                    readonly type: "string";
                                    readonly examples: readonly ["100"];
                                };
                                readonly currency: {
                                    readonly type: "string";
                                    readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                    readonly examples: readonly ["SAR"];
                                };
                            };
                        };
                        readonly type: {
                            readonly type: "string";
                            readonly examples: readonly ["Digital"];
                        };
                    };
                };
                readonly default: readonly [{
                    readonly name: "Lego City 8601";
                    readonly type: "Digital";
                    readonly reference_id: "123";
                    readonly sku: "SA-12436";
                    readonly quantity: 1;
                    readonly discount_amount: {
                        readonly amount: 100;
                        readonly currency: "SAR";
                    };
                    readonly tax_amount: {
                        readonly amount: 10;
                        readonly currency: "SAR";
                    };
                    readonly unit_price: {
                        readonly amount: 490;
                        readonly currency: "SAR";
                    };
                    readonly total_amount: {
                        readonly amount: 100;
                        readonly currency: "SAR";
                    };
                }];
            };
            readonly discount_amount: {
                readonly type: "object";
                readonly properties: {
                    readonly amount: {
                        readonly type: "string";
                        readonly default: 0;
                        readonly examples: readonly [0];
                    };
                    readonly currency: {
                        readonly type: "string";
                        readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                        readonly default: "SAR";
                        readonly examples: readonly ["SAR"];
                    };
                };
            };
            readonly shipping_amount: {
                readonly type: "object";
                readonly description: "Total amount for the shipping of the order.";
                readonly properties: {
                    readonly amount: {
                        readonly type: "number";
                        readonly minimum: 0;
                        readonly default: 0;
                        readonly examples: readonly [0];
                    };
                    readonly currency: {
                        readonly type: "string";
                        readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                        readonly default: "SAR";
                        readonly examples: readonly ["SAR"];
                    };
                };
            };
            readonly tax_amount: {
                readonly type: "object";
                readonly description: "Total amount of taxes, if additionally applied.";
                readonly properties: {
                    readonly amount: {
                        readonly type: "number";
                        readonly minimum: 0;
                        readonly default: 100;
                        readonly examples: readonly [300];
                    };
                    readonly currency: {
                        readonly type: "string";
                        readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                        readonly default: "SAR";
                        readonly examples: readonly ["SAR"];
                    };
                };
            };
        };
        readonly $schema: "http://json-schema.org/draft-04/schema#";
    };
};
declare const CheckPaymentOptionsAvailability: {
    readonly body: {
        readonly type: "object";
        readonly required: readonly ["country", "order_value", "phone_number"];
        readonly properties: {
            readonly country: {
                readonly type: "string";
                readonly description: "The unique ISO country code for the country that the merchant is located in";
                readonly enum: readonly ["SA", "AE", "BH", "KW", "OM"];
                readonly default: "SA";
                readonly examples: readonly ["SA"];
            };
            readonly phone_number: {
                readonly type: "string";
                readonly description: "The customer's phone number.";
                readonly default: "544337766";
                readonly examples: readonly ["567483922"];
            };
            readonly order_value: {
                readonly type: "object";
                readonly properties: {
                    readonly amount: {
                        readonly type: "number";
                        readonly description: "The exact format depends on the currency. By default we support 2 decimals, but for BHD, KWD and OMR we support 3 decimals.";
                        readonly minimum: 0.1;
                        readonly default: 100;
                        readonly examples: readonly [100];
                    };
                    readonly currency: {
                        readonly type: "string";
                        readonly description: "The three-letter ISO currency code";
                        readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                        readonly default: "SAR";
                        readonly examples: readonly ["SAR"];
                    };
                };
            };
            readonly is_vip: {
                readonly type: "boolean";
                readonly description: "Consider if customer is VIP at merchant's side while fetching payment options";
                readonly default: false;
                readonly examples: readonly [false];
            };
        };
        readonly $schema: "http://json-schema.org/draft-04/schema#";
    };
};
declare const Checkout: {
    readonly properties: {
        readonly checkout_id: {
            readonly type: "string";
            readonly format: "uuid";
        };
        readonly order_id: {
            readonly type: "string";
            readonly format: "uuid";
        };
        readonly status: {
            readonly type: "string";
        };
        readonly checkout_url: {
            readonly type: "string";
        };
    };
    readonly "x-readme-ref-name": "checkout";
    readonly type: "object";
};
declare const CheckoutInstore: {
    readonly properties: {
        readonly checkout_id: {
            readonly type: "string";
            readonly format: "uuid";
        };
        readonly order_id: {
            readonly type: "string";
            readonly format: "uuid";
        };
        readonly checkout_deeplink: {
            readonly type: "string";
        };
    };
    readonly "x-readme-ref-name": "checkout-instore";
    readonly type: "object";
};
declare const CreateCheckoutSession: {
    readonly body: {
        readonly type: "object";
        readonly required: readonly ["order_reference_id", "total_amount", "description", "country_code", "payment_type", "items", "consumer", "shipping_address", "tax_amount", "shipping_amount", "merchant_url", "instalments"];
        readonly properties: {
            readonly total_amount: {
                readonly type: "object";
                readonly description: "Total amount to be charged to consumer.";
                readonly properties: {
                    readonly amount: {
                        readonly type: "number";
                        readonly minimum: 0.1;
                        readonly default: 300;
                        readonly examples: readonly [300];
                    };
                    readonly currency: {
                        readonly type: "string";
                        readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                        readonly default: "SAR";
                        readonly examples: readonly ["SAR"];
                    };
                };
            };
            readonly shipping_amount: {
                readonly type: "object";
                readonly description: "Total amount for the shipping of the order.";
                readonly properties: {
                    readonly amount: {
                        readonly type: "string";
                        readonly minimum: 0;
                        readonly default: 1;
                        readonly examples: readonly [0];
                    };
                    readonly currency: {
                        readonly type: "string";
                        readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                        readonly default: "SAR";
                        readonly examples: readonly ["SAR"];
                    };
                };
            };
            readonly tax_amount: {
                readonly type: "object";
                readonly description: "Total amount of taxes, if additionally applied.";
                readonly properties: {
                    readonly amount: {
                        readonly type: "string";
                        readonly minimum: 0;
                        readonly default: 1;
                        readonly examples: readonly [0];
                    };
                    readonly currency: {
                        readonly type: "string";
                        readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                        readonly default: "SAR";
                        readonly examples: readonly ["SAR"];
                    };
                };
            };
            readonly order_reference_id: {
                readonly type: "string";
                readonly description: "Unique order ID from the merchant's side, which will be used for settlement and reporting purposes. Can be modified after the checkout session is created.";
                readonly default: "abd12331-a123-1234-4567-fbde34ae";
                readonly examples: readonly ["A1231234123"];
            };
            readonly order_number: {
                readonly type: "string";
                readonly description: "The order number from the merchant side, this will be used for communication with the customer. If this value is not passed, the order_number will take the order_reference_id value.";
                readonly default: "A123125";
                readonly examples: readonly ["A1231234123"];
            };
            readonly discount: {
                readonly type: "object";
                readonly required: readonly ["name", "amount"];
                readonly description: "This object is used to mention any customer-specific discount/voucher code being used for this specific order, but not to be used for site-wide discounts.";
                readonly properties: {
                    readonly name: {
                        readonly type: "string";
                        readonly default: "Voucher A";
                        readonly examples: readonly ["Christmas 2020"];
                    };
                    readonly amount: {
                        readonly type: "object";
                        readonly properties: {
                            readonly amount: {
                                readonly type: "number";
                                readonly minimum: 0;
                                readonly default: 0;
                                readonly examples: readonly [200];
                            };
                            readonly currency: {
                                readonly type: "string";
                                readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                readonly default: "SAR";
                                readonly examples: readonly ["SAR"];
                            };
                        };
                    };
                };
            };
            readonly items: {
                readonly type: "array";
                readonly items: {
                    readonly type: "object";
                    readonly required: readonly ["reference_id", "type", "name", "sku", "quantity", "total_amount"];
                    readonly description: "An array of objects to detail the items in this order as seperate objects for each item.";
                    readonly properties: {
                        readonly name: {
                            readonly type: "string";
                            readonly description: "Product name. `<=255 characters`.";
                            readonly maximum: 255;
                            readonly default: "Lego City 8601";
                            readonly examples: readonly ["Lego City 8601"];
                        };
                        readonly quantity: {
                            readonly type: "number";
                            readonly description: "The quantity being purchased for this specific item.";
                            readonly default: 1;
                            readonly examples: readonly [1];
                        };
                        readonly reference_id: {
                            readonly type: "string";
                            readonly description: "The unique id of the item from merchant's side";
                            readonly default: "123";
                            readonly examples: readonly ["123"];
                        };
                        readonly type: {
                            readonly type: "string";
                            readonly default: "Physical";
                            readonly examples: readonly ["Digital, Physical...etc."];
                        };
                        readonly sku: {
                            readonly type: "string";
                            readonly description: "Product SKU. **`<= 128 characters`**";
                            readonly maximum: 128;
                            readonly default: "SA-12345";
                            readonly examples: readonly ["SA-12436"];
                        };
                        readonly item_url: {
                            readonly type: "string";
                            readonly description: "URL of the item from merchant's website. **`<= 1024 characters`**";
                            readonly format: "uri";
                            readonly maximum: 1024;
                            readonly default: "https://item-url.com/1234";
                            readonly examples: readonly ["SA-12436"];
                        };
                        readonly image_url: {
                            readonly type: "string";
                            readonly description: "URL to an image of the product that can be later displayed to the customer. **`<= 1024 characters`** <br /> **Size** = 2-3 MB maximum <br /> **Resolution** WxH = 1024xY (the Y height of image should be small).";
                            readonly format: "uri";
                            readonly maximum: 1024;
                            readonly default: "https://image-url.com/1234";
                            readonly examples: readonly ["SA-12436"];
                        };
                        readonly unit_price: {
                            readonly type: "object";
                            readonly properties: {
                                readonly amount: {
                                    readonly type: "number";
                                    readonly default: 100;
                                    readonly examples: readonly [490];
                                };
                                readonly currency: {
                                    readonly type: "string";
                                    readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                    readonly default: "SAR";
                                    readonly examples: readonly ["SAR"];
                                };
                            };
                        };
                        readonly tax_amount: {
                            readonly type: "object";
                            readonly properties: {
                                readonly amount: {
                                    readonly type: "number";
                                    readonly minimum: 0;
                                    readonly default: 1;
                                    readonly examples: readonly [10];
                                };
                                readonly currency: {
                                    readonly type: "string";
                                    readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                    readonly default: "SAR";
                                    readonly examples: readonly ["SAR"];
                                };
                            };
                        };
                        readonly discount_amount: {
                            readonly type: "object";
                            readonly properties: {
                                readonly amount: {
                                    readonly type: "number";
                                    readonly minimum: 0;
                                    readonly examples: readonly [100];
                                };
                                readonly currency: {
                                    readonly type: "string";
                                    readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                    readonly default: "SAR";
                                    readonly examples: readonly ["SAR"];
                                };
                            };
                        };
                        readonly total_amount: {
                            readonly type: "object";
                            readonly properties: {
                                readonly amount: {
                                    readonly type: "string";
                                    readonly default: 100;
                                    readonly examples: readonly [100];
                                };
                                readonly currency: {
                                    readonly type: "string";
                                    readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                    readonly default: "SAR";
                                    readonly examples: readonly ["SAR"];
                                };
                            };
                        };
                    };
                };
                readonly default: readonly [{
                    readonly name: "Lego City 8601";
                    readonly type: "Digital";
                    readonly reference_id: "123";
                    readonly sku: "SA-12436";
                    readonly quantity: 1;
                    readonly discount_amount: {
                        readonly amount: 100;
                        readonly currency: "SAR";
                    };
                    readonly tax_amount: {
                        readonly amount: 10;
                        readonly currency: "SAR";
                    };
                    readonly unit_price: {
                        readonly amount: 490;
                        readonly currency: "SAR";
                    };
                    readonly total_amount: {
                        readonly amount: 100;
                        readonly currency: "SAR";
                    };
                }];
            };
            readonly consumer: {
                readonly type: "object";
                readonly description: "The customer's identifying details.";
                readonly required: readonly ["first_name", "last_name", "phone_number"];
                readonly properties: {
                    readonly email: {
                        readonly type: "string";
                        readonly format: "email";
                        readonly default: "customer@email.com";
                        readonly examples: readonly ["customer@email.com"];
                    };
                    readonly first_name: {
                        readonly type: "string";
                        readonly default: "Mona";
                        readonly examples: readonly ["Mona"];
                    };
                    readonly last_name: {
                        readonly type: "string";
                        readonly default: "Lisa";
                        readonly examples: readonly ["Lisa"];
                    };
                    readonly phone_number: {
                        readonly type: "string";
                        readonly default: "566027755";
                        readonly examples: readonly ["566027755"];
                    };
                };
            };
            readonly country_code: {
                readonly type: "string";
                readonly description: "The two-character ISO 3166-1 country code";
                readonly enum: readonly ["SA", "AE", "BH", "KW", "OM"];
                readonly default: "SA";
                readonly examples: readonly ["SA"];
            };
            readonly description: {
                readonly type: "string";
                readonly description: "The order description.";
                readonly maximum: 256;
                readonly default: "Enter order description here.";
                readonly examples: readonly ["lorem ipsum dolor"];
            };
            readonly merchant_url: {
                readonly type: "object";
                readonly required: readonly ["success", "failure", "cancel"];
                readonly description: "This object includes all the redirect URLs that the customer will be redirected to from the Tamara checkout page in different cases.";
                readonly properties: {
                    readonly cancel: {
                        readonly type: "string";
                        readonly format: "uri";
                        readonly default: "http://example.com/#/cancel";
                        readonly examples: readonly ["http://example.com/#/cancel"];
                    };
                    readonly failure: {
                        readonly type: "string";
                        readonly format: "uri";
                        readonly default: "http://example.com/#/fail";
                        readonly examples: readonly ["http://example.com/#/fail"];
                    };
                    readonly success: {
                        readonly type: "string";
                        readonly format: "uri";
                        readonly default: "http://example.com/#/success";
                        readonly examples: readonly ["http://example.com/#/success"];
                    };
                };
            };
            readonly billing_address: {
                readonly type: "object";
                readonly description: "The customer's billing address, if any.";
                readonly properties: {
                    readonly city: {
                        readonly type: "string";
                        readonly default: "Riyadh";
                        readonly examples: readonly ["Riyadh"];
                    };
                    readonly country_code: {
                        readonly type: "string";
                        readonly description: "The two-character ISO 3166-1 country code";
                        readonly enum: readonly ["SA", "AE", "BH", "KW", "OM"];
                        readonly default: "SA";
                        readonly examples: readonly ["SA"];
                    };
                    readonly first_name: {
                        readonly type: "string";
                        readonly default: "Mona";
                        readonly examples: readonly ["Mona"];
                    };
                    readonly last_name: {
                        readonly type: "string";
                        readonly default: "Lisa";
                        readonly examples: readonly ["Lisa"];
                    };
                    readonly line1: {
                        readonly type: "string";
                        readonly default: "3764 Al Urubah Rd";
                        readonly examples: readonly ["3764 Al Urubah Rd"];
                    };
                    readonly line2: {
                        readonly type: "string";
                        readonly default: "string";
                        readonly examples: readonly ["string"];
                    };
                    readonly phone_number: {
                        readonly type: "string";
                        readonly default: "532298658";
                        readonly examples: readonly ["532298658"];
                    };
                    readonly region: {
                        readonly type: "string";
                        readonly default: "As Sulimaniyah";
                        readonly examples: readonly ["As Sulimaniyah"];
                    };
                };
            };
            readonly shipping_address: {
                readonly type: "object";
                readonly required: readonly ["first_name", "last_name", "line1", "city", "country_code"];
                readonly properties: {
                    readonly city: {
                        readonly type: "string";
                        readonly default: "Riyadh";
                        readonly examples: readonly ["Riyadh"];
                    };
                    readonly country_code: {
                        readonly type: "string";
                        readonly description: "The two-character ISO 3166-1 country code";
                        readonly enum: readonly ["SA", "AE", "BH", "KW", "OM"];
                        readonly default: "SA";
                        readonly examples: readonly ["SA"];
                    };
                    readonly first_name: {
                        readonly type: "string";
                        readonly default: "Mona";
                        readonly examples: readonly ["Mona"];
                    };
                    readonly last_name: {
                        readonly type: "string";
                        readonly default: "Lisa";
                        readonly examples: readonly ["Lisa'"];
                    };
                    readonly line1: {
                        readonly type: "string";
                        readonly default: "3764 Al Urubah Rd";
                        readonly examples: readonly ["3764 Al Urubah Rd"];
                    };
                    readonly line2: {
                        readonly type: "string";
                        readonly default: "string";
                        readonly examples: readonly ["string"];
                    };
                    readonly phone_number: {
                        readonly type: "string";
                        readonly default: "532298658";
                        readonly examples: readonly ["532298658"];
                    };
                    readonly region: {
                        readonly type: "string";
                        readonly default: "As Sulimaniyah";
                        readonly examples: readonly ["As Sulimaniyah"];
                    };
                };
            };
            readonly platform: {
                readonly type: "string";
                readonly description: "Mentions the platform where the Tamara order is being initiated from (Mostly used by our e-commerce plugins) but can also be used by direct integrations.";
                readonly default: "platform name here";
                readonly examples: readonly ["Magento, WooCommerce, Salla..etc."];
            };
            readonly is_mobile: {
                readonly type: "boolean";
                readonly description: "To identify mobile users of your store.";
                readonly default: false;
                readonly examples: readonly [false];
            };
            readonly locale: {
                readonly type: "string";
                readonly description: "Display language for Tamara checkout page. Language to be defined by the merchant following RFC 1766, e.g en_US or ar_SA. Default is set to Arabic if not passed and customer is new. If customer already exists and locale is not passed then customer's preference will be taken into account.";
                readonly enum: readonly ["ar_SA", "en_US"];
                readonly default: "ar_SA";
                readonly examples: readonly ["ar_SA"];
            };
            readonly risk_assessment: {
                readonly type: "object";
                readonly description: "Risk assessment info from the merchant side";
                readonly properties: {
                    readonly customer_age: {
                        readonly type: "integer";
                        readonly description: "Customer age in Years";
                        readonly default: 21;
                        readonly examples: readonly [21];
                    };
                    readonly customer_dob: {
                        readonly type: "string";
                        readonly description: "Customer Date of Birth (format dd-mm-yyyy)";
                        readonly maximum: 10;
                        readonly default: "01-12-2000";
                        readonly examples: readonly ["01-12-2000"];
                    };
                    readonly customer_gender: {
                        readonly type: "string";
                        readonly enum: readonly ["Male", "Female"];
                        readonly description: "Customer's gender";
                        readonly default: "Female";
                        readonly examples: readonly ["Male"];
                    };
                    readonly customer_nationality: {
                        readonly type: "string";
                        readonly description: "Customer nationality code (ISO 2 letter)";
                        readonly default: "SA";
                        readonly examples: readonly ["SA or IN or KW"];
                    };
                    readonly is_premium_customer: {
                        readonly type: "boolean";
                        readonly description: "Is VIP or any kind of premium customer tiers like Platinum, Gold...etc";
                        readonly default: false;
                        readonly examples: readonly [false];
                    };
                    readonly is_existing_customer: {
                        readonly type: "boolean";
                        readonly description: "Customer's account was created in the past, not on the same day as the order is created.";
                        readonly default: false;
                        readonly examples: readonly [false];
                    };
                    readonly is_guest_user: {
                        readonly type: "boolean";
                        readonly description: "Is the customer performing guest checkout on your store.";
                        readonly default: false;
                        readonly examples: readonly [false];
                    };
                    readonly account_creation_date: {
                        readonly type: "string";
                        readonly description: "Date of customer registration of their account (format dd-mm-yyyy)";
                        readonly maximum: 10;
                        readonly default: "12-06-2020";
                        readonly examples: readonly ["12-06-2020"];
                    };
                    readonly platform_account_creation_date: {
                        readonly type: "string";
                        readonly description: "Date of customer registration of their account with the platform like Salla (format dd-mm-yyyy)";
                        readonly maximum: 10;
                        readonly default: "12-06-2020";
                        readonly examples: readonly ["12-06-2020"];
                    };
                    readonly date_of_first_transaction: {
                        readonly type: "string";
                        readonly description: "Date of consumer’s first transaction. (format dd-mm-yyyy)";
                        readonly maximum: 10;
                        readonly default: "12-06-2020";
                        readonly examples: readonly ["12-06-2020"];
                    };
                    readonly is_card_on_file: {
                        readonly type: "boolean";
                        readonly description: "Does customer have any saved cards on his account?";
                        readonly default: false;
                        readonly examples: readonly [true];
                    };
                    readonly is_COD_customer: {
                        readonly type: "boolean";
                        readonly description: "Does customer only use Cash on Delivery as their payment method previously?";
                        readonly default: false;
                        readonly examples: readonly [false];
                    };
                    readonly has_delivered_order: {
                        readonly type: "boolean";
                        readonly description: "Does the customer have successfully delivered orders in the past?";
                        readonly default: true;
                        readonly examples: readonly [false];
                    };
                    readonly is_phone_verified: {
                        readonly type: "boolean";
                        readonly description: "Is the customer's registered phone verified?";
                        readonly default: false;
                        readonly examples: readonly [false];
                    };
                    readonly is_fraudulent_customer: {
                        readonly type: "boolean";
                        readonly description: "Does customer have any history of fraudulent activity in your records like false chargebacks, stolen card usage etc.?";
                        readonly default: false;
                        readonly examples: readonly [false];
                    };
                    readonly total_ltv: {
                        readonly type: "number";
                        readonly description: "Lifetime value. The total amount (in local currency) the consumer has ordered, excluding canceled, rejected, or refunded transactions. Also excluding **Tamara** payments.";
                        readonly default: 200;
                        readonly examples: readonly [200];
                    };
                    readonly total_order_count: {
                        readonly type: "integer";
                        readonly description: "Number of orders the customer has made at your store since creating an account, excluding canceled, rejected, or refunded transactions. Also excluding **Tamara** payments.";
                        readonly default: 15;
                        readonly examples: readonly [15];
                    };
                    readonly order_amount_last3months: {
                        readonly type: "number";
                        readonly description: "Amount the consumer spent in the last 3 months, excluding canceled, rejected, or refunded transactions. Also excluding **Tamara** payments.";
                        readonly default: 2000;
                        readonly examples: readonly [2000];
                    };
                    readonly order_count_last3months: {
                        readonly type: "integer";
                        readonly description: "Number of orders the consumer placed in the last 3 months, excluding canceled, rejected, or refunded transactions. Also excluding **Tamara** payments.";
                        readonly default: 10;
                        readonly examples: readonly [10];
                    };
                    readonly last_order_date: {
                        readonly type: "string";
                        readonly description: "Date on which the consumer made their last purchase, excluding **Tamara** payments (format dd-mm-yyyy)";
                        readonly maximum: 10;
                        readonly default: "12-06-2020";
                        readonly examples: readonly ["12-06-2020"];
                    };
                    readonly last_order_amount: {
                        readonly type: "number";
                        readonly description: "Amount (in local currency) of the last order, excluding **Tamara** payments.";
                        readonly default: 2000;
                        readonly examples: readonly [2000];
                    };
                    readonly reward_program_enrolled: {
                        readonly type: "boolean";
                        readonly description: "Is customer enrolled in any of your reward program?";
                        readonly default: false;
                        readonly examples: readonly [false];
                    };
                    readonly reward_program_points: {
                        readonly type: "number";
                        readonly description: "Number of reward points earned by the customer so far.";
                        readonly default: 2000;
                        readonly examples: readonly [2000];
                    };
                };
            };
            readonly expires_in_minutes: {
                readonly type: "integer";
                readonly description: "Order expiry time in minutes, min 5 minutes, max 1440 (one day). By default this key will be ignored, and default value of 30 mins is used, **Please contact our support team to enable this feature**.";
                readonly minimum: 5;
                readonly maximum: 1440;
                readonly examples: readonly [30];
            };
            readonly additional_data: {
                readonly type: "object";
                readonly description: "Any additional order data information from the merchant side";
                readonly properties: {
                    readonly delivery_method: {
                        readonly type: "string";
                        readonly description: "the delivery method selected by the customer e.g. home delivery, or click and collect";
                        readonly default: "Home Delivery";
                        readonly examples: readonly ["Home Delivery"];
                    };
                    readonly pickup_store: {
                        readonly type: "string";
                        readonly description: "the collection point selected by the user if his order is for store collection";
                        readonly default: "Store A";
                        readonly examples: readonly ["Store A"];
                    };
                    readonly store_code: {
                        readonly type: "string";
                        readonly description: "The unique store code/name from which request is called";
                        readonly default: "Branch A";
                        readonly examples: readonly ["Branch A"];
                    };
                    readonly vendor_amount: {
                        readonly type: "number";
                        readonly description: "The amount to be settled to vendor";
                        readonly default: 0;
                        readonly examples: readonly [10];
                    };
                    readonly merchant_settlement_amount: {
                        readonly type: "number";
                        readonly description: "The amount to be settled to merchant";
                        readonly default: 0;
                        readonly examples: readonly [100];
                    };
                    readonly vendor_reference_code: {
                        readonly type: "string";
                        readonly description: "The vendor identifier";
                        readonly default: "AZ1234";
                        readonly examples: readonly ["AZ1234"];
                    };
                };
            };
        };
        readonly $schema: "http://json-schema.org/draft-04/schema#";
    };
    readonly response: {
        readonly "400": {
            readonly $schema: "http://json-schema.org/draft-04/schema#";
        };
    };
};
declare const CreateInStoreCheckoutSession: {
    readonly body: {
        readonly type: "object";
        readonly required: readonly ["total_amount", "phone_number", "order_reference_id", "items"];
        readonly properties: {
            readonly total_amount: {
                readonly type: "object";
                readonly description: "Total amount to be charged to consumer.";
                readonly properties: {
                    readonly amount: {
                        readonly type: "number";
                        readonly default: 300;
                        readonly examples: readonly [300];
                    };
                    readonly currency: {
                        readonly type: "string";
                        readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                        readonly default: "SAR";
                        readonly examples: readonly ["SAR"];
                    };
                };
            };
            readonly phone_number: {
                readonly type: "string";
                readonly description: "The customer's phone number, on which the customer will receive an SMS containing a payment link. This will be used to complete the transaction via Tamara.";
                readonly default: "534274516";
                readonly examples: readonly ["534274516"];
            };
            readonly email: {
                readonly type: "string";
                readonly description: "The customer's email address, designated to receive the payment link. Serves as a backup option in case of mobile coverage issues affecting the phone number.";
                readonly format: "email";
                readonly default: "customer@emailhere.com";
                readonly examples: readonly ["customer@emailhere.com"];
            };
            readonly order_reference_id: {
                readonly type: "string";
                readonly description: "The unique order id from merchant side, this will be used with the settlement and reports";
                readonly default: "1231234123-234a-fe21-1234-a324af2";
                readonly examples: readonly ["1231234123-234a-fe21-1234-a324af2"];
            };
            readonly order_number: {
                readonly type: "string";
                readonly description: "Unique order ID from the merchant's side, which will be used for settlement and reporting purposes. Can be modified after the checkout session is created.";
                readonly default: "A1231234123";
                readonly examples: readonly ["A1231234123"];
            };
            readonly items: {
                readonly type: "array";
                readonly items: {
                    readonly type: "object";
                    readonly required: readonly ["reference_id", "type", "name", "sku", "quantity", "total_amount"];
                    readonly description: "An array of objects to detail the items in this order as seperate objects for each item.";
                    readonly properties: {
                        readonly name: {
                            readonly type: "string";
                            readonly description: "Product name. `<=255 characters`.";
                            readonly maximum: 255;
                            readonly examples: readonly ["Lego City 8601"];
                        };
                        readonly quantity: {
                            readonly type: "number";
                            readonly description: "How many of this specific item is being purchased";
                            readonly examples: readonly [1];
                        };
                        readonly type: {
                            readonly type: "string";
                            readonly default: "Physical";
                            readonly examples: readonly ["Digital, Physical...etc."];
                        };
                        readonly reference_id: {
                            readonly type: "string";
                            readonly description: "The unique id of the item from merchant's side";
                            readonly examples: readonly ["123"];
                        };
                        readonly sku: {
                            readonly type: "string";
                            readonly description: "Product SKU. **`<= 128 characters`**";
                            readonly maximum: 128;
                            readonly examples: readonly ["SA-12436"];
                        };
                        readonly item_url: {
                            readonly type: "string";
                            readonly description: "URL of the item from merchant's website. **`<= 1024 characters`**";
                            readonly format: "uri";
                            readonly maximum: 1024;
                            readonly examples: readonly ["SA-12436"];
                        };
                        readonly image_url: {
                            readonly type: "string";
                            readonly description: "URL to an image of the product that can be later displayed to the customer. **`<= 1024 characters`** <br /> **Size** = 2-3 MB maximum <br /> **Resolution** WxH = 1024xY (the Y height of image should be small).";
                            readonly format: "uri";
                            readonly maximum: 1024;
                            readonly examples: readonly ["SA-12436"];
                        };
                        readonly unit_price: {
                            readonly type: "object";
                            readonly properties: {
                                readonly amount: {
                                    readonly type: "number";
                                    readonly examples: readonly [490];
                                };
                                readonly currency: {
                                    readonly type: "string";
                                    readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                    readonly examples: readonly ["SAR"];
                                };
                            };
                        };
                        readonly tax_amount: {
                            readonly type: "object";
                            readonly properties: {
                                readonly amount: {
                                    readonly type: "number";
                                    readonly minimum: 0;
                                    readonly examples: readonly [10];
                                };
                                readonly currency: {
                                    readonly type: "string";
                                    readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                    readonly examples: readonly ["SAR"];
                                };
                            };
                        };
                        readonly discount_amount: {
                            readonly type: "object";
                            readonly properties: {
                                readonly amount: {
                                    readonly type: "number";
                                    readonly examples: readonly [100];
                                };
                                readonly currency: {
                                    readonly type: "string";
                                    readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                    readonly examples: readonly ["SAR"];
                                };
                            };
                        };
                        readonly total_amount: {
                            readonly type: "object";
                            readonly properties: {
                                readonly amount: {
                                    readonly type: "string";
                                    readonly examples: readonly ["100"];
                                };
                                readonly currency: {
                                    readonly type: "string";
                                    readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                    readonly examples: readonly ["SAR"];
                                };
                            };
                        };
                    };
                };
                readonly default: readonly [{
                    readonly name: "Lego City 8601";
                    readonly type: "Digital";
                    readonly reference_id: "123";
                    readonly sku: "SA-12436";
                    readonly quantity: 1;
                    readonly discount_amount: {
                        readonly amount: 100;
                        readonly currency: "SAR";
                    };
                    readonly tax_amount: {
                        readonly amount: 10;
                        readonly currency: "SAR";
                    };
                    readonly unit_price: {
                        readonly amount: 490;
                        readonly currency: "SAR";
                    };
                    readonly total_amount: {
                        readonly amount: 100;
                        readonly currency: "SAR";
                    };
                }];
            };
            readonly locale: {
                readonly type: "string";
                readonly description: "Display language for Tamara checkout page. Language to be defined by the merchant following RFC 1766, e.g `en_US` or `ar_SA`. Default is set to Arabic if value not passed and customer is new. If customer already exists and locale is not passed then customer's preference will be taken into account.";
                readonly enum: readonly ["ar_SA", "en_US"];
                readonly default: "ar_SA";
                readonly examples: readonly ["ar_SA"];
            };
            readonly payment_type: {
                readonly type: "string";
                readonly description: "The payment method offered by Tamara that you want to offer to your customer for this checkout session.";
                readonly enum: readonly ["PAY_BY_INSTALMENTS", "PAY_NOW"];
                readonly default: "PAY_BY_INSTALMENTS";
                readonly examples: readonly ["PAY_BY_INSTALMENTS"];
            };
            readonly expiry_time: {
                readonly type: "integer";
                readonly description: "Order expiry time in minutes, min 5 minutes, max 1440 (one day). By default this key will be ignored, and default value of 15 mins is used, **Please contact our support team to enable this feature**.";
                readonly minimum: 5;
                readonly maximum: 1440;
                readonly examples: readonly [15];
            };
            readonly additional_data: {
                readonly type: "object";
                readonly required: readonly ["store_code"];
                readonly description: "Additional order data information from the merchant side";
                readonly properties: {
                    readonly store_code: {
                        readonly type: "string";
                        readonly description: "The unique store code/name from which request is called";
                        readonly default: "Branch A";
                        readonly examples: readonly ["Branch A"];
                    };
                };
            };
        };
        readonly $schema: "http://json-schema.org/draft-04/schema#";
    };
    readonly response: {
        readonly "400": {
            readonly $schema: "http://json-schema.org/draft-04/schema#";
        };
    };
};
declare const CreateInStoreQrCode: {
    readonly body: {
        readonly type: "object";
        readonly required: readonly ["amount", "platform"];
        readonly properties: {
            readonly amount: {
                readonly type: "object";
                readonly description: "Total amount to be charged to consumer.";
                readonly properties: {
                    readonly amount: {
                        readonly type: "number";
                        readonly default: 300;
                        readonly examples: readonly [300];
                    };
                    readonly currency: {
                        readonly type: "string";
                        readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                        readonly default: "SAR";
                        readonly examples: readonly ["SAR"];
                    };
                };
            };
            readonly order_reference_id: {
                readonly type: "string";
                readonly description: "The unique order id from merchant side, this will be used   with the settlement and reports";
                readonly default: "1231234123-234a-fe21-1234-a324af2";
                readonly examples: readonly ["1231234123-234a-fe21-1234-a324af2"];
            };
            readonly order_number: {
                readonly type: "string";
                readonly description: "Unique order ID from the merchant's side, which will be used for settlement and reporting purposes. Can be modified after the   checkout session is created.";
                readonly default: "A1231234123";
                readonly examples: readonly ["A1231234123"];
            };
            readonly platform: {
                readonly type: "string";
                readonly description: "";
                readonly default: "PARTNERNAME_POS_QR";
                readonly examples: readonly ["PARTNERNAME_POS_QR"];
            };
            readonly locale: {
                readonly type: "string";
                readonly description: "Display language for Tamara checkout page. Language to be   defined by the merchant following RFC 1766, e.g `en_US` or `ar_SA`.   Default is set to Arabic if value not passed and customer is new. If   customer already exists and locale is not passed then customer's   preference will be taken into account.";
                readonly enum: readonly ["ar_SA", "en_US"];
                readonly default: "ar_SA";
                readonly examples: readonly ["ar_SA"];
            };
            readonly additional_data: {
                readonly type: "object";
                readonly description: "Additional order data information from the merchant side";
                readonly properties: {
                    readonly store_code: {
                        readonly type: "string";
                        readonly description: "The unique store code/name from which request is called";
                        readonly default: "Branch A";
                        readonly examples: readonly ["Branch A"];
                    };
                };
            };
        };
        readonly $schema: "http://json-schema.org/draft-04/schema#";
    };
    readonly metadata: {
        readonly allOf: readonly [{
            readonly type: "object";
            readonly properties: {
                readonly "X-Device-Id": {
                    readonly type: "string";
                    readonly format: "number";
                    readonly examples: readonly [123456];
                    readonly $schema: "http://json-schema.org/draft-04/schema#";
                    readonly description: "This is an identifier of your POS devices, e.g. 123456";
                };
            };
            readonly required: readonly ["X-Device-Id"];
        }];
    };
    readonly response: {
        readonly "400": {
            readonly $schema: "http://json-schema.org/draft-04/schema#";
        };
    };
};
declare const CreditPreCheck: {
    readonly properties: {
        readonly has_available_payment_options: {
            readonly type: "boolean";
        };
        readonly single_checkout_enabled: {
            readonly type: "boolean";
        };
        readonly available_payment_labels: {
            readonly type: "array";
            readonly items: {
                readonly type: "object";
                readonly properties: {
                    readonly payment_type: {
                        readonly type: "string";
                        readonly enum: readonly ["PAY_BY_INSTALMENTS", "PAY_NOW"];
                    };
                    readonly instalment: {
                        readonly type: "integer";
                    };
                    readonly description_en: {
                        readonly type: "string";
                    };
                    readonly description_ar: {
                        readonly type: "string";
                    };
                };
            };
        };
    };
    readonly "x-readme-ref-name": "credit-pre-check";
    readonly type: "object";
};
declare const CustomerSIdVerificationStatus: {
    readonly metadata: {
        readonly allOf: readonly [{
            readonly type: "object";
            readonly properties: {
                readonly phone_number: {
                    readonly type: "string";
                    readonly default: "966544337766";
                    readonly examples: readonly ["966506459343"];
                    readonly $schema: "http://json-schema.org/draft-04/schema#";
                };
                readonly country_code: {
                    readonly type: "string";
                    readonly description: "The unique ISO country code for the country that the phone number owner is located in";
                    readonly enum: readonly ["SA", "AE"];
                    readonly default: "SA";
                    readonly $schema: "http://json-schema.org/draft-04/schema#";
                };
            };
            readonly required: readonly ["phone_number", "country_code"];
        }];
    };
};
declare const DeleteWebhookUrlUsingWebhookId: {
    readonly metadata: {
        readonly allOf: readonly [{
            readonly type: "object";
            readonly properties: {
                readonly webhookId: {
                    readonly type: "string";
                    readonly format: "uuid";
                    readonly default: "8fe4cce9-d0aa-4020-a863-c708547795e9";
                    readonly examples: readonly ["8fe4cce9-d0aa-4020-a863-c708547795e9"];
                    readonly $schema: "http://json-schema.org/draft-04/schema#";
                    readonly description: "The unique webhookId from Tamara";
                };
            };
            readonly required: readonly ["webhookId"];
        }];
    };
};
declare const DisputeType: {
    readonly required: readonly ["type", "url", "events"];
    readonly properties: {
        readonly type: {
            readonly type: "string";
            readonly default: "dispute";
            readonly examples: readonly ["dispute"];
        };
        readonly events: {
            readonly type: "array";
            readonly description: "Select the events you would like to be sent webhook notifications for";
            readonly items: {
                readonly type: "string";
                readonly enum: readonly ["OrderDisputeAwaitingMerchantResponse", "OrderDisputeClosedMerchantAcceptedClaim", "OrderDisputeClosedTamaraAcceptedClaim", "OrderDisputeClosedTamaraAcceptedAndMerchantRefundedClaim", "OrderDisputeClosedClaimCancelled", "OrderDisputeWasUpdated"];
            };
            readonly default: readonly ["OrderDisputeAwaitingMerchantResponse", "OrderDisputeClosedMerchantAcceptedClaim", "OrderDisputeClosedTamaraAcceptedClaim", "OrderDisputeClosedTamaraAcceptedAndMerchantRefundedClaim", "OrderDisputeClosedClaimCancelled", "OrderDisputeWasUpdated"];
            readonly examples: readonly ["OrderDisputeAwaitingMerchantResponse", "OrderDisputeClosedMerchantAcceptedClaim", "OrderDisputeClosedTamaraAcceptedClaim", "OrderDisputeClosedTamaraAcceptedAndMerchantRefundedClaim", "OrderDisputeClosedClaimCancelled", "OrderDisputeWasUpdated"];
        };
        readonly url: {
            readonly type: "string";
            readonly description: "Your webhook endpoint to receive notifications from Tamara when dispute case information is updated (dispute case status changes), please use https       only.";
            readonly format: "uri";
            readonly default: "https://www.enteryoursitehere.com/webhooks";
            readonly examples: readonly ["https://www.enteryoursitehere.com/webhooks"];
        };
        readonly headers: {
            readonly type: "object";
            readonly description: "Add any optional headers you need, the authorization header is only an example.";
            readonly properties: {
                readonly authorization: {
                    readonly type: "string";
                    readonly default: "123344-1231-abcd-adfe-123456";
                    readonly examples: readonly ["12344-1231-abcd"];
                };
            };
        };
    };
    readonly "x-readme-ref-name": "disputeType";
    readonly type: "object";
};
declare const GetOrderDetails: {
    readonly metadata: {
        readonly allOf: readonly [{
            readonly type: "object";
            readonly properties: {
                readonly order_id: {
                    readonly type: "string";
                    readonly format: "uuid";
                    readonly default: "ff776045-513b-4cd7-8b4f-e60673daad84";
                    readonly examples: readonly ["ff776045-513b-4cd7-8b4f-e60673daad84"];
                    readonly $schema: "http://json-schema.org/draft-04/schema#";
                    readonly description: "Unique Tamara `order_id` from the response of the creation of the checkout session whether online or in-store.";
                };
            };
            readonly required: readonly ["order_id"];
        }];
    };
    readonly response: {
        readonly "200": {
            readonly $schema: "http://json-schema.org/draft-04/schema#";
        };
    };
};
declare const GetOrderDetailsByRefId: {
    readonly metadata: {
        readonly allOf: readonly [{
            readonly type: "object";
            readonly properties: {
                readonly order_reference_id: {
                    readonly type: "string";
                    readonly default: "A12345";
                    readonly examples: readonly ["A12345"];
                    readonly $schema: "http://json-schema.org/draft-04/schema#";
                    readonly description: "Unique merchant order_reference_id";
                };
            };
            readonly required: readonly ["order_reference_id"];
        }];
    };
    readonly response: {
        readonly "200": {
            readonly $schema: "http://json-schema.org/draft-04/schema#";
        };
    };
};
declare const IdVerificationStatus: {
    readonly properties: {
        readonly is_id_verified: {
            readonly type: "boolean";
        };
    };
    readonly "x-readme-ref-name": "id-verification-status";
    readonly type: "object";
};
declare const OrderType: {
    readonly required: readonly ["type", "url", "events"];
    readonly properties: {
        readonly type: {
            readonly type: "string";
            readonly default: "order";
            readonly examples: readonly ["order"];
        };
        readonly events: {
            readonly type: "array";
            readonly description: "Select the events you would like to be sent webhook notifications for";
            readonly items: {
                readonly type: "string";
                readonly enum: readonly ["order_approved", "order_authorised", "order_canceled", "order_updated", "order_captured", "order_refunded"];
            };
            readonly default: readonly ["order_approved", "order_authorised", "order_canceled", "order_updated", "order_captured", "order_refunded"];
            readonly examples: readonly ["order_approved", "order_authorised", "order_canceled", "order_updated", "order_captured", "order_refunded"];
        };
        readonly url: {
            readonly type: "string";
            readonly description: "Your webhook endpoint to receive notifications from   Tamara when order information is updated (order status changes),   please use https       only.";
            readonly format: "uri";
            readonly default: "https://www.enteryoursitehere.com/webhooks";
            readonly examples: readonly ["https://www.enteryoursitehere.com/webhooks"];
        };
        readonly headers: {
            readonly type: "object";
            readonly description: "Add any optional headers you need, the authorization header is only an example.";
            readonly properties: {
                readonly authorization: {
                    readonly type: "string";
                    readonly default: "123344-1231-abcd-adfe-123456";
                    readonly examples: readonly ["12344-1231-abcd"];
                };
            };
        };
    };
    readonly "x-readme-ref-name": "orderType";
    readonly type: "object";
};
declare const PaymentTypes: {
    readonly metadata: {
        readonly allOf: readonly [{
            readonly type: "object";
            readonly properties: {
                readonly country: {
                    readonly type: "string";
                    readonly enum: readonly ["SA", "AE", "KW", "BH", "OM"];
                    readonly default: "SA";
                    readonly examples: readonly ["SA"];
                    readonly $schema: "http://json-schema.org/draft-04/schema#";
                    readonly description: "The unique ISO country code for the country that the merchant is located in";
                };
                readonly phone: {
                    readonly type: "string";
                    readonly default: 966506459343;
                    readonly examples: readonly [966506459343];
                    readonly $schema: "http://json-schema.org/draft-04/schema#";
                    readonly description: "The customer's phone number.";
                };
                readonly currency: {
                    readonly type: "string";
                    readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                    readonly default: "SAR";
                    readonly examples: readonly ["SAR"];
                    readonly $schema: "http://json-schema.org/draft-04/schema#";
                    readonly description: "The three-letter unique ISO currency code, If this is not provided, the default currency code of the given country will be considered.<br /> If the combination of the country and currency code is not supported, an empty list will be returned. <br /> Please note that in certain cases, zero credit limits will be returned instead of an empty list.";
                };
                readonly order_value: {
                    readonly type: "number";
                    readonly minimum: 0.1;
                    readonly default: 1;
                    readonly examples: readonly [100];
                    readonly $schema: "http://json-schema.org/draft-04/schema#";
                    readonly description: "The order total at the merchant end. This value is used to return only the eligible payment types for the order. The merchant does not have to implement a logic on the payment options to display. <br />The exact format depends on the currency. By default we support 2 decimals, but for BHD, KWD and OMR we support 3 decimals.";
                };
            };
            readonly required: readonly ["country"];
        }];
    };
    readonly response: {
        readonly "200": {
            readonly $schema: "http://json-schema.org/draft-04/schema#";
        };
    };
};
declare const Refund: {
    readonly properties: {
        readonly order_id: {
            readonly type: "string";
            readonly format: "uuid";
        };
        readonly refunds: {
            readonly type: "array";
            readonly items: {
                readonly type: "object";
                readonly properties: {
                    readonly refund_id: {
                        readonly type: "string";
                    };
                    readonly capture_id: {
                        readonly type: "string";
                    };
                };
            };
        };
        readonly status: {
            readonly type: "string";
            readonly enum: readonly ["fully_refunded", "partially_refunded"];
        };
        readonly refunded_amount: {
            readonly items: {
                readonly properties: {
                    readonly amount: {
                        readonly type: "number";
                    };
                    readonly currency: {
                        readonly type: "string";
                        readonly enum: readonly ["SAR", "AED", "KWD", "BHD", "OMR"];
                    };
                };
                readonly type: "object";
            };
            readonly type: "array";
        };
    };
    readonly "x-readme-ref-name": "refund";
    readonly type: "object";
    readonly body: {
        readonly type: "object";
        readonly required: readonly ["order_id", "refunds"];
        readonly properties: {
            readonly order_id: {
                readonly type: "string";
                readonly description: "Unique Tamara `order_id` from the response of the creation of the checkout session whether online or in-store.";
                readonly format: "uuid";
                readonly examples: readonly ["8fe4cce9-d0aa-4020-a863-c708547795e9"];
            };
            readonly refunds: {
                readonly type: "array";
                readonly description: "Array of objects of refund data, broken down by capture_id";
                readonly items: {
                    readonly type: "object";
                    readonly required: readonly ["capture_id", "total_amount"];
                    readonly properties: {
                        readonly capture_id: {
                            readonly type: "string";
                            readonly description: "Tamara capture_id as a result of a previous capture request for this order.";
                            readonly examples: readonly ["b38599ce-350e-418c-8c88-1e015f6e2dfd"];
                        };
                        readonly total_amount: {
                            readonly type: "object";
                            readonly description: "Total amount to be charged to consumer, not including any discount amount.";
                            readonly properties: {
                                readonly amount: {
                                    readonly type: "number";
                                    readonly examples: readonly [300];
                                };
                                readonly currency: {
                                    readonly type: "string";
                                    readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                    readonly examples: readonly ["SAR"];
                                };
                            };
                        };
                        readonly refund_id: {
                            readonly type: "string";
                            readonly description: "Tamara refund_id as a result of a previous refund request for this order.";
                            readonly examples: readonly ["b38599ce-350e-418c-8c88-1e015f6e2dfd"];
                        };
                        readonly tax_amount: {
                            readonly type: "object";
                            readonly properties: {
                                readonly amount: {
                                    readonly type: "string";
                                    readonly minimum: 0;
                                    readonly examples: readonly ["50.00"];
                                };
                                readonly currency: {
                                    readonly type: "string";
                                    readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                    readonly examples: readonly ["SAR"];
                                };
                            };
                        };
                        readonly shipping_amount: {
                            readonly type: "object";
                            readonly description: "Shipping amount to be refunded, you have to send the full shipping amount, if any, that has been captured for the 1st refund request.";
                            readonly properties: {
                                readonly amount: {
                                    readonly type: "string";
                                    readonly minimum: 0;
                                    readonly examples: readonly ["50.00"];
                                };
                                readonly currency: {
                                    readonly type: "string";
                                    readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                    readonly examples: readonly ["SAR"];
                                };
                            };
                        };
                        readonly discount_amount: {
                            readonly type: "object";
                            readonly properties: {
                                readonly amount: {
                                    readonly type: "string";
                                    readonly examples: readonly ["50.00"];
                                };
                                readonly currency: {
                                    readonly type: "string";
                                    readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                    readonly examples: readonly ["SAR"];
                                };
                            };
                        };
                        readonly items: {
                            readonly type: "array";
                            readonly items: {
                                readonly type: "object";
                                readonly required: readonly ["reference_id", "type", "name", "sku", "quantity", "total_amount"];
                                readonly description: "An array of objects to detail the items in this order as seperate objects for each item.";
                                readonly properties: {
                                    readonly name: {
                                        readonly type: "string";
                                        readonly description: "Product name. `<=255 characters`.";
                                        readonly maximum: 255;
                                        readonly examples: readonly ["Lego City 8601"];
                                    };
                                    readonly quantity: {
                                        readonly type: "number";
                                        readonly description: "How many of this specific item is being purchased";
                                        readonly examples: readonly [1];
                                    };
                                    readonly reference_id: {
                                        readonly type: "string";
                                        readonly description: "The unique id of the item from merchant's side";
                                        readonly examples: readonly ["123"];
                                    };
                                    readonly sku: {
                                        readonly type: "string";
                                        readonly description: "Product SKU. **`<= 128 characters`**";
                                        readonly maximum: 128;
                                        readonly examples: readonly ["SA-12436"];
                                    };
                                    readonly item_url: {
                                        readonly type: "string";
                                        readonly description: "URL of the item from merchant's website. **`<= 1024 characters`**";
                                        readonly format: "uri";
                                        readonly maximum: 1024;
                                        readonly examples: readonly ["SA-12436"];
                                    };
                                    readonly image_url: {
                                        readonly type: "string";
                                        readonly description: "URL to an image of the product that can be later displayed to the customer. **`<= 1024 characters`** <br /> **Size** = 2-3 MB maximum <br /> **Resolution** WxH = 1024xY (the Y height of image should be small).";
                                        readonly format: "uri";
                                        readonly maximum: 1024;
                                        readonly examples: readonly ["SA-12436"];
                                    };
                                    readonly unit_price: {
                                        readonly type: "object";
                                        readonly properties: {
                                            readonly amount: {
                                                readonly type: "number";
                                                readonly examples: readonly [490];
                                            };
                                            readonly currency: {
                                                readonly type: "string";
                                                readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                                readonly examples: readonly ["SAR"];
                                            };
                                        };
                                    };
                                    readonly tax_amount: {
                                        readonly type: "object";
                                        readonly properties: {
                                            readonly amount: {
                                                readonly type: "number";
                                                readonly minimum: 0;
                                                readonly examples: readonly [10];
                                            };
                                            readonly currency: {
                                                readonly type: "string";
                                                readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                                readonly examples: readonly ["SAR"];
                                            };
                                        };
                                    };
                                    readonly discount_amount: {
                                        readonly type: "object";
                                        readonly properties: {
                                            readonly amount: {
                                                readonly type: "number";
                                                readonly examples: readonly [100];
                                            };
                                            readonly currency: {
                                                readonly type: "string";
                                                readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                                readonly examples: readonly ["SAR"];
                                            };
                                        };
                                    };
                                    readonly total_amount: {
                                        readonly type: "object";
                                        readonly properties: {
                                            readonly amount: {
                                                readonly type: "string";
                                                readonly examples: readonly ["100"];
                                            };
                                            readonly currency: {
                                                readonly type: "string";
                                                readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                                                readonly examples: readonly ["SAR"];
                                            };
                                        };
                                    };
                                    readonly type: {
                                        readonly type: "string";
                                        readonly examples: readonly ["Digital"];
                                    };
                                };
                            };
                        };
                    };
                };
            };
        };
        readonly $schema: "http://json-schema.org/draft-04/schema#";
    };
};
declare const RegisterWebhookUrl: {
    readonly body: {
        readonly type: "object";
        readonly oneOf: readonly [{
            readonly required: readonly ["type", "url", "events"];
            readonly properties: {
                readonly type: {
                    readonly type: "string";
                    readonly default: "order";
                    readonly examples: readonly ["order"];
                };
                readonly events: {
                    readonly type: "array";
                    readonly description: "Select the events you would like to be sent webhook notifications for";
                    readonly items: {
                        readonly type: "string";
                        readonly enum: readonly ["order_approved", "order_authorised", "order_canceled", "order_updated", "order_captured", "order_refunded"];
                    };
                    readonly default: readonly ["order_approved", "order_authorised", "order_canceled", "order_updated", "order_captured", "order_refunded"];
                    readonly examples: readonly ["order_approved", "order_authorised", "order_canceled", "order_updated", "order_captured", "order_refunded"];
                };
                readonly url: {
                    readonly type: "string";
                    readonly description: "Your webhook endpoint to receive notifications from   Tamara when order information is updated (order status changes),   please use https       only.";
                    readonly format: "uri";
                    readonly default: "https://www.enteryoursitehere.com/webhooks";
                    readonly examples: readonly ["https://www.enteryoursitehere.com/webhooks"];
                };
                readonly headers: {
                    readonly type: "object";
                    readonly description: "Add any optional headers you need, the authorization header is only an example.";
                    readonly properties: {
                        readonly authorization: {
                            readonly type: "string";
                            readonly default: "123344-1231-abcd-adfe-123456";
                            readonly examples: readonly ["12344-1231-abcd"];
                        };
                    };
                };
            };
            readonly "x-readme-ref-name": "orderType";
            readonly type: "object";
        }, {
            readonly required: readonly ["type", "url", "events"];
            readonly properties: {
                readonly type: {
                    readonly type: "string";
                    readonly default: "dispute";
                    readonly examples: readonly ["dispute"];
                };
                readonly events: {
                    readonly type: "array";
                    readonly description: "Select the events you would like to be sent webhook notifications for";
                    readonly items: {
                        readonly type: "string";
                        readonly enum: readonly ["OrderDisputeAwaitingMerchantResponse", "OrderDisputeClosedMerchantAcceptedClaim", "OrderDisputeClosedTamaraAcceptedClaim", "OrderDisputeClosedTamaraAcceptedAndMerchantRefundedClaim", "OrderDisputeClosedClaimCancelled", "OrderDisputeWasUpdated"];
                    };
                    readonly default: readonly ["OrderDisputeAwaitingMerchantResponse", "OrderDisputeClosedMerchantAcceptedClaim", "OrderDisputeClosedTamaraAcceptedClaim", "OrderDisputeClosedTamaraAcceptedAndMerchantRefundedClaim", "OrderDisputeClosedClaimCancelled", "OrderDisputeWasUpdated"];
                    readonly examples: readonly ["OrderDisputeAwaitingMerchantResponse", "OrderDisputeClosedMerchantAcceptedClaim", "OrderDisputeClosedTamaraAcceptedClaim", "OrderDisputeClosedTamaraAcceptedAndMerchantRefundedClaim", "OrderDisputeClosedClaimCancelled", "OrderDisputeWasUpdated"];
                };
                readonly url: {
                    readonly type: "string";
                    readonly description: "Your webhook endpoint to receive notifications from Tamara when dispute case information is updated (dispute case status changes), please use https       only.";
                    readonly format: "uri";
                    readonly default: "https://www.enteryoursitehere.com/webhooks";
                    readonly examples: readonly ["https://www.enteryoursitehere.com/webhooks"];
                };
                readonly headers: {
                    readonly type: "object";
                    readonly description: "Add any optional headers you need, the authorization header is only an example.";
                    readonly properties: {
                        readonly authorization: {
                            readonly type: "string";
                            readonly default: "123344-1231-abcd-adfe-123456";
                            readonly examples: readonly ["12344-1231-abcd"];
                        };
                    };
                };
            };
            readonly "x-readme-ref-name": "disputeType";
            readonly type: "object";
        }];
        readonly $schema: "http://json-schema.org/draft-04/schema#";
    };
    readonly response: {
        readonly "200": {
            readonly $schema: "http://json-schema.org/draft-04/schema#";
        };
    };
};
declare const RetrieveWebhookUrlUsingWebhookId: {
    readonly metadata: {
        readonly allOf: readonly [{
            readonly type: "object";
            readonly properties: {
                readonly webhookId: {
                    readonly type: "string";
                    readonly format: "uuid";
                    readonly default: "8fe4cce9-d0aa-4020-a863-c708547795e9";
                    readonly examples: readonly ["8fe4cce9-d0aa-4020-a863-c708547795e9"];
                    readonly $schema: "http://json-schema.org/draft-04/schema#";
                    readonly description: "The unique webhookId from Tamara";
                };
            };
            readonly required: readonly ["webhookId"];
        }];
    };
    readonly response: {
        readonly "200": {
            readonly $schema: "http://json-schema.org/draft-04/schema#";
        };
    };
};
declare const SimplifiedRefund: {
    readonly body: {
        readonly type: "object";
        readonly required: readonly ["total_amount", "comment"];
        readonly properties: {
            readonly total_amount: {
                readonly type: "object";
                readonly description: "Total amount to be refunded to consumer, not including any discount amount.";
                readonly properties: {
                    readonly amount: {
                        readonly type: "number";
                        readonly default: 300;
                        readonly examples: readonly [300];
                    };
                    readonly currency: {
                        readonly type: "string";
                        readonly enum: readonly ["SAR", "AED", "BHD", "KWD", "OMR"];
                        readonly default: "SAR";
                        readonly examples: readonly ["SAR"];
                    };
                };
            };
            readonly comment: {
                readonly type: "string";
                readonly description: "Notes or comments as a reference point that will be added to this order's transaction history.";
                readonly default: "Refund for the order A123";
                readonly examples: readonly ["Refund for the order A123"];
            };
            readonly merchant_refund_id: {
                readonly type: "string";
                readonly description: "Used to input the merchant's own internal refund ID, if any, to be stored on the refund request and order details.";
                readonly examples: readonly ["RefundID1"];
            };
        };
        readonly $schema: "http://json-schema.org/draft-04/schema#";
    };
    readonly metadata: {
        readonly allOf: readonly [{
            readonly type: "object";
            readonly properties: {
                readonly order_id: {
                    readonly type: "string";
                    readonly format: "uuid";
                    readonly default: "ff776045-513b-4cd7-8b4f-e60673daad84";
                    readonly examples: readonly ["ff776045-513b-4cd7-8b4f-e60673daad84"];
                    readonly $schema: "http://json-schema.org/draft-04/schema#";
                    readonly description: "Unique Tamara `order_id` from the response of the creation of the checkout session whether online or in-store.";
                };
            };
            readonly required: readonly ["order_id"];
        }];
    };
};
declare const SimplifiedRefunds: {
    readonly properties: {
        readonly order_id: {
            readonly type: "string";
            readonly format: "uuid";
        };
        readonly comment: {
            readonly type: "string";
        };
        readonly refund_id: {
            readonly type: "string";
            readonly format: "uuid";
        };
        readonly capture_id: {
            readonly type: "string";
            readonly format: "uuid";
        };
        readonly status: {
            readonly type: "string";
            readonly enum: readonly ["fully_refunded", "partially_refunded"];
        };
        readonly refunded_amount: {
            readonly items: {
                readonly properties: {
                    readonly amount: {
                        readonly type: "number";
                    };
                    readonly currency: {
                        readonly type: "string";
                        readonly enum: readonly ["SAR", "AED", "KWD", "BHD", "OMR"];
                    };
                };
                readonly type: "object";
            };
            readonly type: "array";
        };
    };
    readonly "x-readme-ref-name": "simplified-refunds";
    readonly type: "object";
};
declare const UpdateOrderReferenceId: {
    readonly body: {
        readonly type: "object";
        readonly required: readonly ["order_reference_id"];
        readonly description: "New order_reference_id to be updated.";
        readonly properties: {
            readonly order_reference_id: {
                readonly type: "string";
                readonly default: "A1234";
                readonly examples: readonly ["A1234"];
            };
        };
        readonly $schema: "http://json-schema.org/draft-04/schema#";
    };
    readonly metadata: {
        readonly allOf: readonly [{
            readonly type: "object";
            readonly properties: {
                readonly order_id: {
                    readonly type: "string";
                    readonly format: "uuid";
                    readonly default: "ff776045-513b-4cd7-8b4f-e60673daad84";
                    readonly examples: readonly ["ff776045-513b-4cd7-8b4f-e60673daad84"];
                    readonly $schema: "http://json-schema.org/draft-04/schema#";
                    readonly description: "Unique Tamara `order_id` from the response of the creation of the checkout session whether online or in-store.";
                };
            };
            readonly required: readonly ["order_id"];
        }];
    };
};
declare const UpdateReferenceId: {
    readonly properties: {
        readonly message: {
            readonly type: "string";
        };
    };
    readonly "x-readme-ref-name": "update-reference-id";
    readonly type: "object";
};
declare const UpdateWebhookUrlUsingWebhookId: {
    readonly body: {
        readonly type: "object";
        readonly required: readonly ["url", "events"];
        readonly properties: {
            readonly url: {
                readonly type: "string";
                readonly format: "uri";
                readonly examples: readonly ["https://www.enteryoursitehere.com/webhooks"];
            };
            readonly events: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                    readonly examples: readonly ["order_approved"];
                };
                readonly examples: readonly ["order_approved", "order_declined", "order_authorised", "order_canceled", "order_captured", "order_refunded", "order_expired"];
            };
            readonly headers: {
                readonly type: "object";
                readonly properties: {
                    readonly authorization: {
                        readonly type: "string";
                        readonly examples: readonly ["1123123-asdas23-a123"];
                    };
                };
            };
        };
        readonly $schema: "http://json-schema.org/draft-04/schema#";
    };
    readonly metadata: {
        readonly allOf: readonly [{
            readonly type: "object";
            readonly properties: {
                readonly webhookId: {
                    readonly type: "string";
                    readonly format: "uuid";
                    readonly default: "8fe4cce9-d0aa-4020-a863-c708547795e9";
                    readonly examples: readonly ["8fe4cce9-d0aa-4020-a863-c708547795e9"];
                    readonly $schema: "http://json-schema.org/draft-04/schema#";
                    readonly description: "The unique webhookId from Tamara";
                };
            };
            readonly required: readonly ["webhookId"];
        }];
    };
    readonly response: {
        readonly "200": {
            readonly $schema: "http://json-schema.org/draft-04/schema#";
        };
    };
};
declare const VoidCheckoutSession: {
    readonly metadata: {
        readonly allOf: readonly [{
            readonly type: "object";
            readonly properties: {
                readonly checkout_id: {
                    readonly type: "string";
                    readonly default: "ff776045-513b-4cd7-8b4f-e60673daad84";
                    readonly examples: readonly ["ff776045-513b-4cd7-8b4f-e60673daad84"];
                    readonly $schema: "http://json-schema.org/draft-04/schema#";
                    readonly description: "Unique Tamara `checkout_id`, obtained from the response of create checkout/in-store checkout session endpoint.";
                };
            };
            readonly required: readonly ["checkout_id"];
        }, {
            readonly type: "object";
            readonly properties: {
                readonly order_id: {
                    readonly type: "string";
                    readonly format: "uuid";
                    readonly default: "2aa3d561-40a7-4150-a669-5e5852b04d5e";
                    readonly examples: readonly ["2aa3d561-40a7-4150-a669-5e5852b04d5e"];
                    readonly $schema: "http://json-schema.org/draft-04/schema#";
                    readonly description: "Unique Tamara `order_id`, obtained from the response of create checkout/in-store checkout session endpoint.";
                };
                readonly store_code: {
                    readonly type: "string";
                    readonly default: "Branch A";
                    readonly examples: readonly ["Branch A"];
                    readonly $schema: "http://json-schema.org/draft-04/schema#";
                    readonly description: "The unique store code/name from which request is called";
                };
            };
            readonly required: readonly ["order_id"];
        }];
    };
};
export { $Void, Authorise, AuthoriseOrder, Cancel, CancelOrder, Capture, CaptureOrder, CheckPaymentOptionsAvailability, Checkout, CheckoutInstore, CreateCheckoutSession, CreateInStoreCheckoutSession, CreateInStoreQrCode, CreditPreCheck, CustomerSIdVerificationStatus, DeleteWebhookUrlUsingWebhookId, DisputeType, GetOrderDetails, GetOrderDetailsByRefId, IdVerificationStatus, OrderType, PaymentTypes, Refund, RegisterWebhookUrl, RetrieveWebhookUrlUsingWebhookId, SimplifiedRefund, SimplifiedRefunds, UpdateOrderReferenceId, UpdateReferenceId, UpdateWebhookUrlUsingWebhookId, VoidCheckoutSession };
