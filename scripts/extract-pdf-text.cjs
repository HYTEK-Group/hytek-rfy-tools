const { PDFParse } = require("pdf-parse");
const fs = require("fs");

(async () => {
  try {
    const data = fs.readFileSync(process.argv[2]);
    const parser = new PDFParse({ data });
    const result = await parser.getText();
    console.log("=== METADATA ===");
    console.log("pages:", result.pages?.length ?? "unknown");
    console.log("chars:", (result.text ?? "").length);
    console.log("=== TEXT ===");
    console.log(result.text);
  } catch (e) {
    console.error("ERR:", e.message);
    process.exit(1);
  }
})();
