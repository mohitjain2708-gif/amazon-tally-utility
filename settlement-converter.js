(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.AmazonSettlementConverter = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const DEFAULT_CONFIG = {
    companyName: "",
    settlementVoucherType: "Journal",
    settlementVoucherNumberStart: "",
    settlementPartyLedgerName: "Mangal Maitri Multitrade LLP - JPR",
    feeLedgerBlrName: "Amazon Seller Services Private Limited - BLR",
    feeLedgerDelName: "Amazon Seller Services Private Limited - DEL",
    tcsLedgerName: "TCS Receivable",
    tdsLedgerName: "TDS Receivable",
    b2bPartyLedgerName: "B2B Amazon Sales",
    partyLedgerName: "B2C Amazon Sales",
    otherChargesLedgerName: "Amazon Other Charges",
    reimbursementLedgerName: "Amazon Seller Services Private Limited - BLR",
    roundOffLedgerName: "Round Off",
    orderClassifications: {},
  };

  const STANDARD_AMOUNT_TYPES = new Set(["ItemPrice", "Promotion", "ItemFees", "Item Fee Adjustment", "ItemTCS", "ItemTDS"]);

  function parseDelimited(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    const delimiter = String(text || "").split(/\r?\n/, 1)[0].includes("\t") ? "\t" : ",";

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
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
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
    if (!rows.length) return [];
    const headers = rows[0].map((header) => normalizeHeader(header));
    return rows.slice(1).map((cells) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = cells[index] == null ? "" : String(cells[index]).trim();
      });
      return record;
    });
  }

  function parseText(text) {
    const rows = parseDelimited(String(text || "").replace(/^\uFEFF/, ""));
    return { headers: rows[0] || [], records: rowsToObjects(rows) };
  }

  function normalizeHeader(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
  }

  function get(record, key) {
    const normalized = normalizeHeader(key);
    return record[normalized] != null ? record[normalized] : record[key] || "";
  }

  function parseMoney(value) {
    if (value == null || value === "") return 0;
    const amount = Number(String(value).replace(/,/g, "").trim());
    return Number.isFinite(amount) ? amount : 0;
  }

  function round2(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function formatAmount(value) {
    const rounded = round2(value);
    return (Object.is(rounded, -0) ? 0 : rounded).toFixed(2);
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
    return `${" ".repeat(indent)}<${name}>${xmlEscape(value)}</${name}>`;
  }

  function parseAmazonDate(value) {
    const raw = String(value || "").trim();
    const match = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2}))?/);
    if (!match) return "";
    return `${match[3]}${match[2].padStart(2, "0")}${match[1].padStart(2, "0")}`;
  }

  function addDays(tallyDate, days) {
    if (!/^\d{8}$/.test(tallyDate)) return tallyDate;
    const date = new Date(Date.UTC(Number(tallyDate.slice(0, 4)), Number(tallyDate.slice(4, 6)) - 1, Number(tallyDate.slice(6, 8))));
    date.setUTCDate(date.getUTCDate() + days);
    return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
  }

  function displayTallyDate(value) {
    if (!/^\d{8}$/.test(String(value || ""))) return "";
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${Number(value.slice(6, 8))} ${months[Number(value.slice(4, 6)) - 1]} ${value.slice(0, 4)}`;
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

  function isHeaderRow(record) {
    return Boolean(get(record, "settlement-id")) && Boolean(get(record, "total-amount")) && !get(record, "transaction-type") && !get(record, "amount-type");
  }

  function orderClassification(row, config, warnings, settlementId) {
    const explicit = String(get(row, "transaction") || "").trim().toUpperCase();
    if (explicit === "B2B" || explicit === "B2C") return explicit;
    const orderId = String(get(row, "order-id") || "").trim();
    const learned = config.orderClassifications && config.orderClassifications[orderId];
    if (learned === "B2B" || learned === "B2C") return learned;
    if (orderId) {
      const warningKey = `missing-classification-${settlementId}`;
      if (!warnings.some((warning) => warning.key === warningKey)) {
        warnings.push({
          key: warningKey,
          settlementId,
          severity: "Warning",
          message: "Some settlement rows do not say B2B/B2C. They were treated as B2C unless matched from uploaded sales files.",
        });
      }
      return "B2C";
    }
    return "";
  }

  function addTo(map, key, value) {
    if (!key || !value) return;
    map.set(key, round2((map.get(key) || 0) + value));
  }

  function addBill(bills, name, amount) {
    const rounded = round2(amount);
    if (!name || !rounded) return;
    const existing = bills.find((bill) => bill.name === name);
    if (existing) {
      existing.amount = round2(existing.amount + rounded);
    } else {
      bills.push({ name, amount: rounded });
    }
  }

  function reimbursementBillName(amountType, description, orderId) {
    if (/reimbursement/i.test(`${amountType} ${description}`)) return "REIMBURSEMENT";
    return orderId || description || amountType || "Amazon reimbursement";
  }

  function sortBillsByPreferredOrder(bills, preferredOrder) {
    const rank = new Map(preferredOrder.map((name, index) => [name, index]));
    bills.sort((a, b) => {
      const aRank = rank.has(a.name) ? rank.get(a.name) : preferredOrder.length;
      const bRank = rank.has(b.name) ? rank.get(b.name) : preferredOrder.length;
      if (aRank !== bRank) return aRank - bRank;
      return a.name.localeCompare(b.name);
    });
  }

  function buildSettlement(records, settlement, config, warnings) {
    const salesByLedger = new Map();
    const orderGross = new Map();
    const blrBills = [];
    const delBills = [];
    const otherChargeBills = [];
    const reimbursementBills = [];
    let tcs = 0;
    let tds = 0;

    settlement.rows.forEach((row) => {
      const amountType = String(get(row, "amount-type") || "").trim();
      const description = String(get(row, "amount-description") || "").trim();
      const transactionType = String(get(row, "transaction-type") || "").trim();
      const orderId = String(get(row, "order-id") || "").trim();
      const amount = parseMoney(get(row, "amount"));
      const classification = orderClassification(row, config, warnings, settlement.id);

      if ((amountType === "ItemPrice" || amountType === "Promotion") && orderId) {
        const ledgerName = classification === "B2B" ? config.b2bPartyLedgerName : config.partyLedgerName;
        addTo(salesByLedger, ledgerName, amount);
        addTo(orderGross, `${ledgerName}|||${orderId}`, amount);
        return;
      }

      if (amountType === "ItemTCS") {
        tcs = round2(tcs + amount);
        return;
      }

      if (amountType === "ItemTDS") {
        tds = round2(tds + amount);
        return;
      }

      if (amountType === "ItemFees" || amountType === "Item Fee Adjustment") {
        if (description === "Commission") addBill(blrBills, "Commission", amount);
        else if (description === "Fixed closing fee") addBill(blrBills, "Fixed closing fee", amount);
        else if (/IGST$/i.test(description)) addBill(blrBills, "IGST", amount);
        else if (description === "FBA Pick & Pack Fee") addBill(delBills, "FBA Pick & Pack Fee", amount);
        else if (description === "FBA Weight Handling Fee") addBill(delBills, "FBA Weight Handling Fee", amount);
        else if (description === "Shipping Chargeback") addBill(delBills, "Shipping Chargeback", amount);
        else if (/CGST$/i.test(description)) addBill(delBills, "CGST", amount);
        else if (/SGST$/i.test(description)) addBill(delBills, "SGST", amount);
        else addBill(otherChargeBills, description || amountType, amount);
        return;
      }

      if (!STANDARD_AMOUNT_TYPES.has(amountType) || transactionType === "other-transaction") {
        if (amount < 0) addBill(otherChargeBills, description || amountType || "Other Amazon charge", amount);
        if (amount > 0) addBill(reimbursementBills, reimbursementBillName(amountType, description, orderId), amount);
      }
    });

    sortBillsByPreferredOrder(blrBills, ["Commission", "Fixed closing fee", "IGST"]);
    sortBillsByPreferredOrder(delBills, ["CGST", "FBA Pick & Pack Fee", "FBA Weight Handling Fee", "SGST", "Shipping Chargeback"]);

    const positiveOrderBills = Array.from(orderGross.entries())
      .map(([key, amount]) => {
        const [ledgerName, orderId] = key.split("|||");
        return { ledgerName, orderId, amount };
      })
      .filter((bill) => bill.amount > 0)
      .sort((a, b) => a.orderId.localeCompare(b.orderId));

    return {
      ...settlement,
      date: settlement.depositDate ? addDays(settlement.depositDate, -1) : settlement.endDate || settlement.startDate,
      salesByLedger,
      orderBills: positiveOrderBills,
      blrBills,
      delBills,
      tcs,
      tds,
      otherChargeBills,
      reimbursementBills,
    };
  }

  function analyze(recordsInput, configInput) {
    const config = { ...DEFAULT_CONFIG, ...configInput };
    const records = recordsInput.map((record) => {
      const normalized = {};
      Object.entries(record).forEach(([key, value]) => {
        normalized[normalizeHeader(key)] = value == null ? "" : String(value).trim();
      });
      return normalized;
    });
    const warnings = [];
    const errors = [];
    const settlementMap = new Map();
    let currentSettlementId = "";

    records.forEach((record) => {
      const id = String(get(record, "settlement-id") || currentSettlementId).trim();
      if (!id) return;
      if (isHeaderRow(record)) {
        currentSettlementId = id;
        settlementMap.set(id, {
          id,
          startDate: parseAmazonDate(get(record, "settlement-start-date")),
          endDate: parseAmazonDate(get(record, "settlement-end-date")),
          depositDate: parseAmazonDate(get(record, "deposit-date")),
          totalAmount: parseMoney(get(record, "total-amount")),
          currency: get(record, "currency") || "INR",
          rows: [],
        });
        return;
      }
      if (!settlementMap.has(id)) {
        settlementMap.set(id, {
          id,
          startDate: parseAmazonDate(get(record, "settlement-start-date")),
          endDate: parseAmazonDate(get(record, "settlement-end-date")),
          depositDate: parseAmazonDate(get(record, "deposit-date")),
          totalAmount: parseMoney(get(record, "total-amount")),
          currency: get(record, "currency") || "INR",
          rows: [],
        });
      }
      settlementMap.get(id).rows.push(record);
    });

    const allSettlements = Array.from(settlementMap.values())
      .filter((settlement) => settlement.rows.length || settlement.totalAmount)
      .map((settlement) => buildSettlement(records, settlement, config, warnings))
      .sort((a, b) => {
        const dateCompare = String(a.date || "").localeCompare(String(b.date || ""));
        if (dateCompare) return dateCompare;
        return String(a.id || "").localeCompare(String(b.id || ""), undefined, { numeric: true });
      });

    allSettlements.forEach((settlement) => {
      if (!settlement.totalAmount) {
        errors.push({
          settlementId: settlement.id,
          severity: "Error",
          message: "Settlement total amount is missing. Upload the complete settlement report header row.",
        });
      }
    });

    const settlements = allSettlements.filter((settlement) => isDateWithinFilter(settlement.date, config));
    const includedIds = new Set(settlements.map((settlement) => settlement.id));
    const filteredWarnings = warnings.filter((warning) => !warning.settlementId || includedIds.has(warning.settlementId));
    const filteredErrors = errors.filter((error) => !error.settlementId || includedIds.has(error.settlementId));

    return { config, records, settlements, errors: filteredErrors, warnings: filteredWarnings };
  }

  function billAllocationsXml(bills, billType, indent) {
    return bills.flatMap((bill) => [
      `${" ".repeat(indent)}<BILLALLOCATIONS.LIST>`,
      xmlTag("NAME", bill.name, indent + 2),
      xmlTag("BILLTYPE", billType, indent + 2),
      xmlTag("TDSDEDUCTEEISSPECIALRATE", "No", indent + 2),
      xmlTag("AMOUNT", formatAmount(bill.amount), indent + 2),
      `${" ".repeat(indent)}</BILLALLOCATIONS.LIST>`,
    ]);
  }

  function ledgerEntryXml(name, amount, isDeemedPositive, bills, indent, isPartyLedger = false, billType = "") {
    if (!round2(amount)) return [];
    return [
      `${" ".repeat(indent)}<ALLLEDGERENTRIES.LIST>`,
      `${" ".repeat(indent + 2)}<OLDAUDITENTRYIDS.LIST TYPE="Number">`,
      xmlTag("OLDAUDITENTRYIDS", "-1", indent + 4),
      `${" ".repeat(indent + 2)}</OLDAUDITENTRYIDS.LIST>`,
      xmlTag("LEDGERNAME", name, indent + 2),
      xmlTag("GSTCLASS", "Not Applicable", indent + 2),
      xmlTag("GSTOVRDNTYPEOFSUPPLY", "Services", indent + 2),
      xmlTag("ISDEEMEDPOSITIVE", isDeemedPositive ? "Yes" : "No", indent + 2),
      xmlTag("LEDGERFROMITEM", "No", indent + 2),
      xmlTag("REMOVEZEROENTRIES", "No", indent + 2),
      xmlTag("ISPARTYLEDGER", isPartyLedger ? "Yes" : "No", indent + 2),
      xmlTag("ISLASTDEEMEDPOSITIVE", isDeemedPositive ? "Yes" : "No", indent + 2),
      xmlTag("AMOUNT", formatAmount(amount), indent + 2),
      ...(bills && bills.length ? billAllocationsXml(bills, billType || (isPartyLedger ? "New Ref" : "Agst Ref"), indent + 2) : []),
      `${" ".repeat(indent)}</ALLLEDGERENTRIES.LIST>`,
    ];
  }

  function addLedgerBucket(buckets, ledgerName, amount, bills, isPartyLedger = true) {
    if (!ledgerName || !round2(amount)) return;
    const existing = buckets.find((bucket) => bucket.ledgerName === ledgerName);
    if (existing) {
      existing.amount = round2(existing.amount + amount);
      existing.bills.push(...(bills || []));
      existing.isPartyLedger = existing.isPartyLedger || isPartyLedger;
    } else {
      buckets.push({
        ledgerName,
        amount: round2(amount),
        bills: [...(bills || [])],
        isPartyLedger,
      });
    }
  }

  function ledgerBucketXml(bucket, indent) {
    return ledgerEntryXml(
      bucket.ledgerName,
      bucket.amount,
      bucket.amount < 0,
      bucket.bills,
      indent,
      bucket.isPartyLedger,
      "Agst Ref"
    );
  }

  function sortLedgerBuckets(buckets, config) {
    const ledgerOrder = [config.feeLedgerBlrName, config.feeLedgerDelName, config.otherChargesLedgerName, config.reimbursementLedgerName];
    const rank = new Map();
    ledgerOrder.filter(Boolean).forEach((name) => {
      if (!rank.has(name)) rank.set(name, rank.size);
    });
    buckets.sort((a, b) => {
      if ((a.amount < 0) !== (b.amount < 0)) return a.amount < 0 ? -1 : 1;
      const aRank = rank.has(a.ledgerName) ? rank.get(a.ledgerName) : ledgerOrder.length;
      const bRank = rank.has(b.ledgerName) ? rank.get(b.ledgerName) : ledgerOrder.length;
      if (aRank !== bRank) return aRank - bRank;
      return a.ledgerName.localeCompare(b.ledgerName);
    });
  }

  function buildVoucherXml(settlement, config, index) {
    const voucherNumberStart = Number(config.settlementVoucherNumberStart);
    const voucherNo = Number.isFinite(voucherNumberStart) && voucherNumberStart > 0
      ? String(voucherNumberStart + index)
      : settlement.id;
    const lines = [
      '      <TALLYMESSAGE xmlns:UDF="TallyUDF">',
      `        <VOUCHER VCHTYPE="${xmlEscape(config.settlementVoucherType)}" ACTION="Create" OBJVIEW="Accounting Voucher View">`,
      "          <OLDAUDITENTRYIDS.LIST TYPE=\"Number\">",
      xmlTag("OLDAUDITENTRYIDS", "-1", 12),
      "          </OLDAUDITENTRYIDS.LIST>",
      xmlTag("DATE", settlement.date, 10),
      xmlTag("REFERENCEDATE", settlement.date, 10),
      xmlTag("VOUCHERTYPENAME", config.settlementVoucherType, 10),
      xmlTag("PARTYLEDGERNAME", config.settlementPartyLedgerName, 10),
      xmlTag("VOUCHERNUMBER", voucherNo, 10),
      xmlTag("REFERENCE", settlement.id, 10),
      xmlTag("PERSISTEDVIEW", "Accounting Voucher View", 10),
      xmlTag("VCHENTRYMODE", "As Voucher", 10),
      xmlTag("EFFECTIVEDATE", settlement.date, 10),
      xmlTag("ISINVOICE", "No", 10),
    ];

    lines.push(
      ...ledgerEntryXml(
        config.settlementPartyLedgerName,
        -settlement.totalAmount,
        true,
        [{ name: settlement.id, amount: -settlement.totalAmount }],
        10,
        true
      )
    );

    const blrTotal = settlement.blrBills.reduce((sum, bill) => round2(sum + bill.amount), 0);
    const delTotal = settlement.delBills.reduce((sum, bill) => round2(sum + bill.amount), 0);
    const otherTotal = settlement.otherChargeBills.reduce((sum, bill) => round2(sum + bill.amount), 0);
    const reimbursementTotal = settlement.reimbursementBills.reduce((sum, bill) => round2(sum + bill.amount), 0);
    const ledgerBuckets = [];
    addLedgerBucket(ledgerBuckets, config.feeLedgerBlrName, blrTotal, settlement.blrBills);
    addLedgerBucket(ledgerBuckets, config.feeLedgerDelName, delTotal, settlement.delBills);
    addLedgerBucket(ledgerBuckets, config.otherChargesLedgerName, otherTotal, settlement.otherChargeBills);
    addLedgerBucket(ledgerBuckets, config.reimbursementLedgerName, reimbursementTotal, settlement.reimbursementBills);
    sortLedgerBuckets(ledgerBuckets, config);
    ledgerBuckets.forEach((bucket) => lines.push(...ledgerBucketXml(bucket, 10)));
    lines.push(...ledgerEntryXml(config.tcsLedgerName, settlement.tcs, true, [], 10));
    lines.push(...ledgerEntryXml(config.tdsLedgerName, settlement.tds, true, [], 10));

    const salesEntries = [config.b2bPartyLedgerName, config.partyLedgerName]
      .filter((ledgerName, index, list) => ledgerName && list.indexOf(ledgerName) === index && settlement.salesByLedger.has(ledgerName))
      .map((ledgerName) => [ledgerName, settlement.salesByLedger.get(ledgerName)]);
    Array.from(settlement.salesByLedger.entries()).forEach(([ledgerName, amount]) => {
      if (!salesEntries.some(([existingLedger]) => existingLedger === ledgerName)) salesEntries.push([ledgerName, amount]);
    });

    salesEntries.forEach(([ledgerName, amount]) => {
      const bills = settlement.orderBills
        .filter((bill) => bill.ledgerName === ledgerName)
        .map((bill) => ({ name: bill.orderId, amount: bill.amount }));
      lines.push(...ledgerEntryXml(ledgerName, amount, false, bills, 10, true, "Agst Ref"));
    });

    const balance = round2(
      -settlement.totalAmount +
        blrTotal +
        delTotal +
        otherTotal +
        reimbursementTotal +
        settlement.tcs +
        settlement.tds +
        Array.from(settlement.salesByLedger.values()).reduce((sum, amount) => round2(sum + amount), 0)
    );
    if (Math.abs(balance) >= 0.01) {
      lines.push(...ledgerEntryXml(config.roundOffLedgerName, -balance, balance > 0, [], 10));
    }

    lines.push("        </VOUCHER>", "      </TALLYMESSAGE>");
    return lines;
  }

  function buildXml(settlements, configInput) {
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
      config.companyName ? `        <STATICVARIABLES>\n          <SVCURRENTCOMPANY>${xmlEscape(config.companyName)}</SVCURRENTCOMPANY>\n        </STATICVARIABLES>` : "",
      "      </REQUESTDESC>",
      "      <REQUESTDATA>",
    ].filter(Boolean);
    settlements.forEach((settlement, index) => lines.push(...buildVoucherXml(settlement, config, index)));
    lines.push("      </REQUESTDATA>", "    </IMPORTDATA>", "  </BODY>", "</ENVELOPE>");
    return `${lines.join("\n")}\n`;
  }

  function previewRows(settlements, config) {
    return settlements.map((settlement) => {
      const salesTotal = Array.from(settlement.salesByLedger.values()).reduce((sum, amount) => round2(sum + amount), 0);
      const feeTotal = [...settlement.blrBills, ...settlement.delBills, ...settlement.otherChargeBills].reduce((sum, bill) => round2(sum + bill.amount), 0);
      return {
        settlementId: settlement.id,
        date: displayTallyDate(settlement.date),
        payout: formatAmount(settlement.totalAmount),
        sales: formatAmount(salesTotal),
        fees: formatAmount(feeTotal),
        tcs: formatAmount(settlement.tcs),
        tds: formatAmount(settlement.tds),
        orders: settlement.orderBills.length,
        b2bSales: formatAmount(settlement.salesByLedger.get(config.b2bPartyLedgerName) || 0),
        b2cSales: formatAmount(settlement.salesByLedger.get(config.partyLedgerName) || 0),
      };
    });
  }

  function toCsv(rows, headers) {
    const escapeCell = (value) => {
      const text = String(value == null ? "" : value);
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return [headers.join(","), ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(","))].join("\n");
  }

  function buildReportCsv(errors, warnings) {
    return toCsv([...errors, ...warnings], ["settlementId", "severity", "message"]);
  }

  function convertRecords(records, configInput) {
    const analysis = analyze(records, configInput);
    const xml = analysis.errors.length ? "" : buildXml(analysis.settlements, analysis.config);
    const sortedDates = analysis.settlements.map((settlement) => settlement.date).filter(Boolean).sort();
    const minSettlementDate = sortedDates[0] || "";
    const maxSettlementDate = sortedDates[sortedDates.length - 1] || "";
    const settlementDateRange = minSettlementDate && maxSettlementDate
      ? `${displayTallyDate(minSettlementDate)} - ${displayTallyDate(maxSettlementDate)}`
      : "";
    return {
      ...analysis,
      errors: analysis.errors,
      warnings: analysis.warnings,
      summary: {
        settlementCount: analysis.settlements.length,
        totalPayout: analysis.settlements.reduce((sum, settlement) => round2(sum + settlement.totalAmount), 0),
        warningCount: analysis.warnings.length,
        errorCount: analysis.errors.length,
        minSettlementDate,
        maxSettlementDate,
        settlementDateRange,
      },
      xml,
      preview: previewRows(analysis.settlements, analysis.config),
      reportCsv: buildReportCsv(analysis.errors, analysis.warnings),
    };
  }

  function convertText(text, configInput) {
    return convertRecords(parseText(text).records, configInput);
  }

  return {
    DEFAULT_CONFIG,
    parseText,
    convertText,
    convertRecords,
    buildXml,
    formatAmount,
  };
});
