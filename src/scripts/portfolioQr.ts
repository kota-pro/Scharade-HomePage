import QRCode from "qrcode";

// Loaded only when the share dialog is opened; no external QR service is used.
export async function createPortfolioQr(url: string): Promise<Blob> {
  const canvas = document.createElement("canvas");
  await QRCode.toCanvas(canvas, url, {
    errorCorrectionLevel: "H",
    margin: 4,
    width: 1024,
    color: { dark: "#000000ff", light: "#ffffffff" },
  });
  const logo = new Image();
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      logo.src = "";
      reject(new Error("Logo load timed out"));
    }, 15000);
    logo.onload = () => { clearTimeout(timeout); resolve(); };
    logo.onerror = () => { clearTimeout(timeout); reject(new Error("Logo load failed")); };
    logo.src = "/icons/logo.svg";
  });
  const context = canvas.getContext("2d")!;
  // Small white backing + high error correction keep the center logo scannable.
  const plate = Math.round(canvas.width * 0.18);
  const left = Math.floor((canvas.width - plate) / 2);
  context.fillStyle = "#fff";
  context.fillRect(left, left, plate, plate);
  const width = plate * 0.8;
  const height = width * 430.02 / 573.87;
  context.drawImage(logo, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  return new Promise((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error("PNG generation failed")), "image/png",
  ));
}
