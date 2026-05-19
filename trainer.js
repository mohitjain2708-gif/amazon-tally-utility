(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./converter"));
  } else {
    root.AmazonTallyTrainer = factory(root.AmazonTallyConverter);
  }
})(typeof self !== "undefined" ? self : this, function (converter) {
  function decodeXml(value) {
    return String(value == null ? "" : value)
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#4;/g, "")
      .replace(/&amp;/g, "&")
      .trim();
  }

  function normalizeXmlText(text) {
    return String(text || "")
      .replace(/\u0000/g, "")
      .replace(/^[\uFEFF\uFFFD]+/, "");
  }

  function tag(block, name) {
    const match = String(block).match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
    return match ? decodeXml(match[1]) : "";
  }

  function tags(block, name) {
    return Array.from(String(block).matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "gi"))).map((match) =>
      decodeXml(match[1])
    );
  }

  function blocks(block, name) {
    return Array.from(String(block).matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${name}>`, "gi"))).map(
      (match) => match[0]
    );
  }

  function attr(block, name) {
    const match = String(block).match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
    return match ? decodeXml(match[1]) : "";
  }

  function parseMoney(value) {
    const amount = Number(String(value || "0").replace(/,/g, "").trim());
    return Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) / 100 : 0;
  }

  function normalizeKey(value) {
    return String(value || "")
      .trim()
      .replace(/\/A$/i, "")
      .toUpperCase();
  }

  function addCount(map, key, by = 1) {
    if (!key) return;
    map[key] = (map[key] || 0) + by;
  }

  function mostCommon(map, fallback = "") {
    return Object.entries(map).sort((a, b) => b[1] - a[1])[0]?.[0] || fallback;
  }

  function parseAmazonCsvs(csvTexts) {
    const records = [];
    csvTexts.forEach((text, fileIndex) => {
      const rows = converter.parseCSV(text);
      const parsed = converter.rowsToObjects(rows);
      parsed.records.forEach((record) => {
        record.__sourceFileIndex = fileIndex;
        records.push(record);
      });
    });
    return records;
  }

  function parseTallyVouchers(xmlText) {
    xmlText = normalizeXmlText(xmlText);
    const companyName = tag(xmlText, "SVCURRENTCOMPANY");
    const voucherBlocks = blocks(xmlText, "VOUCHER");

    const vouchers = voucherBlocks.map((voucherBlock) => {
      const inventory = blocks(voucherBlock, "ALLINVENTORYENTRIES.LIST").map((itemBlock) => {
        const accountingBlock = blocks(itemBlock, "ACCOUNTINGALLOCATIONS.LIST")[0] || "";
        const batchBlock = blocks(itemBlock, "BATCHALLOCATIONS.LIST")[0] || "";
        return {
          stockItemName: tag(itemBlock, "STOCKITEMNAME"),
          hsn: tag(itemBlock, "GSTHSNNAME"),
          rate: tag(itemBlock, "RATE"),
          amount: parseMoney(tag(itemBlock, "AMOUNT")),
          actualQty: tag(itemBlock, "ACTUALQTY"),
          billedQty: tag(itemBlock, "BILLEDQTY"),
          godownName: tag(batchBlock, "GODOWNNAME"),
          batchName: tag(batchBlock, "BATCHNAME"),
          salesLedger: tag(accountingBlock, "LEDGERNAME"),
        };
      });

      const ledgerEntries = blocks(voucherBlock, "LEDGERENTRIES.LIST").map((ledgerBlock) => ({
        ledgerName: tag(ledgerBlock, "LEDGERNAME"),
        amount: parseMoney(tag(ledgerBlock, "AMOUNT")),
        isPartyLedger: tag(ledgerBlock, "ISPARTYLEDGER"),
        isDeemedPositive: tag(ledgerBlock, "ISDEEMEDPOSITIVE"),
      }));

      return {
        voucherType: attr(voucherBlock, "VCHTYPE") || tag(voucherBlock, "VOUCHERTYPENAME"),
        voucherNumber: tag(voucherBlock, "VOUCHERNUMBER"),
        reference: tag(voucherBlock, "REFERENCE"),
        date: tag(voucherBlock, "DATE"),
        partyLedger: tag(voucherBlock, "PARTYLEDGERNAME"),
        partyName: tag(voucherBlock, "PARTYNAME"),
        partyGstin: tag(voucherBlock, "PARTYGSTIN"),
        gstRegistrationType: tag(voucherBlock, "GSTREGISTRATIONTYPE"),
        placeOfSupply: tag(voucherBlock, "PLACEOFSUPPLY"),
        persistedView: tag(voucherBlock, "PERSISTEDVIEW"),
        entryMode: tag(voucherBlock, "VCHENTRYMODE"),
        companyGstin: tag(voucherBlock, "CMPGSTIN"),
        companyGstState: tag(voucherBlock, "CMPGSTSTATE"),
        gstRegistrationName: tag(voucherBlock, "GSTREGISTRATION"),
        buyerName: tag(voucherBlock, "BASICBUYERNAME"),
        billAddress: tags(voucherBlock, "BASICBUYERADDRESS"),
        shipAddress: tags(voucherBlock, "CONSIGNEEADDRESS"),
        inventory,
        ledgerEntries,
      };
    });

    return { companyName, vouchers };
  }

  function indexTallyVouchers(vouchers) {
    const byInvoice = new Map();
    const byOrder = new Map();
    vouchers.forEach((voucher) => {
      byInvoice.set(normalizeKey(voucher.voucherNumber), voucher);
      if (voucher.reference) byOrder.set(String(voucher.reference).trim(), voucher);
    });
    return { byInvoice, byOrder };
  }

  function findTallyVoucher(record, tallyIndex) {
    const invoiceNo = normalizeKey(record["Invoice Number"]);
    const orderId = String(record["Order Id"] || "").trim();
    return tallyIndex.byInvoice.get(invoiceNo) || tallyIndex.byOrder.get(orderId) || null;
  }

  function isB2b(record) {
    return Boolean(
      String(record["Buyer Name"] || "").trim() ||
        String(record["Customer Bill To Gstid"] || "").trim() ||
        String(record["Customer Ship To Gstid"] || "").trim()
    );
  }

  function inferGodownPattern(warehouseId, godownName) {
    if (!warehouseId || !godownName) return "";
    return godownName.includes(warehouseId) ? godownName.replace(warehouseId, "{warehouse}") : "";
  }

  function analyzeMappings(csvTexts, tallyXmlText) {
    const amazonRecords = parseAmazonCsvs(csvTexts);
    const tally = parseTallyVouchers(tallyXmlText);
    const salesVouchers = tally.vouchers.filter((voucher) => /Sales\s*-\s*Amazon/i.test(voucher.voucherType));
    const tallyIndex = indexTallyVouchers(salesVouchers);

    const learned = {
      companyName: tally.companyName,
      voucherTypeCounts: {},
      refundVoucherTypeCounts: {},
      persistedViewCounts: {},
      invoiceSuffixCounts: {},
      b2bPartyLedgerCounts: {},
      b2cPartyLedgerCounts: {},
      salesLedgerCounts: {},
      cgstLedgerCounts: {},
      sgstLedgerCounts: {},
      igstLedgerCounts: {},
      unitCounts: {},
      godownPatternCounts: {},
      godownByWarehouse: {},
      itemMappingCounts: {},
      asinMappingCounts: {},
      descriptionMappingCounts: {},
      invoiceNumberRuleCounts: {},
      referenceRuleCounts: {},
    };

    const matches = [];
    const unmatchedAmazon = [];
    const shipmentRecords = amazonRecords.filter((record) => record["Transaction Type"] === "Shipment" && record["Invoice Number"]);
    const refundRecords = amazonRecords.filter((record) => record["Transaction Type"] === "Refund");
    const refundCreditNoteNos = [...new Set(refundRecords.map((record) => record["Credit Note No"]).filter(Boolean))];
    const refundVoucherNoSet = new Set(refundCreditNoteNos);
    const refundVouchers = tally.vouchers.filter(
      (voucher) =>
        /Credit\s*Note/i.test(voucher.voucherType || "") ||
        refundVoucherNoSet.has(voucher.voucherNumber) ||
        refundVoucherNoSet.has(voucher.reference)
    );
    refundVouchers.forEach((voucher) => addCount(learned.refundVoucherTypeCounts, voucher.voucherType));
    const tallyTextIndex = tally.vouchers
      .map((voucher) => [voucher.voucherNumber, voucher.reference].filter(Boolean).join(" "))
      .join("\n");
    const refundCreditNotesFound = refundCreditNoteNos.filter((creditNoteNo) => tallyTextIndex.includes(creditNoteNo));

    shipmentRecords.forEach((record) => {
      const voucher = findTallyVoucher(record, tallyIndex);
      if (!voucher) {
        unmatchedAmazon.push({
          invoiceNo: record["Invoice Number"],
          orderId: record["Order Id"],
          sku: record.Sku,
          amount: record["Invoice Amount"],
        });
        return;
      }

      const tallyItem = voucher.inventory[0] || {};
      const b2b = isB2b(record);
      const invoiceNo = String(record["Invoice Number"] || "").trim();
      const suffix = voucher.voucherNumber.startsWith(invoiceNo) ? voucher.voucherNumber.slice(invoiceNo.length) : "";
      const suffixKey = suffix || "__NO_SUFFIX__";
      const warehouseId = String(record["Warehouse Id"] || "").trim();
      const sku = String(record.Sku || "").trim();
      const asin = String(record.Asin || "").trim();
      const description = String(record["Item Description"] || "").trim();

      addCount(learned.voucherTypeCounts, voucher.voucherType);
      addCount(learned.persistedViewCounts, voucher.persistedView);
      addCount(learned.invoiceSuffixCounts, suffixKey);
      if (voucher.voucherNumber === invoiceNo) addCount(learned.invoiceNumberRuleCounts, "voucher_number = amazon_invoice_number");
      if (voucher.reference === String(record["Order Id"] || "").trim()) addCount(learned.referenceRuleCounts, "reference = amazon_order_id");
      addCount(b2b ? learned.b2bPartyLedgerCounts : learned.b2cPartyLedgerCounts, voucher.partyLedger);
      addCount(learned.salesLedgerCounts, tallyItem.salesLedger);

      const unitMatch = String(tallyItem.billedQty || tallyItem.actualQty || "").match(/[A-Za-z]+$/);
      addCount(learned.unitCounts, unitMatch ? unitMatch[0] : "");

      const godownPattern = inferGodownPattern(warehouseId, tallyItem.godownName);
      addCount(learned.godownPatternCounts, godownPattern);
      if (warehouseId && tallyItem.godownName) learned.godownByWarehouse[warehouseId] = tallyItem.godownName;

      if (sku && tallyItem.stockItemName) addCount(learned.itemMappingCounts, `${sku}=>${tallyItem.stockItemName}`);
      if (asin && tallyItem.stockItemName) addCount(learned.asinMappingCounts, `${asin}=>${tallyItem.stockItemName}`);
      if (description && tallyItem.stockItemName) addCount(learned.descriptionMappingCounts, `${description}=>${tallyItem.stockItemName}`);

      const taxLedgerNames = voucher.ledgerEntries
        .filter((ledger) => ledger.ledgerName && ledger.ledgerName !== voucher.partyLedger && ledger.amount > 0)
        .map((ledger) => ledger.ledgerName);
      if (parseMoney(record["Cgst Tax"]) > 0) addCount(learned.cgstLedgerCounts, taxLedgerNames[0] || "");
      if (parseMoney(record["Sgst Tax"]) > 0) addCount(learned.sgstLedgerCounts, taxLedgerNames[1] || taxLedgerNames[0] || "");
      if (parseMoney(record["Igst Tax"]) > 0) addCount(learned.igstLedgerCounts, taxLedgerNames[0] || "");

      matches.push({
        invoiceNo,
        orderId: record["Order Id"],
        amazonSku: sku,
        amazonAsin: asin,
        amazonDescription: description,
        tallyVoucherNo: voucher.voucherNumber,
        tallyPartyLedger: voucher.partyLedger,
        tallyItemName: tallyItem.stockItemName || "",
        tallySalesLedger: tallyItem.salesLedger || "",
        tallyGodown: tallyItem.godownName || "",
        isB2b: b2b,
      });
    });

    const itemMappings = {};
    Object.entries(learned.itemMappingCounts).forEach(([pair]) => {
      const [source, target] = pair.split("=>");
      if (source && target && !itemMappings[source]) itemMappings[source] = target;
    });

    const asinMappings = {};
    Object.entries(learned.asinMappingCounts).forEach(([pair]) => {
      const [source, target] = pair.split("=>");
      if (source && target && !asinMappings[source]) asinMappings[source] = target;
    });

    const config = {
      companyName: tally.companyName || converter.DEFAULT_CONFIG.companyName,
      voucherType: mostCommon(learned.voucherTypeCounts, converter.DEFAULT_CONFIG.voucherType),
      refundVoucherType: mostCommon(learned.refundVoucherTypeCounts, converter.DEFAULT_CONFIG.refundVoucherType),
      invoiceNumberRule: mostCommon(learned.invoiceNumberRuleCounts, "voucher_number = amazon_invoice_number"),
      referenceRule: mostCommon(learned.referenceRuleCounts, "reference = amazon_order_id"),
      invoiceSuffix:
        mostCommon(learned.invoiceSuffixCounts, converter.DEFAULT_CONFIG.invoiceSuffix) === "__NO_SUFFIX__"
          ? ""
          : mostCommon(learned.invoiceSuffixCounts, converter.DEFAULT_CONFIG.invoiceSuffix),
      partyLedgerMode: "auto",
      b2bPartyLedgerName: mostCommon(learned.b2bPartyLedgerCounts, converter.DEFAULT_CONFIG.b2bPartyLedgerName),
      partyLedgerName: mostCommon(learned.b2cPartyLedgerCounts, converter.DEFAULT_CONFIG.partyLedgerName),
      salesLedgerName: mostCommon(learned.salesLedgerCounts, converter.DEFAULT_CONFIG.salesLedgerName),
      cgstLedgerName: mostCommon(learned.cgstLedgerCounts, converter.DEFAULT_CONFIG.cgstLedgerName),
      sgstLedgerName: mostCommon(learned.sgstLedgerCounts, converter.DEFAULT_CONFIG.sgstLedgerName),
      igstLedgerName: mostCommon(learned.igstLedgerCounts, converter.DEFAULT_CONFIG.igstLedgerName),
      unitName: mostCommon(learned.unitCounts, converter.DEFAULT_CONFIG.unitName),
      stockNameMode: "sku",
      stockMap: { ...asinMappings, ...itemMappings },
      stockMapText: Object.entries({ ...asinMappings, ...itemMappings })
        .map(([key, value]) => `${key} = ${value}`)
        .join("\n"),
      godownPattern: mostCommon(learned.godownPatternCounts, converter.DEFAULT_CONFIG.godownPattern),
      godownByWarehouse: learned.godownByWarehouse,
    };

    return {
      summary: {
        amazonRows: amazonRecords.length,
        amazonShipmentRows: shipmentRecords.length,
        amazonRefundRows: refundRecords.length,
        refundCreditNotesInAmazon: refundCreditNoteNos.length,
        refundCreditNotesFoundInTally: refundCreditNotesFound.length,
        tallyRefundVouchers: refundVouchers.length,
        tallySalesVouchers: salesVouchers.length,
        matchedRows: matches.length,
        unmatchedAmazonRows: unmatchedAmazon.length,
        learnedItemMappings: Object.keys(config.stockMap).length,
      },
      config,
      matches,
      unmatchedAmazon,
      refundDiagnostics: {
        refundRows: refundRecords.length,
        creditNoteNumbers: refundCreditNoteNos,
        creditNoteNumbersFoundInTally: refundCreditNotesFound,
        learned: refundCreditNotesFound.length > 0,
      },
      diagnostics: learned,
    };
  }

  return {
    analyzeMappings,
    parseTallyVouchers,
    parseAmazonCsvs,
  };
});
