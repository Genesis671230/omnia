export type ZohoInvoiceStatus =
  | "unpaid" | "overdue" | "partially_paid" | "paid"
  | "sent" | "draft" | "viewed" | "void";

export type ResidualCategory =
  | "truly_unpaid"      // balance ≈ total, nothing paid
  | "fee_residual"      // balance < total, ratio < 10% — likely Aug 11 broken
  | "partial_payment";  // balance < total, ratio ≥ 10% — legit partial

export type WorkbenchInvoice = {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  status: ZohoInvoiceStatus;
  total: number;
  balance: number;
  currency: string;
  customerName: string;
  orderNumber: string | null;
  gateway: string;
  country: string | null;
  gatewaySource: "settlement" | "order" | "cod" | "unknown";
  settlementId: string | null;
  hasBankCredit: boolean;
  residualCategory: ResidualCategory;
  isExchange: boolean;
  exchangeSiblings: {
    invoiceId: string;
    invoiceNumber: string;
    status: ZohoInvoiceStatus;
    balance: number;
    total: number;
  }[];
};

export type WorkbenchResponse = {
  invoices: WorkbenchInvoice[];
  totalCount: number;
  gatewayCounts: Record<string, number>;
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  exchangeCount?: number;
};