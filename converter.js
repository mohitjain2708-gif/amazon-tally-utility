(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.AmazonTallyConverter = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const REQUIRED_COLUMNS = [
    "Invoice Number",
    "Invoice Date",
    "Transaction Type",
    "Order Id",
    "Quantity",
    "Item Description",
    "Sku",
    "Ship To City",
    "Ship To State",
    "Ship To Country",
    "Ship To Postal Code",
    "Invoice Amount",
    "Tax Exclusive Gross",
    "Total Tax Amount",
    "Cgst Tax",
    "Sgst Tax",
    "Igst Tax",
  ];

  const DEFAULT_CONFIG = {
    voucherType: "Sales - Amazon",
    refundVoucherType: "Amazon Cr. Note",
    companyName: "",
    gstRegistrationName: "Delhi Registration",
    companyGstState: "Delhi",
    invoiceSuffix: "/A",
    partyLedgerMode: "auto",
    partyLedgerName: "B2C Amazon Sales",
    b2bPartyLedgerName: "B2B Amazon Sales",
    partyLedgerPrefix: "Amazon B2C",
    salesLedgerName: "Sales A/c",
    cgstLedgerName: "CGST",
    sgstLedgerName: "SGST",
    igstLedgerName: "IGST",
    roundOffLedgerName: "Round Off",
    unitName: "Pcs",
    stockNameMode: "description",
    stockMapText: "",
    stockMap: {},
    godownPattern: "Amazon - MCIE ({warehouse})",
    batchName: "",
    includeBillAllocations: true,
    includeRefundRows: true,
  };

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];

      if (inQuotes) {
        if (char === '"' && next === '"') {
          field += '"';
          i += 1;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          field += char;
        }
        continue;
      }

      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (char !== "\r") {
        field += char;
      }
    }

    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }

    return rows.filter((cells) => cells.some((cell) => String(cell).trim() !== ""));
  }

  function rowsToObjects(rows) {
    if (!rows.length) return { headers: [], records: [] };
    const headers = rows[0].map((header) => String(header).trim());
    const records = rows.slice(1).map((cells, index) => {
      const record = { __rowNumber: index + 2 };
      headers.forEach((header, columnIndex) => {
        record[header] = cells[columnIndex] == null ? "" : String(cells[columnIndex]).trim();
      });
      return record;
    });
    return { headers, records };
  }

  function parseMoney(value) {
    if (value == null || value === "") return 0;
    const cleaned = String(value).replace(/,/g, "").trim();
    const amount = Number(cleaned);
    return Number.isFinite(amount) ? amount : 0;
  }

  function round2(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function formatAmount(value) {
    const rounded = round2(value);
    return (Object.is(rounded, -0) ? 0 : rounded).toFixed(2);
  }

  function parseAmazonDate(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+.*)?$/);
    if (match) {
      const day = match[1].padStart(2, "0");
      const month = match[2].padStart(2, "0");
      const yearValue = match[3].length === 2 ? `20${match[3]}` : match[3];
      return `${yearValue}${month}${day}`;
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      const yyyy = parsed.getFullYear();
      const mm = String(parsed.getMonth() + 1).padStart(2, "0");
      const dd = String(parsed.getDate()).padStart(2, "0");
      return `${yyyy}${mm}${dd}`;
    }

    return "";
  }

  function displayTallyDate(value) {
    const raw = String(value || "");
    if (!/^\d{8}$/.test(raw)) return "";
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const day = Number(raw.slice(6, 8));
    const month = monthNames[Number(raw.slice(4, 6)) - 1] || raw.slice(4, 6);
    const year = raw.slice(0, 4);
    return `${day} ${month} ${year}`;
  }

  function normalizeFilterDate(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (/^\d{8}$/.test(raw)) return raw;
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[1]}${iso[2]}${iso[3]}`;
    return parseAmazonDate(raw);
  }

  function isDateWithinFilter(tallyDate, config) {
    if (!tallyDate) return true;
    const from = normalizeFilterDate(config.dateFrom);
    const to = normalizeFilterDate(config.dateTo);
    if (from && tallyDate < from) return false;
    if (to && tallyDate > to) return false;
    return true;
  }

  function parseRate(value) {
    const rate = parseMoney(value);
    if (!rate) return 0;
    return rate <= 1 ? round2(rate * 100) : round2(rate);
  }

  function parseStockMap(config) {
    if (config.stockMap && typeof config.stockMap === "object" && Object.keys(config.stockMap).length) {
      return config.stockMap;
    }

    const map = {};
    String(config.stockMapText || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const separator = line.includes("=") ? "=" : ",";
        const [key, ...rest] = line.split(separator);
        const value = rest.join(separator).trim();
        if (key && value) map[key.trim()] = value;
      });
    return map;
  }

  function xmlEscape(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function xmlTag(name, value, indent) {
    const space = " ".repeat(indent);
    return `${space}<${name}>${xmlEscape(value)}</${name}>`;
  }

  function xmlList(name, childName, values, indent, attributes) {
    const space = " ".repeat(indent);
    const attrs = attributes ? ` ${attributes}` : "";
    const cleaned = values.filter((value) => String(value || "").trim() !== "");
    if (!cleaned.length) return [];
    return [
      `${space}<${name}${attrs}>`,
      ...cleaned.map((value) => xmlTag(childName, value, indent + 2)),
      `${space}</${name}>`,
    ];
  }

  function isDuplicateKey(value, counts) {
    return value && counts.get(value) > 1;
  }

  const INDIAN_STATES = [
    "ANDAMAN AND NICOBAR ISLANDS",
    "ANDHRA PRADESH",
    "ARUNACHAL PRADESH",
    "ASSAM",
    "BIHAR",
    "CHANDIGARH",
    "CHHATTISGARH",
    "DADRA AND NAGAR HAVELI AND DAMAN AND DIU",
    "DAMAN AND DIU",
    "DELHI",
    "GOA",
    "GUJARAT",
    "HARYANA",
    "HIMACHAL PRADESH",
    "JAMMU AND KASHMIR",
    "JHARKHAND",
    "KARNATAKA",
    "KERALA",
    "LADAKH",
    "LAKSHADWEEP",
    "MADHYA PRADESH",
    "MAHARASHTRA",
    "MANIPUR",
    "MEGHALAYA",
    "MIZORAM",
    "NAGALAND",
    "ODISHA",
    "ORISSA",
    "PUDUCHERRY",
    "PUNJAB",
    "RAJASTHAN",
    "SIKKIM",
    "TAMIL NADU",
    "TELANGANA",
    "TRIPURA",
    "UTTAR PRADESH",
    "UTTARAKHAND",
    "WEST BENGAL",
  ].sort((a, b) => b.length - a.length);

  function normalizeState(value) {
    const text = String(value || "")
      .trim()
      .replace(/\s+(ORDER|INVOICE|CREDIT\s+NOTE|ORIGINAL|DESCRIPTION|SL\.?\s*TAX|TOTAL)\b.*$/i, "")
      .replace(/\s+PLACE\s+OF\s+(SUPPLY|DELIVERY)\b.*$/i, "")
      .replace(/[^A-Za-z &]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
    const matched = INDIAN_STATES.find((state) => text === state || text.startsWith(`${state} `));
    return matched || text;
  }

  function titleCaseState(value) {
    return normalizeState(value);
  }

  function tallyCountry(value) {
    const country = String(value || "").trim();
    if (!country || country.toUpperCase() === "IN") return "India";
    return country;
  }

  function normalizeLookupKey(value) {
    return String(value || "").trim().toUpperCase();
  }

  function hasAddressIndex(config) {
    return Boolean(config.addressIndex && (config.addressIndex.byInvoice || config.addressIndex.byOrder));
  }

  function findPdfAddress(record, config, refund) {
    const index = config.addressIndex || {};
    const byInvoice = index.byInvoice || {};
    const byOrder = index.byOrder || {};
    const sourceInvoiceNo = String(record["Invoice Number"] || "").trim();
    const creditNoteNo = String(record["Credit Note No"] || "").trim();
    const orderId = String(record["Order Id"] || "").trim();
    const invoiceCandidates = refund ? [sourceInvoiceNo, creditNoteNo] : [sourceInvoiceNo];
    for (const candidate of invoiceCandidates) {
      const found = byInvoice[normalizeLookupKey(candidate)];
      if (found) return found;
    }
    const orderMatches = byOrder[normalizeLookupKey(orderId)];
    return orderMatches && orderMatches.length ? orderMatches[0] : null;
  }

  function fallbackBillAddressLines(voucher) {
    return [
      voucher.buyerName || voucher.partyLedger,
      voucher.billToCity,
      voucher.billToState,
      voucher.billToCountry,
      voucher.billToPostalCode,
    ];
  }

  function fallbackShipAddressLines(voucher) {
    return [voucher.shipToCity, voucher.shipToState, voucher.shipToCountry, voucher.shipToPostalCode];
  }

  function buildPartyLedger(record, config) {
    const buyerName = String(record["Buyer Name"] || "").trim();
    const buyerGstin = String(record["Customer Bill To Gstid"] || record["Customer Ship To Gstid"] || "").trim();
    if (config.partyLedgerMode === "auto" && (buyerName || buyerGstin)) {
      return config.b2bPartyLedgerName || "B2B Amazon Sales";
    }

    if (config.partyLedgerMode === "buyer" && (buyerName || buyerGstin)) {
      return buyerName || buyerGstin;
    }

    const state = titleCaseState(record["Ship To State"]);
    if (config.partyLedgerMode === "state" && state) {
      return `${config.partyLedgerPrefix || "Amazon B2C"} - ${state}`;
    }
    return config.partyLedgerName || DEFAULT_CONFIG.partyLedgerName;
  }

  function buildStockName(record, config) {
    const sku = String(record.Sku || "").trim();
    const asin = String(record.Asin || "").trim();
    const description = String(record["Item Description"] || "").trim();
    const stockMap = parseStockMap(config);

    if (sku && stockMap[sku]) return stockMap[sku];
    if (asin && stockMap[asin]) return stockMap[asin];

    if (config.stockNameMode === "description") return description || sku || asin;
    if (config.stockNameMode === "sku-description") {
      return [sku, description].filter(Boolean).join(" - ");
    }
    return sku || asin || description;
  }

  function validateHeaders(headers) {
    return REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  }

  function isShipment(record) {
    return String(record["Transaction Type"] || "").trim() === "Shipment";
  }

  function isRefund(record) {
    return String(record["Transaction Type"] || "").trim() === "Refund";
  }

  function absMoney(value) {
    return Math.abs(parseMoney(value));
  }

  function analyzeRecords(records, configInput) {
    const config = { ...DEFAULT_CONFIG, ...configInput };
    const errors = [];
    const warnings = [];
    const invoiceCounts = new Map();
    const lineCounts = new Map();

    records.forEach((record) => {
      if (!isShipment(record) && !isRefund(record)) return;
      const invoiceNo = isRefund(record)
        ? String(record["Credit Note No"] || "").trim()
        : String(record["Invoice Number"] || "").trim();
      const recordInvoiceDate = isRefund(record)
        ? parseAmazonDate(record["Credit Note Date"]) || parseAmazonDate(record["Invoice Date"])
        : parseAmazonDate(record["Invoice Date"]);
      if (!isDateWithinFilter(recordInvoiceDate, config)) return;
      if (invoiceNo) invoiceCounts.set(invoiceNo, (invoiceCounts.get(invoiceNo) || 0) + 1);
      const lineKey = [
        invoiceNo,
        String(record["Order Id"] || "").trim(),
        String(record.Sku || "").trim(),
        String(record.Quantity || "").trim(),
        String(record["Tax Exclusive Gross"] || "").trim(),
        String(record["Total Tax Amount"] || "").trim(),
        String(record["Invoice Amount"] || "").trim(),
      ].join("\u001f");
      if (invoiceNo) lineCounts.set(lineKey, (lineCounts.get(lineKey) || 0) + 1);
    });

    const voucherLines = [];

    records.forEach((record) => {
      const row = record.__rowNumber;
      const transactionType = String(record["Transaction Type"] || "").trim();
      const refund = transactionType === "Refund";
      const shipment = transactionType === "Shipment";
      const sourceInvoiceNo = String(record["Invoice Number"] || "").trim();
      const creditNoteNo = String(record["Credit Note No"] || "").trim();
      const invoiceNo = refund ? creditNoteNo : sourceInvoiceNo;

      if (!shipment && !refund) {
        warnings.push({
          row,
          invoiceNo: sourceInvoiceNo,
          severity: "Warning",
          message: `${transactionType || "Unknown"} row skipped. Only Shipment and Refund rows are converted.`,
        });
        return;
      }

      const originalInvoiceDate = parseAmazonDate(record["Invoice Date"]);
      const invoiceDate = refund
        ? parseAmazonDate(record["Credit Note Date"]) || originalInvoiceDate
        : originalInvoiceDate;
      if (isDateWithinFilter(invoiceDate, config) === false) return;
      const orderDate = parseAmazonDate(record["Order Date"]);
      const shipmentDate = parseAmazonDate(record["Shipment Date"]);
      const quantity = absMoney(record.Quantity);
      const taxable = refund ? absMoney(record["Tax Exclusive Gross"]) : parseMoney(record["Tax Exclusive Gross"]);
      const invoiceAmount = refund ? absMoney(record["Invoice Amount"]) : parseMoney(record["Invoice Amount"]);
      const tax = refund ? absMoney(record["Total Tax Amount"]) : parseMoney(record["Total Tax Amount"]);
      const cgst = refund ? absMoney(record["Cgst Tax"]) : parseMoney(record["Cgst Tax"]);
      const sgst = refund ? absMoney(record["Sgst Tax"]) : parseMoney(record["Sgst Tax"]);
      const igst = refund ? absMoney(record["Igst Tax"]) : parseMoney(record["Igst Tax"]);
      const cgstRate = parseRate(record["Cgst Rate"]);
      const sgstRate = parseRate(record["Sgst Rate"] || record["Utgst Rate"]);
      const igstRate = parseRate(record["Igst Rate"]);
      const stockName = buildStockName(record, config);
      const partyLedger = buildPartyLedger(record, config);
      const pdfAddress = findPdfAddress(record, config, refund);
      const lineKey = [
        invoiceNo,
        String(record["Order Id"] || "").trim(),
        String(record.Sku || "").trim(),
        String(record.Quantity || "").trim(),
        String(record["Tax Exclusive Gross"] || "").trim(),
        String(record["Total Tax Amount"] || "").trim(),
        String(record["Invoice Amount"] || "").trim(),
      ].join("\u001f");
      const buyerName = String(record["Buyer Name"] || "").trim() || pdfAddress?.billingName || "";
      const billToGstin = String(record["Customer Bill To Gstid"] || "").trim() || pdfAddress?.billingGstin || "";
      const shipToGstin = String(record["Customer Ship To Gstid"] || "").trim() || pdfAddress?.shippingGstin || "";
      const billToCity = String(record["Bill To City"] || "").trim();
      const billToState = titleCaseState(record["Bill To State"]);
      const billToCountry = tallyCountry(record["Bill To Country"]);
      const billToPostalCode = String(record["Bill To Postalcode"] || "").trim() || pdfAddress?.billingPostalCode || "";
      const shipToPostalCode = String(record["Ship To Postal Code"] || "").trim() || pdfAddress?.shippingPostalCode || "";
      const isB2b = Boolean(buyerName || billToGstin || shipToGstin);

      if (!invoiceNo) errors.push({ row, invoiceNo, severity: "Error", message: refund ? "Missing credit note number." : "Missing invoice number." });
      if (!invoiceDate) errors.push({ row, invoiceNo, severity: "Error", message: refund ? "Invalid or missing credit note date." : "Invalid or missing invoice date." });
      if (refund && !config.refundVoucherType) errors.push({ row, invoiceNo, severity: "Error", message: "Refund voucher type is required." });
      if (!stockName) errors.push({ row, invoiceNo, severity: "Error", message: "Missing stock item name/SKU." });
      if (quantity <= 0) errors.push({ row, invoiceNo, severity: "Error", message: "Quantity must be greater than zero." });
      if (taxable <= 0) errors.push({ row, invoiceNo, severity: "Error", message: refund ? "Tax Exclusive Gross must be non-zero for Refund rows." : "Tax Exclusive Gross must be greater than zero for Sales voucher rows." });
      if (!partyLedger) errors.push({ row, invoiceNo, severity: "Error", message: "Missing party ledger." });
      if (!config.salesLedgerName) errors.push({ row, invoiceNo, severity: "Error", message: "Sales ledger is required." });
      if (cgst > 0 && !config.cgstLedgerName) errors.push({ row, invoiceNo, severity: "Error", message: "CGST ledger is required." });
      if (sgst > 0 && !config.sgstLedgerName) errors.push({ row, invoiceNo, severity: "Error", message: "SGST ledger is required." });
      if (igst > 0 && !config.igstLedgerName) errors.push({ row, invoiceNo, severity: "Error", message: "IGST ledger is required." });
      if (hasAddressIndex(config) && !pdfAddress) {
        warnings.push({
          row,
          invoiceNo,
          severity: "Warning",
          message: `No matching Amazon invoice PDF found for ${refund ? "refund/original invoice" : "invoice"} address enrichment.`,
        });
      }
      if (pdfAddress && (!pdfAddress.hasBillingAddress || !pdfAddress.hasShippingAddress)) {
        warnings.push({
          row,
          invoiceNo,
          severity: "Warning",
          message: "Matching PDF found, but complete Bill To / Ship To address block was not detected.",
        });
      }

      const computedTotal = round2(taxable + tax);
      if (Math.abs(computedTotal - round2(invoiceAmount)) > 0.05) {
        warnings.push({
          row,
          invoiceNo,
          severity: "Warning",
          message: `Invoice amount ${formatAmount(invoiceAmount)} does not exactly match taxable + tax ${formatAmount(computedTotal)}.`,
        });
      }
      if (isDuplicateKey(lineKey, lineCounts)) {
        warnings.push({
          row,
          invoiceNo,
          severity: "Warning",
          message: "Possible duplicate shipment row: same invoice, order, SKU, quantity, tax, and amount appears more than once.",
        });
      }

      voucherLines.push({
        row,
        invoiceNo,
        sourceInvoiceNo,
        creditNoteNo,
        voucherNo: refund ? creditNoteNo : `${invoiceNo}${config.invoiceSuffix || ""}`,
        voucherType: refund ? config.refundVoucherType : config.voucherType,
        voucherKind: refund ? "Refund" : "Sale",
        isCreditNote: refund,
        referenceNo: refund ? sourceInvoiceNo : String(record["Order Id"] || "").trim(),
        billReferenceNo: String(record["Order Id"] || "").trim() || (refund ? sourceInvoiceNo : invoiceNo),
        referenceDate: refund ? originalInvoiceDate || invoiceDate : invoiceDate,
        invoiceDate,
        orderDate,
        shipmentDate,
        orderId: String(record["Order Id"] || "").trim(),
        partyLedger,
        buyerName,
        billToGstin,
        shipToGstin,
        isB2b,
        gstRegistrationType: billToGstin || shipToGstin ? "Regular" : "Unregistered/Consumer",
        billToCity: billToCity || String(record["Ship To City"] || "").trim(),
        billToState: billToState || titleCaseState(record["Ship To State"]),
        billToCountry,
        billToPostalCode: billToPostalCode || String(record["Ship To Postal Code"] || "").trim(),
        placeOfSupply: titleCaseState(pdfAddress?.placeOfSupply || record["Ship To State"]),
        shipToCity: String(record["Ship To City"] || "").trim(),
        shipToState: titleCaseState(pdfAddress?.placeOfDelivery || record["Ship To State"]),
        shipToCountry: tallyCountry(record["Ship To Country"]),
        shipToPostalCode,
        billToName: pdfAddress?.billingName || buyerName || "",
        shipToName: pdfAddress?.shippingName || buyerName || "",
        billToAddressLines: pdfAddress?.billingAddressLines || [],
        shipToAddressLines: pdfAddress?.shippingAddressLines || [],
        addressSource: pdfAddress ? "PDF" : "CSV",
        addressPdfFile: pdfAddress?.fileName || "",
        sellerGstin: String(record["Seller Gstin"] || "").trim(),
        hsn: String(record["Hsn/sac"] || "").trim(),
        sku: String(record.Sku || "").trim(),
        asin: String(record.Asin || "").trim(),
        warehouseId: String(record["Warehouse Id"] || "").trim(),
        itemDescription: String(record["Item Description"] || "").trim(),
        stockName,
        quantity,
        unitName: config.unitName || DEFAULT_CONFIG.unitName,
        taxable: round2(taxable),
        cgst: round2(cgst),
        sgst: round2(sgst),
        igst: round2(igst),
        cgstRate,
        sgstRate,
        igstRate,
        tax: round2(tax),
        invoiceAmount: round2(invoiceAmount),
        rate: round2(taxable / quantity),
        duplicateInvoiceNo: isDuplicateKey(invoiceNo, invoiceCounts),
      });
    });

    const grouped = new Map();
    voucherLines.forEach((line) => {
      const key = `${line.voucherKind}\u001f${line.invoiceNo}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(line);
    });

    const vouchers = Array.from(grouped.values()).map((lines) => {
      const first = lines[0];
      const taxableTotal = round2(lines.reduce((sum, line) => sum + line.taxable, 0));
      const cgstTotal = round2(lines.reduce((sum, line) => sum + line.cgst, 0));
      const sgstTotal = round2(lines.reduce((sum, line) => sum + line.sgst, 0));
      const igstTotal = round2(lines.reduce((sum, line) => sum + line.igst, 0));
      const taxTotal = round2(cgstTotal + sgstTotal + igstTotal);
      const invoiceTotal = round2(lines.reduce((sum, line) => sum + line.invoiceAmount, 0));
      const expectedTotal = round2(taxableTotal + taxTotal);
      const roundOff = round2(invoiceTotal - expectedTotal);

      const conflicts = ["invoiceDate", "partyLedger", "placeOfSupply"].filter((key) =>
        lines.some((line) => line[key] !== first[key])
      );

      if (conflicts.length) {
        errors.push({
          row: first.row,
          invoiceNo: first.invoiceNo,
          severity: "Error",
          message: `Rows for invoice have conflicting ${conflicts.join(", ")} values.`,
        });
      }

      return {
        invoiceNo: first.invoiceNo,
        sourceInvoiceNo: first.sourceInvoiceNo,
        creditNoteNo: first.creditNoteNo,
        voucherNo: first.voucherNo,
        voucherType: first.voucherType,
        voucherKind: first.voucherKind,
        isCreditNote: first.isCreditNote,
        referenceNo: first.referenceNo,
        billReferenceNo: first.billReferenceNo,
        referenceDate: first.referenceDate,
        invoiceDate: first.invoiceDate,
        orderDate: first.orderDate,
        shipmentDate: first.shipmentDate,
        orderId: first.orderId,
        partyLedger: first.partyLedger,
        buyerName: first.buyerName,
        billToGstin: first.billToGstin,
        shipToGstin: first.shipToGstin,
        isB2b: first.isB2b,
        gstRegistrationType: first.gstRegistrationType,
        billToCity: first.billToCity,
        billToState: first.billToState,
        billToCountry: first.billToCountry,
        billToPostalCode: first.billToPostalCode,
        placeOfSupply: first.placeOfSupply,
        shipToCity: first.shipToCity,
        shipToState: first.shipToState,
        shipToCountry: first.shipToCountry,
        shipToPostalCode: first.shipToPostalCode,
        billToName: first.billToName,
        shipToName: first.shipToName,
        billToAddressLines: first.billToAddressLines,
        shipToAddressLines: first.shipToAddressLines,
        addressSource: first.addressSource,
        addressPdfFile: first.addressPdfFile,
        taxableTotal,
        cgstTotal,
        sgstTotal,
        igstTotal,
        taxTotal,
        invoiceTotal,
        expectedTotal,
        roundOff,
        lines,
      };
    });

    const voucherDates = vouchers.map((voucher) => voucher.invoiceDate).filter(Boolean).sort();
    const minVoucherDate = voucherDates[0] || "";
    const maxVoucherDate = voucherDates[voucherDates.length - 1] || "";
    const signed = (voucher, value) => (voucher.isCreditNote ? -value : value);
    const summary = {
      totalRows: records.length,
      voucherCount: vouchers.length,
      salesVoucherCount: vouchers.filter((voucher) => !voucher.isCreditNote).length,
      refundVoucherCount: vouchers.filter((voucher) => voucher.isCreditNote).length,
      shipmentRows: voucherLines.filter((line) => line.voucherKind === "Sale").length,
      refundRows: voucherLines.filter((line) => line.voucherKind === "Refund").length,
      skippedRows: records.length - voucherLines.length,
      errorCount: errors.length,
      warningCount: warnings.length,
      taxableTotal: round2(vouchers.reduce((sum, voucher) => sum + signed(voucher, voucher.taxableTotal), 0)),
      cgstTotal: round2(vouchers.reduce((sum, voucher) => sum + signed(voucher, voucher.cgstTotal), 0)),
      sgstTotal: round2(vouchers.reduce((sum, voucher) => sum + signed(voucher, voucher.sgstTotal), 0)),
      igstTotal: round2(vouchers.reduce((sum, voucher) => sum + signed(voucher, voucher.igstTotal), 0)),
      invoiceTotal: round2(vouchers.reduce((sum, voucher) => sum + signed(voucher, voucher.invoiceTotal), 0)),
      refundTotal: round2(vouchers.filter((voucher) => voucher.isCreditNote).reduce((sum, voucher) => sum + voucher.invoiceTotal, 0)),
      pdfAddressVoucherCount: vouchers.filter((voucher) => voucher.addressSource === "PDF").length,
      minVoucherDate,
      maxVoucherDate,
      voucherDateRange:
        minVoucherDate && maxVoucherDate
          ? minVoucherDate === maxVoucherDate
            ? displayTallyDate(minVoucherDate)
            : `${displayTallyDate(minVoucherDate)} - ${displayTallyDate(maxVoucherDate)}`
          : "",
    };

    return { config, vouchers, errors, warnings, summary };
  }

  function ledgerEntryXml(name, isDeemedPositive, amount, indent, extraLines, options = {}) {
    const tagName = options.tagName || "LEDGERENTRIES.LIST";
    const isPartyLedger = options.isPartyLedger ? "Yes" : "No";
    const lines = [
      `${" ".repeat(indent)}<${tagName}>`,
      `${" ".repeat(indent + 2)}<OLDAUDITENTRYIDS.LIST TYPE="Number">`,
      xmlTag("OLDAUDITENTRYIDS", "-1", indent + 4),
      `${" ".repeat(indent + 2)}</OLDAUDITENTRYIDS.LIST>`,
      xmlTag("LEDGERNAME", name, indent + 2),
      xmlTag("GSTCLASS", "Not Applicable", indent + 2),
      xmlTag("GSTOVRDNTYPEOFSUPPLY", "Services", indent + 2),
      xmlTag("ISDEEMEDPOSITIVE", isDeemedPositive ? "Yes" : "No", indent + 2),
      xmlTag("LEDGERFROMITEM", "No", indent + 2),
      xmlTag("ISPARTYLEDGER", isPartyLedger, indent + 2),
      xmlTag("ISLASTDEEMEDPOSITIVE", isDeemedPositive ? "Yes" : "No", indent + 2),
      xmlTag("AMOUNT", formatAmount(amount), indent + 2),
    ];
    if (extraLines) lines.push(...extraLines);
    if (options.vatExpAmount) lines.push(xmlTag("VATEXPAMOUNT", formatAmount(amount), indent + 2));
    lines.push(`${" ".repeat(indent)}</${tagName}>`);
    return lines;
  }

  function rateDetailsXml(head, rate, indent) {
    const lines = [
      `${" ".repeat(indent)}<RATEDETAILS.LIST>`,
      xmlTag("GSTRATEDUTYHEAD", head, indent + 2),
    ];
    if (rate) {
      lines.push(xmlTag("GSTRATEVALUATIONTYPE", "Based on Value", indent + 2));
      lines.push(xmlTag("GSTRATE", ` ${formatAmount(rate).replace(/\.00$/, "")}`, indent + 2));
    }
    lines.push(`${" ".repeat(indent)}</RATEDETAILS.LIST>`);
    return lines;
  }

  function godownNameFor(item, config) {
    const pattern = String(config.godownPattern || "").trim();
    if (!pattern) return "";
    return pattern.replace("{warehouse}", item.warehouseId || "").trim();
  }

  function batchNameFor(item, config) {
    return String(config.batchName || "").trim() || item.invoiceDate || "";
  }

  function accountingAllocationXml(item, config, indent, isCreditNote) {
    const amount = isCreditNote ? -item.taxable : item.taxable;
    const deemedPositive = isCreditNote ? "Yes" : "No";
    return [
      `${" ".repeat(indent)}<ACCOUNTINGALLOCATIONS.LIST>`,
      `${" ".repeat(indent + 2)}<OLDAUDITENTRYIDS.LIST TYPE="Number">`,
      xmlTag("OLDAUDITENTRYIDS", "-1", indent + 4),
      `${" ".repeat(indent + 2)}</OLDAUDITENTRYIDS.LIST>`,
      xmlTag("LEDGERNAME", config.salesLedgerName, indent + 2),
      xmlTag("GSTCLASS", "Not Applicable", indent + 2),
      xmlTag("GSTOVRDNTYPEOFSUPPLY", "Goods", indent + 2),
      xmlTag("GSTRATEINFERAPPLICABILITY", "As per Masters/Company", indent + 2),
      xmlTag("GSTHSNINFERAPPLICABILITY", "As per Masters/Company", indent + 2),
      xmlTag("ISDEEMEDPOSITIVE", deemedPositive, indent + 2),
      xmlTag("LEDGERFROMITEM", "No", indent + 2),
      xmlTag("ISPARTYLEDGER", "No", indent + 2),
      xmlTag("ISLASTDEEMEDPOSITIVE", deemedPositive, indent + 2),
      xmlTag("AMOUNT", formatAmount(amount), indent + 2),
      ...rateDetailsXml("CGST", 0, indent + 2),
      ...rateDetailsXml("SGST/UTGST", 0, indent + 2),
      ...rateDetailsXml("IGST", 0, indent + 2),
      ...rateDetailsXml("Cess", 0, indent + 2),
      ...rateDetailsXml("State Cess", 0, indent + 2),
      `${" ".repeat(indent)}</ACCOUNTINGALLOCATIONS.LIST>`,
    ];
  }

  function inventoryEntryXml(item, config, indent, isCreditNote) {
    const godown = godownNameFor(item, config);
    const batch = batchNameFor(item, config);
    const amount = isCreditNote ? -item.taxable : item.taxable;
    const deemedPositive = isCreditNote ? "Yes" : "No";
    const lines = [
      `${" ".repeat(indent)}<ALLINVENTORYENTRIES.LIST>`,
      xmlTag("STOCKITEMNAME", item.stockName, indent + 2),
      xmlTag("GSTOVRDNTAXABILITY", "Taxable", indent + 2),
      xmlTag("GSTSOURCETYPE", "Stock Item", indent + 2),
      xmlTag("GSTITEMSOURCE", item.stockName, indent + 2),
      xmlTag("HSNSOURCETYPE", "Stock Item", indent + 2),
      xmlTag("HSNITEMSOURCE", item.stockName, indent + 2),
      xmlTag("GSTOVRDNTYPEOFSUPPLY", "Goods", indent + 2),
      xmlTag("GSTRATEINFERAPPLICABILITY", "As per Masters/Company", indent + 2),
      item.hsn ? xmlTag("GSTHSNNAME", item.hsn, indent + 2) : "",
      xmlTag("GSTHSNINFERAPPLICABILITY", "As per Masters/Company", indent + 2),
      xmlTag("ISDEEMEDPOSITIVE", deemedPositive, indent + 2),
      xmlTag("ISLASTDEEMEDPOSITIVE", deemedPositive, indent + 2),
      xmlTag("RATE", `${formatAmount(item.rate)}/${item.unitName}`, indent + 2),
      xmlTag("AMOUNT", formatAmount(amount), indent + 2),
      xmlTag("ACTUALQTY", ` ${item.quantity} ${item.unitName}`, indent + 2),
      xmlTag("BILLEDQTY", ` ${item.quantity} ${item.unitName}`, indent + 2),
      godown || batch
        ? [
            `${" ".repeat(indent + 2)}<BATCHALLOCATIONS.LIST>`,
            godown ? xmlTag("GODOWNNAME", godown, indent + 4) : "",
            batch ? xmlTag("BATCHNAME", batch, indent + 4) : "",
            godown ? xmlTag("DESTINATIONGODOWNNAME", godown, indent + 4) : "",
            xmlTag("AMOUNT", formatAmount(amount), indent + 4),
            xmlTag("ACTUALQTY", ` ${item.quantity} ${item.unitName}`, indent + 4),
            xmlTag("BILLEDQTY", ` ${item.quantity} ${item.unitName}`, indent + 4),
            `${" ".repeat(indent + 2)}</BATCHALLOCATIONS.LIST>`,
          ]
            .filter(Boolean)
            .join("\n")
        : "",
      ...accountingAllocationXml(item, config, indent + 2, isCreditNote),
      ...rateDetailsXml("CGST", item.cgstRate, indent + 2),
      ...rateDetailsXml("SGST/UTGST", item.sgstRate, indent + 2),
      ...rateDetailsXml("IGST", item.igstRate, indent + 2),
      ...rateDetailsXml("Cess", 0, indent + 2),
      ...rateDetailsXml("State Cess", 0, indent + 2),
      `${" ".repeat(indent)}</ALLINVENTORYENTRIES.LIST>`,
    ];
    return lines.filter(Boolean);
  }

  function buildVoucherXml(voucher, config) {
    const voucherType = voucher.voucherType || config.voucherType;
    const partyAmount = voucher.isCreditNote ? voucher.invoiceTotal : -voucher.invoiceTotal;
    const partyIsDeemedPositive = !voucher.isCreditNote;
    const referenceNo = voucher.referenceNo || voucher.orderId;
    const billReferenceNo = voucher.billReferenceNo || voucher.orderId || referenceNo || voucher.voucherNo;
    const referenceDate = voucher.referenceDate || voucher.invoiceDate;
    const lines = [
      '      <TALLYMESSAGE xmlns:UDF="TallyUDF">',
      `        <VOUCHER VCHTYPE="${xmlEscape(voucherType)}" ACTION="Create" OBJVIEW="Invoice Voucher View">`,
      ...xmlList(
        "ADDRESS.LIST",
        "ADDRESS",
        voucher.billToAddressLines && voucher.billToAddressLines.length ? voucher.billToAddressLines : fallbackBillAddressLines(voucher),
        10,
        'TYPE="String"'
      ),
      ...xmlList(
        "BASICBUYERADDRESS.LIST",
        "BASICBUYERADDRESS",
        voucher.billToAddressLines && voucher.billToAddressLines.length ? voucher.billToAddressLines : fallbackBillAddressLines(voucher),
        10,
        'TYPE="String"'
      ),
      "          <OLDAUDITENTRYIDS.LIST TYPE=\"Number\">",
      xmlTag("OLDAUDITENTRYIDS", "-1", 12),
      "          </OLDAUDITENTRYIDS.LIST>",
      xmlTag("DATE", voucher.invoiceDate, 10),
      xmlTag("REFERENCEDATE", referenceDate, 10),
      xmlTag("VCHSTATUSDATE", voucher.invoiceDate, 10),
      xmlTag("GSTREGISTRATIONTYPE", voucher.gstRegistrationType, 10),
      xmlTag("VOUCHERTYPENAME", voucherType, 10),
      xmlTag("PARTYNAME", voucher.partyLedger, 10),
      config.gstRegistrationName && voucher.lines[0]?.sellerGstin
        ? `          <GSTREGISTRATION TAXTYPE="GST" TAXREGISTRATION="${xmlEscape(voucher.lines[0].sellerGstin)}">${xmlEscape(config.gstRegistrationName)}</GSTREGISTRATION>`
        : "",
      voucher.lines[0]?.sellerGstin ? xmlTag("CMPGSTIN", voucher.lines[0].sellerGstin, 10) : "",
      xmlTag("PARTYLEDGERNAME", voucher.partyLedger, 10),
      voucher.billToGstin ? xmlTag("PARTYGSTIN", voucher.billToGstin, 10) : "",
      xmlTag("VOUCHERNUMBER", voucher.voucherNo, 10),
      xmlTag("CMPGSTREGISTRATIONTYPE", "Regular", 10),
      xmlTag("REFERENCE", referenceNo, 10),
      xmlTag("PARTYMAILINGNAME", voucher.partyLedger, 10),
      xmlTag("PARTYPINCODE", voucher.billToPostalCode, 10),
      xmlTag("CONSIGNEEPINCODE", voucher.shipToPostalCode, 10),
      xmlTag("CONSIGNEESTATENAME", voucher.shipToState, 10),
      voucher.shipToGstin || voucher.billToGstin ? xmlTag("CONSIGNEEGSTIN", voucher.shipToGstin || voucher.billToGstin, 10) : "",
      xmlTag("CMPGSTSTATE", config.companyGstState, 10),
      xmlTag("STATENAME", voucher.shipToState, 10),
      xmlTag("COUNTRYOFRESIDENCE", voucher.shipToCountry || "India", 10),
      xmlTag("PLACEOFSUPPLY", voucher.placeOfSupply, 10),
      xmlTag("NUMBERINGSTYLE", "Manual", 10),
      xmlTag("PERSISTEDVIEW", "Invoice Voucher View", 10),
      xmlTag("VCHSTATUSVOUCHERTYPE", voucherType, 10),
      config.gstRegistrationName ? xmlTag("VCHSTATUSTAXUNIT", config.gstRegistrationName, 10) : "",
      xmlTag("VCHENTRYMODE", "Item Invoice", 10),
      xmlTag("EFFECTIVEDATE", voucher.invoiceDate, 10),
      xmlTag("ISINVOICE", "Yes", 10),
      xmlTag("BASICBUYERNAME", voucher.partyLedger, 10),
      xmlTag("CONSIGNEEMAILINGNAME", voucher.partyLedger, 10),
      xmlTag("CONSIGNEECOUNTRYNAME", voucher.shipToCountry || "India", 10),
      ...xmlList(
        "CONSIGNEEADDRESS.LIST",
        "CONSIGNEEADDRESS",
        voucher.shipToAddressLines && voucher.shipToAddressLines.length ? voucher.shipToAddressLines : fallbackShipAddressLines(voucher),
        10,
        'TYPE="String"'
      ),
    ].filter(Boolean);

    const billAllocations = config.includeBillAllocations
      ? [
          "          <BILLALLOCATIONS.LIST>",
          xmlTag("NAME", billReferenceNo, 12),
          xmlTag("BILLTYPE", "New Ref", 12),
          xmlTag("TDSDEDUCTEEISSPECIALRATE", "No", 12),
          xmlTag("AMOUNT", formatAmount(partyAmount), 12),
          "          </BILLALLOCATIONS.LIST>",
        ]
      : [];

    const ledgerLines = [
      ...ledgerEntryXml(voucher.partyLedger, partyIsDeemedPositive, partyAmount, 10, billAllocations, {
        isPartyLedger: true,
      }),
    ];

    const taxSign = voucher.isCreditNote ? -1 : 1;
    if (voucher.cgstTotal) ledgerLines.push(...ledgerEntryXml(config.cgstLedgerName, voucher.isCreditNote, taxSign * voucher.cgstTotal, 10, null, { vatExpAmount: true }));
    if (voucher.sgstTotal) ledgerLines.push(...ledgerEntryXml(config.sgstLedgerName, voucher.isCreditNote, taxSign * voucher.sgstTotal, 10, null, { vatExpAmount: true }));
    if (voucher.igstTotal) ledgerLines.push(...ledgerEntryXml(config.igstLedgerName, voucher.isCreditNote, taxSign * voucher.igstTotal, 10, null, { vatExpAmount: true }));
    if (voucher.roundOff) {
      const roundOffAmount = voucher.isCreditNote ? -voucher.roundOff : voucher.roundOff;
      ledgerLines.push(...ledgerEntryXml(config.roundOffLedgerName, roundOffAmount < 0, roundOffAmount, 10));
    }

    lines.push(...voucher.lines.flatMap((item) => inventoryEntryXml(item, config, 10, voucher.isCreditNote)));

    if (voucher.orderId) {
      lines.push(
        "          <INVOICEORDERLIST.LIST>",
        xmlTag("BASICORDERDATE", voucher.orderDate || voucher.invoiceDate, 12),
        xmlTag("BASICPURCHASEORDERNO", voucher.orderId, 12),
        "          </INVOICEORDERLIST.LIST>"
      );
    }

    lines.push(...ledgerLines);

    lines.push("        </VOUCHER>", "      </TALLYMESSAGE>");
    return lines;
  }

  function buildXml(vouchers, configInput) {
    const config = { ...DEFAULT_CONFIG, ...configInput };
    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<ENVELOPE>",
      "  <HEADER>",
      "    <TALLYREQUEST>Import Data</TALLYREQUEST>",
      "  </HEADER>",
      "  <BODY>",
      "    <IMPORTDATA>",
      "      <REQUESTDESC>",
      "        <REPORTNAME>Vouchers</REPORTNAME>",
      config.companyName
        ? `        <STATICVARIABLES>\n          <SVCURRENTCOMPANY>${xmlEscape(config.companyName)}</SVCURRENTCOMPANY>\n        </STATICVARIABLES>`
        : "",
      "      </REQUESTDESC>",
      "      <REQUESTDATA>",
    ].filter(Boolean);

    vouchers.forEach((voucher) => {
      lines.push(...buildVoucherXml(voucher, config));
    });

    lines.push(
      "      </REQUESTDATA>",
      "    </IMPORTDATA>",
      "  </BODY>",
      "</ENVELOPE>"
    );

    return `${lines.join("\n")}\n`;
  }

  function toCsv(rows, headers) {
    const escapeCell = (value) => {
      const text = String(value == null ? "" : value);
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return [
      headers.join(","),
      ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(",")),
    ].join("\n");
  }

  function buildReportCsv(errors, warnings) {
    const rows = [...errors, ...warnings].sort((a, b) => (a.row || 0) - (b.row || 0));
    return toCsv(rows, ["row", "invoiceNo", "severity", "message"]);
  }

  function debitAmount(amount) {
    return amount < 0 ? formatAmount(Math.abs(amount)) : "";
  }

  function creditAmount(amount) {
    return amount > 0 ? formatAmount(amount) : "";
  }

  function addAccountingRow(rows, voucher, lineType, ledgerOrItem, amount, details = {}) {
    if (!round2(amount)) return;
    const referenceNo = voucher.referenceNo || voucher.orderId || "";
    rows.push({
      "Voucher Date": displayTallyDate(voucher.invoiceDate),
      "Voucher Type": voucher.voucherType,
      "Voucher No": voucher.voucherNo,
      "Reference No": referenceNo,
      "Buyer Order No": voucher.orderId || "",
      "Party Ledger": voucher.partyLedger,
      "Transaction Type": voucher.voucherKind,
      "Line Type": lineType,
      "Ledger / Stock Item": ledgerOrItem,
      Debit: debitAmount(amount),
      Credit: creditAmount(amount),
      Quantity: details.quantity || "",
      Rate: details.rate || "",
      "Bill / Order Ref": details.billRef || voucher.billReferenceNo || voucher.orderId || referenceNo || voucher.voucherNo,
      GSTIN: voucher.billToGstin || voucher.shipToGstin || "",
      "Address Source": voucher.addressSource || "CSV",
      Basis: details.basis || "",
      "Expected Tally Effect": amount < 0 ? "Debit" : "Credit",
    });
  }

  function buildAccountingReportCsv(vouchers, configInput) {
    const config = { ...DEFAULT_CONFIG, ...configInput };
    const headers = [
      "Voucher Date",
      "Voucher Type",
      "Voucher No",
      "Reference No",
      "Buyer Order No",
      "Party Ledger",
      "Transaction Type",
      "Line Type",
      "Ledger / Stock Item",
      "Debit",
      "Credit",
      "Quantity",
      "Rate",
      "Bill / Order Ref",
      "GSTIN",
      "Address Source",
      "Basis",
      "Expected Tally Effect",
    ];
    const rows = [];
    vouchers.forEach((voucher) => {
      const partyAmount = voucher.isCreditNote ? voucher.invoiceTotal : -voucher.invoiceTotal;
      addAccountingRow(rows, voucher, "Ledger", voucher.partyLedger, partyAmount, { basis: "Party ledger total for voucher" });
      voucher.lines.forEach((item) => {
        const salesAmount = voucher.isCreditNote ? -item.taxable : item.taxable;
        addAccountingRow(rows, voucher, "Inventory Accounting Allocation", config.salesLedgerName, salesAmount, {
          quantity: `${item.quantity} ${item.unitName}`,
          rate: `${formatAmount(item.rate)}/${item.unitName}`,
          billRef: item.orderId || voucher.orderId || "",
          basis: item.stockName,
        });
      });
      const taxSign = voucher.isCreditNote ? -1 : 1;
      addAccountingRow(rows, voucher, "Ledger", config.cgstLedgerName, taxSign * voucher.cgstTotal, { basis: "Output CGST as per voucher tax total" });
      addAccountingRow(rows, voucher, "Ledger", config.sgstLedgerName, taxSign * voucher.sgstTotal, { basis: "Output SGST as per voucher tax total" });
      addAccountingRow(rows, voucher, "Ledger", config.igstLedgerName, taxSign * voucher.igstTotal, { basis: "Output IGST as per voucher tax total" });
      if (voucher.roundOff) {
        const roundOffAmount = voucher.isCreditNote ? -voucher.roundOff : voucher.roundOff;
        addAccountingRow(rows, voucher, "Ledger", config.roundOffLedgerName, roundOffAmount, { basis: "Difference between invoice total and taxable plus tax" });
      }
    });
    return toCsv(rows, headers);
  }

  function previewRows(vouchers, limit = 100) {
    return vouchers.slice(0, limit).map((voucher) => ({
      invoiceNo: voucher.isCreditNote ? voucher.sourceInvoiceNo : voucher.invoiceNo,
      type: voucher.voucherKind,
      voucherNo: voucher.voucherNo,
      orderId: voucher.orderId || "",
      date: voucher.invoiceDate,
      partyLedger: voucher.partyLedger,
      gstin: voucher.billToGstin || voucher.shipToGstin || "",
      tallyItems: voucher.lines.map((line) => line.stockName).join(" | "),
      amazonDescriptions: voucher.lines.map((line) => line.itemDescription).filter(Boolean).join(" | "),
      addressSource: voucher.addressSource || "CSV",
      addressPdfFile: voucher.addressPdfFile || "",
      items: voucher.lines.length,
      taxable: formatAmount(voucher.taxableTotal),
      cgst: formatAmount(voucher.cgstTotal),
      sgst: formatAmount(voucher.sgstTotal),
      igst: formatAmount(voucher.igstTotal),
      total: formatAmount(voucher.invoiceTotal),
    }));
  }

  function convertCsvText(text, configInput) {
    const rows = parseCSV(text);
    const { headers, records } = rowsToObjects(rows);
    const missingColumns = validateHeaders(headers);

    if (missingColumns.length) {
      return {
        config: { ...DEFAULT_CONFIG, ...configInput },
        headers,
        records,
        missingColumns,
        vouchers: [],
        errors: missingColumns.map((column) => ({
          row: 1,
          invoiceNo: "",
          severity: "Error",
          message: `Missing required column: ${column}`,
        })),
        warnings: [],
        summary: {
          totalRows: records.length,
          voucherCount: 0,
          salesVoucherCount: 0,
          refundVoucherCount: 0,
          shipmentRows: 0,
          refundRows: 0,
          skippedRows: records.length,
          errorCount: missingColumns.length,
          warningCount: 0,
          taxableTotal: 0,
          cgstTotal: 0,
          sgstTotal: 0,
          igstTotal: 0,
          invoiceTotal: 0,
          refundTotal: 0,
        },
        xml: "",
        reportCsv: "",
        accountingReportCsv: "",
        preview: [],
      };
    }

    const analysis = analyzeRecords(records, configInput);
    const xml = analysis.errors.length ? "" : buildXml(analysis.vouchers, analysis.config);
    const reportCsv = buildReportCsv(analysis.errors, analysis.warnings);

    return {
      ...analysis,
      headers,
      records,
      missingColumns,
      xml,
      reportCsv,
      accountingReportCsv: analysis.errors.length ? "" : buildAccountingReportCsv(analysis.vouchers, analysis.config),
      preview: previewRows(analysis.vouchers),
    };
  }

  return {
    DEFAULT_CONFIG,
    REQUIRED_COLUMNS,
    parseCSV,
    rowsToObjects,
    convertCsvText,
    buildXml,
    buildReportCsv,
    buildAccountingReportCsv,
    formatAmount,
  };
});
