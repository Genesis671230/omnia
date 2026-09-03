// import { NextRequest } from "next/server";
// import ExcelJS from "exceljs";
// import { findInventoryBySkus } from "@/lib/inventory-export";

// export async function POST(req: NextRequest) {
//   try {
//     const body = await req.json();

//     const skus = Array.isArray(body.skus)
//       ? body.skus
//       : [];

//     if (skus.length === 0) {
//       return Response.json(
//         { error: "No SKUs supplied" },
//         { status: 400 },
//       );
//     }
//     console.log(skus,"this list of sku")
//     const rows = await findInventoryBySkus(skus);
//     console.log(rows,"we got rows as well")
//     const workbook = new ExcelJS.Workbook();
//     const worksheet =
//       workbook.addWorksheet("Inventory");

//     worksheet.columns = [
//       {
//         header: "Image",
//         key: "image",
//         width: 16,
//       },
//       {
//         header: "Platform",
//         key: "platform",
//         width: 18,
//       },
//       {
//         header: "Store",
//         key: "store",
//         width: 12,
//       },
//       {
//         header: "SKU",
//         key: "sku",
//         width: 22,
//       },
//       {
//         header: "Product",
//         key: "product_name",
//         width: 40,
//       },
//       {
//         header: "Stock",
//         key: "stock_quantity",
//         width: 12,
//       },
//       {
//         header: "Location",
//         key: "location",
//         width: 25,
//       },
//       {
//         header: "Read Only",
//         key: "readonly",
//         width: 12,
//       },
//       {
//         header: "Fulfillment Service",
//         key: "fulfillment_service",
//         width: 25,
//       },
//     ];

//     for (const row of rows) {
//       const excelRow = worksheet.addRow({
//         platform: row.platform,
//         store: row.store,
//         sku: row.sku,
//         product_name: row.product_name,
//         stock_quantity: row.stock_quantity,
//         location: row.location,
//         readonly: row.readonly ? "Yes" : "No",
//         fulfillment_service:
//           row.fulfillment_service ?? "",
//       });

//       excelRow.height = 90;

//       if (row.image_url) {
//         try {
//           const imageResponse =
//             await fetch(row.image_url);

//           if (imageResponse.ok) {
//             const buffer = Buffer.from(
//               await imageResponse.arrayBuffer(),
//             );

//             const contentType =
//               imageResponse.headers.get(
//                 "content-type",
//               ) ?? "";

//             const extension =
//               contentType.includes("png")
//                 ? "png"
//                 : "jpeg";

//             const imageId = workbook.addImage({
//               buffer,
//               extension,
//             });

//             worksheet.addImage(imageId, {
//               tl: {
//                 col: 0,
//                 row: excelRow.number - 1,
//               },
//               ext: {
//                 width: 85,
//                 height: 85,
//               },
//             });
//           }
//         } catch {
//           // Don't fail the entire export because one image failed.
//         }
//       }
//     }

//     worksheet.getRow(1).font = {
//       bold: true,
//     };

//     const buffer = await workbook.xlsx.writeBuffer();

//     return new Response(buffer, {
//       status: 200,
//       headers: {
//         "Content-Type":
//           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
//         "Content-Disposition":
//           'attachment; filename="inventory-export.xlsx"',
//       },
//     });
//   } catch (error) {
//     console.error(error);

//     return Response.json(
//       {
//         error:
//           error instanceof Error
//             ? error.message
//             : "Export failed",
//       },
//       { status: 500 },
//     );
//   }
// }


import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { findInventoryBySkus } from "@/lib/inventory-export";

