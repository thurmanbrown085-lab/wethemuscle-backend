const Tesseract = require('tesseract.js');

async function extractTextAndNumbers(imageBuffer) {
  try {
    const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng');
    const cleanText = text.trim();

    const numbersOnly = cleanText.match(/\b\d+(?:\.\d+)?\b/g) || [];
    const alphanumericCodes = cleanText.match(/\b[A-Z0-9-]{4,}\b/gi) || [];

    return {
      rawText: cleanText,
      numbers: numbersOnly,
      codes: alphanumericCodes
    };
  } catch (error) {
    console.error('OCR Extraction Error:', error);
    throw new Error('Failed to extract text from image');
  }
}

module.exports = { extractTextAndNumbers };
