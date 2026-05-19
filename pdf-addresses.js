(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(root);
  } else {
    root.AmazonTallyPdfAddresses = factory(root);
  }
})(typeof self !== "undefined" ? self : this, function (root) {
  function cleanText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/\n\s+/g, "\n")
      .trim();
  }

  function compact(value) {
    return cleanText(value).replace(/\s+/g, " ").trim();
  }

  function normalizeKey(value) {
    return String(value || "").trim().toUpperCase();
  }

  function tagValue(text, pattern) {
    const match = compact(text).match(pattern);
    return match ? match[1].trim() : "";
  }

  function normalizeAddressLines(block) {
    const lines = cleanText(block)
      .split(/\n+/)
      .map((line) => compact(line))
      .filter(Boolean)
      .filter((line) => !/^Dynamic QR Code:?$/i.test(line));
    return lines;
  }

  function extractBlock(text, startLabel, endLabel) {
    const normalized = cleanText(text);
    const start = normalized.search(new RegExp(`${startLabel}\\s*:?`, "i"));
    if (start < 0) return [];
    const afterStart = normalized.slice(start).replace(new RegExp(`^[\\s\\S]*?${startLabel}\\s*:?\\s*`, "i"), "");
    const end = afterStart.search(new RegExp(`${endLabel}\\s*:?`, "i"));
    const block = end >= 0 ? afterStart.slice(0, end) : afterStart;
    return normalizeAddressLines(block);
  }

  function stateCodeFrom(lines) {
    const text = lines.join(" ");
    const match = text.match(/State\/UT\s+Code\s*:?\s*([0-9]{2})/i);
    return match ? match[1] : "";
  }

  function gstinFrom(lines) {
    const text = lines.join(" ");
    const match = text.match(/GST\s+Registration\s+No\s*:?\s*([0-9A-Z]{15})/i);
    return match ? match[1] : "";
  }

  function pinFrom(lines) {
    const text = lines.join(" ");
    const match = text.match(/\b([1-9][0-9]{5})\b(?!.*\b[1-9][0-9]{5}\b)/);
    return match ? match[1] : "";
  }

  function stripTrailingPlaceLabel(value) {
    return compact(value).replace(/\s+Place\s+of\s+(delivery|supply).*$/i, "").trim();
  }

  function parseInvoiceText(text, fileName) {
    const invoiceFromFile = String(fileName || "").split("_", 1)[0] || "";
    const invoiceNo = tagValue(text, /Invoice\s+Number\s*:?\s*([A-Z0-9-]+)/i) || invoiceFromFile;
    const orderId = tagValue(text, /Order\s+Number\s*:?\s*([0-9-]+)/i);
    const invoiceDate = tagValue(text, /Invoice\s+Date\s*:?\s*([0-9.]+)/i);
    const orderDate = tagValue(text, /Order\s+Date\s*:?\s*([0-9.]+)/i);
    const billingAddressLines = extractBlock(text, "Billing Address", "Shipping Address");
    const shippingAddressLines = extractBlock(text, "Shipping Address", "Place of supply");
    const placeOfSupply = stripTrailingPlaceLabel(tagValue(text, /Place\s+of\s+supply\s*:?\s*([A-Z ]+(?:\s+Place\s+of\s+delivery)?)/i));
    const placeOfDelivery = stripTrailingPlaceLabel(tagValue(text, /Place\s+of\s+delivery\s*:?\s*([A-Z ]+)/i));

    return {
      fileName,
      invoiceNo,
      orderId,
      invoiceDate,
      orderDate,
      billingAddressLines,
      shippingAddressLines,
      billingName: billingAddressLines[0] || "",
      shippingName: shippingAddressLines[0] || "",
      billingGstin: gstinFrom(billingAddressLines),
      shippingGstin: gstinFrom(shippingAddressLines),
      billingPostalCode: pinFrom(billingAddressLines),
      shippingPostalCode: pinFrom(shippingAddressLines),
      billingStateCode: stateCodeFrom(billingAddressLines),
      shippingStateCode: stateCodeFrom(shippingAddressLines),
      placeOfSupply,
      placeOfDelivery,
      hasBillingAddress: billingAddressLines.length > 0,
      hasShippingAddress: shippingAddressLines.length > 0,
    };
  }

  function linesFromTextContent(textContent) {
    const rows = [];
    (textContent.items || []).forEach((item) => {
      const value = String(item.str || "").trim();
      if (!value) return;
      const y = item.transform && Number.isFinite(item.transform[5]) ? Math.round(item.transform[5]) : rows.length;
      const x = item.transform && Number.isFinite(item.transform[4]) ? item.transform[4] : 0;
      let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2);
      if (!row) {
        row = { y, parts: [] };
        rows.push(row);
      }
      row.parts.push({ x, value });
    });
    return rows
      .sort((a, b) => b.y - a.y)
      .map((row) =>
        row.parts
          .sort((a, b) => a.x - b.x)
          .map((part) => part.value)
          .join(" ")
      )
      .join("\n");
  }

  async function extractPdfText(arrayBuffer) {
    if (!root.pdfjsLib) throw new Error("PDF parser library is not loaded.");
    const document = await root.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];
    for (let pageNo = 1; pageNo <= document.numPages; pageNo += 1) {
      const page = await document.getPage(pageNo);
      const textContent = await page.getTextContent();
      pages.push(linesFromTextContent(textContent));
    }
    return pages.join("\n");
  }

  function buildIndex(records) {
    const byInvoice = {};
    const byOrder = {};
    records.forEach((record) => {
      if (record.invoiceNo) byInvoice[normalizeKey(record.invoiceNo)] = record;
      if (record.orderId) {
        const key = normalizeKey(record.orderId);
        if (!byOrder[key]) byOrder[key] = [];
        byOrder[key].push(record);
      }
    });
    return { byInvoice, byOrder, records };
  }

  async function extractFromZipFiles(files, onProgress) {
    if (!root.JSZip) throw new Error("ZIP parser library is not loaded.");
    if (root.pdfjsLib && root.pdfjsLib.GlobalWorkerOptions) {
      root.pdfjsLib.GlobalWorkerOptions.workerSrc =
        root.pdfjsLib.GlobalWorkerOptions.workerSrc ||
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    }

    const allEntries = [];
    const records = [];
    const errors = [];
    const zipFiles = Array.from(files || []);

    for (const file of zipFiles) {
      const zip = await root.JSZip.loadAsync(await file.arrayBuffer());
      Object.values(zip.files).forEach((entry) => {
        if (!entry.dir && /\.pdf$/i.test(entry.name)) allEntries.push({ file, entry });
      });
    }

    let processed = 0;
    for (const { entry } of allEntries) {
      try {
        const data = await entry.async("arraybuffer");
        const text = await extractPdfText(data);
        records.push(parseInvoiceText(text, entry.name.split(/[\\/]/).pop()));
      } catch (error) {
        errors.push({ fileName: entry.name, message: error.message });
      }
      processed += 1;
      if (onProgress) onProgress({ processed, total: allEntries.length });
    }

    const missingAddressCount = records.filter((record) => !record.hasBillingAddress || !record.hasShippingAddress).length;
    return {
      ...buildIndex(records),
      summary: {
        zipCount: zipFiles.length,
        pdfCount: allEntries.length,
        parsedPdfCount: records.length,
        errorCount: errors.length,
        missingAddressCount,
      },
      errors,
    };
  }

  return {
    parseInvoiceText,
    extractFromZipFiles,
    buildIndex,
  };
});