export async function POST(req: NextRequest) {
  console.log("========== INVENTORY EXPORT START ==========");

  try {
    // 1. Read request
    console.log("[1] Reading request body");

    const body = await req.json();

    console.log("[1] Body:", body);

    const skus = Array.isArray(body.skus)
      ? body.skus
      : [];

    console.log("[2] SKUs:", skus);

    if (skus.length === 0) {
      return Response.json(
        { error: "No SKUs supplied" },
        { status: 400 },
      );
    }

    // 2. Find inventory
    console.log(
      "[3] Calling findInventoryBySkus()..."
    );

    const rows = await findInventoryBySkus(skus);

    console.log(
      "[4] findInventoryBySkus() FINISHED"
    );

    console.log(
      "[4] ROW COUNT:",
      rows.length
    );

    console.log(
      "[4] ROWS:",
      JSON.stringify(rows, null, 2)
    );

    // 3. Create workbook
    console.log(
      "[5] Creating Excel workbook..."
    );

    const workbook =
      new ExcelJS.Workbook();

    const worksheet =
      workbook.addWorksheet("Inventory");

    worksheet.columns = [
      {
        header: "Image",
        key: "image",
        width: 16,
      },
      {
        header: "Platform",
        key: "platform",
        width: 18,
      },
      {
        header: "Store",
        key: "store",
        width: 12,
      },
      {
        header: "SKU",
        key: "sku",
        width: 22,
      },
      {
        header: "Product",
        key: "product_name",
        width: 40,
      },
      {
        header: "Stock",
        key: "stock_quantity",
        width: 12,
      },
      {
        header: "Location",
        key: "location",
        width: 25,
      },
      {
        header: "Read Only",
        key: "readonly",
        width: 12,
      },
      {
        header: "Fulfillment Service",
        key: "fulfillment_service",
        width: 25,
      },
    ];

    // 4. Add rows
    console.log(
      "[6] Adding rows to Excel..."
    );

    for (const row of rows) {
      console.log(
        "[6] Adding row:",
        row
      );

      const excelRow =
        worksheet.addRow({
          platform: row.platform,
          store: row.store,
          sku: row.sku,
          product_name: row.product_name,
          stock_quantity:
            row.stock_quantity,
          location:
            row.location ?? "",
          readonly:
            row.readonly
              ? "Yes"
              : "No",
          fulfillment_service:
            row.fulfillment_service ?? "",
        });

      excelRow.height = 90;

      // 5. Add image
      if (row.image_url) {
        console.log(
          "[7] Image found:",
          row.image_url
        );

        try {
          const imageResponse =
            await fetch(row.image_url);

          console.log(
            "[7] Image response:",
            imageResponse.status,
            imageResponse.headers.get(
              "content-type"
            )
          );

          if (imageResponse.ok) {
            const imageBuffer =
              Buffer.from(
                await imageResponse.arrayBuffer()
              );

            const contentType =
              imageResponse.headers.get(
                "content-type"
              ) ?? "";

            const extension =
              contentType.includes("png")
                ? "png"
                : contentType.includes("gif")
                  ? "gif"
                  : "jpeg";

            const imageId =
              workbook.addImage({
                buffer: imageBuffer,
                extension,
              });

            worksheet.addImage(
              imageId,
              {
                tl: {
                  col: 0,
                  row:
                    excelRow.number - 1,
                },
                ext: {
                  width: 85,
                  height: 85,
                },
              }
            );

            console.log(
              "[7] Image added to Excel"
            );
          }
        } catch (imageError) {
          console.error(
            "[7] IMAGE ERROR:",
            imageError
          );
        }
      }
    }

    // 6. Formatting
    worksheet.getRow(1).font = {
      bold: true,
    };

    worksheet.views = [
      {
        state: "frozen",
        ySplit: 1,
      },
    ];

    console.log(
      "[8] Writing XLSX..."
    );

    const buffer =
      await workbook.xlsx.writeBuffer();

    console.log(
      "[9] XLSX CREATED:",
      buffer.byteLength,
      "bytes"
    );

    console.log(
      "========== INVENTORY EXPORT SUCCESS =========="
    );

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

        "Content-Disposition":
          'attachment; filename="inventory-export.xlsx"',
      },
    });

  } catch (error) {
    console.error(
      "========== INVENTORY EXPORT ERROR =========="
    );

    console.error(error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Export failed",
      },
      {
        status: 500,
      }
    );
  }
}
