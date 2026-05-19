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

  function looksLikeSellerOrFooterLine(line) {
    return [
      /^GST\s+Registration\s+No\s*:\s*[0-9A-Z]{15}\s*$/i,
      /^State\/UT\s+Code\s*:/i,
      /^Place\s+of\s+(supply|delivery)\s*:/i,
      /^Order\s+(No|Number)\s*:/i,
      /^Invoice\s+(Number|Date|Details)\s*:/i,
      /^Credit\s+Note\s+(No|Date)\s*:/i,
      /^Original\s+(Invoice|Order)\s+/i,
      /^Sl\.?\s*Tax/i,
      /^Description\s+Unit\s+Price/i,
      /^No\s+Rate\s+Type\s+Amount/i,
      /^\d+\s+.+\s+[A-Z0-9-]{8,}/i,
      /^HSN\s*:/i,
      /^TOTAL\s*:/i,
      /^Amount\s+in\s+Words\s*:/i,
      /^For\s+Mangal\s+Maitri\s+Multitrade\s+LLP/i,
      /^Authorized\s+Signatory/i,
      /^\*?ASSPL-/i,
      /^Customers\s+desirous/i,
      /^Please\s+note\s+that/i,
      /^Page\s+\d+\s+of\s+\d+/i,
      /^PAN\s+No\s*:/i,
      /^IN\s+State\/UT\s+Code\s*:/i,
      /^Mangal\s+Maitri\s+Multitrade\s+LLP\b/i,
      /^\*?\s*LIMITED\s*$/i,
      /PRIVATE\s*$/i,
    ].some((pattern) => pattern.test(line));
  }

  function looksLikeAddressBlockEnd(line) {
    return [
      /^Place\s+of\s+(supply|delivery)\s*:/i,
      /^Order\s+(No|Number)\s*:/i,
      /^Invoice\s+(Number|Date|Details)\s*:/i,
      /^Credit\s+Note\s+(No|Date)\s*:/i,
      /^Original\s+(Invoice|Order)\s+/i,
      /^Sl\.?\s*Tax/i,
      /^Description\s+Unit\s+Price/i,
      /^No\s+Rate\s+Type\s+Amount/i,
      /^\d+\s+\S+/,
      /^HSN\s*:/i,
      /^TOTAL\s*:/i,
      /^Amount\s+in\s+Words\s*:/i,
      /^For\s+Mangal\s+Maitri\s+Multitrade\s+LLP/i,
      /^Authorized\s+Signatory/i,
      /^\*?ASSPL-/i,
      /^Customers\s+desirous/i,
      /^Please\s+note\s+that/i,
      /^Page\s+\d+\s+of\s+\d+/i,
    ].some((pattern) => pattern.test(line));
  }

  function removeSellerPrefix(line) {
    return compact(line).replace(/^Mangal\s+Maitri\s+Multitrade\s+LLP\s+/i, "").trim();
  }

  function cleanAddressLines(lines) {
    const cleaned = [];
    const seen = new Set();

    for (const rawLine of lines || []) {
      let line = removeSellerPrefix(rawLine);
      line = line.replace(/^GST\s+Registration\s+No\s*:\s*[0-9A-Z]{15}\s*/i, "").trim();
      if (looksLikeAddressBlockEnd(line)) {
        if (cleaned.length) break;
        continue;
      }
      if (!line || looksLikeSellerOrFooterLine(line)) continue;
      line = line.replace(/\s+/g, " ").trim();
      if (!line) continue;

      const normalized = line.toUpperCase();
      if (normalized === "INDIA") line = "IN";
      if (normalized === "IN" && cleaned[cleaned.length - 1] === "IN") continue;
      if (seen.has(normalized)) continue;

      seen.add(normalized);
      cleaned.push(line);
      if (cleaned.length >= 7) break;
    }

    return cleaned;
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
    const rawBillingAddressLines = extractBlock(text, "Billing Address", "Shipping Address");
    const rawShippingAddressLines = extractBlock(text, "Shipping Address", "Place of supply");
    const billingAddressLines = cleanAddressLines(rawBillingAddressLines);
    const shippingAddressLines = cleanAddressLines(rawShippingAddressLines);
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
      billingGstin: gstinFrom(rawBillingAddressLines),
      shippingGstin: gstinFrom(rawShippingAddressLines),
      billingPostalCode: pinFrom(billingAddressLines),
      shippingPostalCode: pinFrom(shippingAddressLines),
      billingStateCode: stateCodeFrom(rawBillingAddressLines),
      shippingStateCode: stateCodeFrom(rawShippingAddressLines),
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
    if (root.pdfjsLib && root.pdfjsLib.GlobalWorkerOptions) {
      root.pdfjsLib.GlobalWorkerOptions.workerSrc =
        root.pdfjsLib.GlobalWorkerOptions.workerSrc ||
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    }

    const allEntries = [];
    const records = [];
    const errors = [];
    const selectedFiles = Array.from(files || []);
    const zipFiles = selectedFiles.filter((file) => /\.zip$/i.test(file.name));
    const directPdfFiles = selectedFiles.filter((file) => /\.pdf$/i.test(file.name));

    for (const file of zipFiles) {
      if (!root.JSZip) throw new Error("ZIP parser library is not loaded.");
      const zip = await root.JSZip.loadAsync(await file.arrayBuffer());
      Object.values(zip.files).forEach((entry) => {
        if (!entry.dir && /\.pdf$/i.test(entry.name)) {
          allEntries.push({
            sourceFile: file.name,
            fileName: entry.name,
            readArrayBuffer: () => entry.async("arraybuffer"),
          });
        }
      });
    }

    directPdfFiles.forEach((file) => {
      allEntries.push({
        sourceFile: file.name,
        fileName: file.name,
        readArrayBuffer: () => file.arrayBuffer(),
      });
    });

    let processed = 0;
    for (const entry of allEntries) {
      try {
        const data = await entry.readArrayBuffer();
        const text = await extractPdfText(data);
        records.push(parseInvoiceText(text, entry.fileName.split(/[\\/]/).pop()));
      } catch (error) {
        errors.push({ fileName: entry.fileName, message: error.message });
      }
      processed += 1;
      if (onProgress) onProgress({ processed, total: allEntries.length });
    }

    const missingAddressCount = records.filter((record) => !record.hasBillingAddress || !record.hasShippingAddress).length;
    return {
      ...buildIndex(records),
      summary: {
        zipCount: zipFiles.length,
        directPdfCount: directPdfFiles.length,
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
