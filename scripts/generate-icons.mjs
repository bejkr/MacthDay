// Vygeneruje PNG ikony PWA z public/icons/icon.svg.  Spustenie: npm run icons
import sharp from "sharp";
import { readFile } from "node:fs/promises";

const svg = await readFile("public/icons/icon.svg");
const out = (name) => `public/icons/${name}`;

await sharp(svg, { density: 300 }).resize(192, 192).png().toFile(out("icon-192.png"));
await sharp(svg, { density: 300 }).resize(512, 512).png().toFile(out("icon-512.png"));
await sharp(svg, { density: 300 }).resize(180, 180).flatten({ background: "#0B0E0D" }).png().toFile(out("apple-touch-icon.png"));

// Maskable: motív zmenšený do bezpečnej zóny, pozadie až po okraj.
const inner = await sharp(svg, { density: 300 }).resize(400, 400).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#0B0E0D" } })
  .composite([{ input: inner, gravity: "center" }])
  .png()
  .toFile(out("icon-maskable-512.png"));

await sharp(svg, { density: 300 }).resize(48, 48).png().toFile("src/app/icon.png");
console.log("Ikony vygenerované.");
