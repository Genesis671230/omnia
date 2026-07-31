// scripts/register-woo-webhooks.ts
const TOPICS = [
    "product.updated", "product.deleted", "product.restored",
    "order.created",   "order.updated",
  ];

async function main (){

    
    const auth = "Basic " + Buffer.from(
        `${process.env.WOO_CONSUMER_KEY}:${process.env.WOO_CONSUMER_SECRET}`
    ).toString("base64");
    
    for (const topic of TOPICS) {
        const res = await fetch(`${process.env.WOO_URL}/wp-json/wc/v3/webhooks`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: auth },
            body: JSON.stringify({
                name: `finance-os ${topic}`,
                topic,
                delivery_url: `${process.env.APP_BASE_URL}/api/webhooks/woo/${topic.replace(".", "-")}`,
                secret: process.env.WOO_CONSUMER_SECRET,
            }),
        });
        console.log(topic, res.status, (await res.json()).id ?? await res.text());
    }
    
}

  main()