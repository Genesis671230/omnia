const TAMARA_API_URL = process.env.TAMARA_API_URL || "https://api-sandbox.tamara.co";
const TAMARA_TOKEN = process.env.TAMARA_TOKEN||"eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhY2NvdW50SWQiOiI1ZDZkNDg2MS03ZTY2LTQwMWYtYWM2Yy02NWQ5NmUwMGE1MzgiLCJ0eXBlIjoibWVyY2hhbnQiLCJzYWx0IjoiNmIxYzkzN2U1ZWZkNzQ5YmRiOGEyZmVmZDI5YjIzYjYiLCJyb2xlcyI6WyJST0xFX01FUkNIQU5UIl0sImlhdCI6MTc1NTgxMDIzMCwiaXNzIjoiVGFtYXJhIn0.U9JbHEh6IN1duoEwTV_d2ar339fFOpwM39mnxfez8iJNrygx4pkthnTXK5LI07hVyO8Idc4RrCZgAuKIjNwt76b4NiPpkA_yedfVAQpkNL7iaeUWeI9RMz23NniAjU9kBDz0ZAUKH9skWFIMs4MiAwwu07gfouTcygjrw3mhdbkZLTUJlib7J7lFLqh2ru-00kiRKFKMu0V4_DtcXGm7SPqEC2QIqHjCi6qaE5jODF6QUF2Kql1aR5tsGLYPCjXTcrEClCseB4niwWvfqIcxhS5PibtBd8LGHf6kil1Xi1t3SsOgF7xMqgIBcI6WOcNSdLXe9P__z-2w5DSavwqN6Q";
const docsTam = require("@api/docs-tam");
docsTam.auth(TAMARA_TOKEN);

async function getOrders() {


// docsTam.createCheckoutSession({
//   total_amount: {amount: 300, currency: 'SAR'},
//   shipping_amount: {amount: 1, currency: 'SAR'},
//   tax_amount: {amount: 1, currency: 'SAR'},
//   order_reference_id: 'abd12331-a123-1234-4567-fbde34ae',
//   order_number: 'A123125',
//   discount: {amount: {amount: 0, currency: 'SAR'}},
//   items: [
//     {
//       name: 'Lego City 8601',
//       type: 'Digital',
//       reference_id: '123',
//       sku: 'SA-12436',
//       quantity: 1,
//       discount_amount: {amount: 100, currency: 'SAR'},
//       tax_amount: {amount: 10, currency: 'SAR'},
//       unit_price: {amount: 490, currency: 'SAR'},
//       total_amount: {amount: 100, currency: 'SAR'},
//       item_url: 'https://item-url.com/1234',
//       image_url: 'https://image-url.com/1234'
//     }
//   ],
//   consumer: {
//     email: 'customer@email.com',
//     first_name: 'Mona',
//     last_name: 'Lisa',
//     phone_number: '566027755'
//   },
//   country_code: 'SA',
//   description: 'Enter order description here.',
//   merchant_url: {
//     cancel: 'http://example.com/#/cancel',
//     failure: 'http://example.com/#/fail',
//     success: 'http://example.com/#/success'
//   },
//   billing_address: {
//     city: 'Riyadh',
//     country_code: 'SA',
//     first_name: 'Mona',
//     last_name: 'Lisa',
//     line1: '3764 Al Urubah Rd',
//     line2: 'string',
//     phone_number: '532298658',
//     region: 'As Sulimaniyah'
//   },
//   shipping_address: {
//     city: 'Riyadh',
//     country_code: 'SA',
//     first_name: 'Mona',
//     last_name: 'Lisa',
//     line1: '3764 Al Urubah Rd',
//     line2: 'string',
//     phone_number: '532298658',
//     region: 'As Sulimaniyah'
//   },
//   platform: 'platform name here',
//   is_mobile: false,
//   locale: 'ar_SA',
//   risk_assessment: {
//     customer_age: 21,
//     customer_dob: '01-12-2000',
//     customer_gender: 'Female',
//     customer_nationality: 'SA',
//     is_premium_customer: false,
//     is_existing_customer: false,
//     is_guest_user: false,
//     account_creation_date: '12-06-2020',
//     platform_account_creation_date: '12-06-2020',
//     date_of_first_transaction: '12-06-2020',
//     is_card_on_file: false,
//     is_COD_customer: false,
//     has_delivered_order: true,
//     is_phone_verified: false,
//     is_fraudulent_customer: false,
//     total_ltv: 200,
//     total_order_count: 15,
//     order_amount_last3months: 2000,
//     order_count_last3months: 10,
//     last_order_date: '12-06-2020',
//     last_order_amount: 2000,
//     reward_program_enrolled: false,
//     reward_program_points: 2000
//   },
//   additional_data: {
//     delivery_method: 'Home Delivery',
//     pickup_store: 'Store A',
//     store_code: 'Branch A',
//     vendor_amount: 0,
//     merchant_settlement_amount: 0,
//     vendor_reference_code: 'AZ1234'
//   }
// })
//   .then(({ data }) => console.log(data))
//   .catch(err => console.error(err));

      

      const results = await Promise.allSettled(
        ["0cecd39f-67eb-4551-ac0c-61d9efffe614"].map((id) =>
          docsTam.getOrderDetails({ order_id: id })
        )
      );
    
      return results.map((result) =>{
        console.log(result.value.data,"got it ")
        result.status === "fulfilled"
          ? result.value.data
          : {
              error: result.reason.message,
            }
        
        }
      );
  
}

getOrders()

