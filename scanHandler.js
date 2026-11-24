const crypto = require("crypto");
const { extractTextAndNumbers } = require("./ocrExtractor");

async function decodeOptical(buf) {
  let barcode = null;
  try {
    const { Jimp } = require("jimp");
    const {
      MultiFormatReader,
      BarcodeFormat,
      DecodeHintType,
      RGBLuminanceSource,
      BinaryBitmap,
      HybridBinarizer
    } = require("@zxing/library");

    const img = await Jimp.read(buf);
    const { width: w, height: h, data } = img.bitmap;
    const lum = new Uint8ClampedArray(w * h);
    for (let i = 0; i < w * h; i++) {
      lum[i] = ((data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3) | 0;
    }

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.QR_CODE,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E
    ]);

    const r = new MultiFormatReader();
    r.setHints(hints);
    const code = r
      .decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, w, h))))
      .getText()
      .trim();
    if (code) barcode = code;
  } catch (_) {}

  // Always run OCR to automatically extract text, numbers, and codes from the image
  let ocr = { rawText: "", numbers: [], codes: [] };
  try {
    ocr = await extractTextAndNumbers(buf);
  } catch (_) {}

  const decoded =
    barcode ||
    (ocr.codes[0] ? ocr.codes[0].toUpperCase() : null) ||
    ocr.rawText.slice(0, 48) ||
    "UNREADABLE-SKU";

  return {
    decoded,
    rawText: ocr.rawText || barcode || "",
    numbers: ocr.numbers,
    codes: ocr.codes,
    scanMode: barcode && ocr.rawText ? "HYBRID_BARCODE_OCR" : barcode ? "QR_BARCODE" : "OCR_TEXT"
  };
}

async function handleScanUpload(req, res, { handleWebRequest, saveRec }) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No photo uploaded" });
    }

    const { decoded, rawText, numbers, codes, scanMode } = await decodeOptical(req.file.buffer);
    let itemId = decoded;
    let qty = 1;
    let amount = 0;
    let rm = "COUPA_AUTO_ORDER";

    // Check URL/Query params if barcode/text contains structured data
    try {
      const u = decoded.startsWith("http") ? new URL(decoded) : new URL("https://wtm.local?" + decoded);
      if (u.searchParams.get("item_id") || u.searchParams.get("sku")) {
        itemId = u.searchParams.get("item_id") || u.searchParams.get("sku");
        qty = parseInt(u.searchParams.get("qty") || "1", 10) || 1;
        amount = parseFloat(u.searchParams.get("amount") || "0") || 0;
        rm = u.searchParams.get("routing_matrix") || rm;
      }
    } catch (_) {}

    // Auto-detect dollar/decimal amount from OCR numbers if not explicitly set
    if (!amount && numbers.length > 0) {
      const decimalMatch = numbers.find((n) => n.includes("."));
      amount = parseFloat(decimalMatch || numbers[0]) || 0;
    }

    const txId = "scan-" + crypto.randomUUID();
    const slUrl =
      "http://localhost/api/transmissions/smartlink?routing_matrix=" +
      encodeURIComponent(rm) +
      "&transmission_id=" +
      encodeURIComponent(txId) +
      "&item_id=" +
      encodeURIComponent(itemId) +
      "&qty=" +
      qty +
      "&amount=" +
      amount;

    const slRes = await handleWebRequest(
      new Request(slUrl, { method: "GET", headers: { "x-idempotency-key": txId } })
    );
    const smartlink = await slRes.json();

    const rec = {
      id: txId,
      ingestedAt: new Date().toISOString(),
      category: scanMode,
      reference: itemId,
      poNumber: req.body?.poNumber || codes[0] || "AUTO-SCAN",
      party: "OPTICAL_SMARTLINK_BRIDGE",
      terms: "Instant",
      grossAmount: amount,
      totalFees: 0,
      netCapital: amount
    };
    await saveRec(rec);

    return res.status(200).json({
      success: true,
      scanMode,
      extractedSku: itemId,
      rawDecoded: decoded,
      rawText,
      extractedNumbers: numbers,
      extractedCodes: codes,
      detectedAmount: amount,
      smartlink,
      record: rec
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

module.exports = { handleScanUpload };
