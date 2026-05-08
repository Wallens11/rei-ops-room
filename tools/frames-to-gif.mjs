/**
 * frames-to-gif.mjs — assemble PNG frames → animated GIF.
 *
 * Pure Node.js GIF89a encoder with LZW compression.
 * Uses sharp (from sibling workspace) to resize and quantize frames to 256 colors.
 *
 * Usage:
 *   node tools/frames-to-gif.mjs [--fps 2] [--width 960] [--out public/demo.gif]
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

// ── CLI args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const FPS    = Number(getArg("--fps", "1.5"));
const WIDTH  = Number(getArg("--width", "960"));
const HEIGHT = Number(getArg("--height", "600"));
const OUT    = getArg("--out", path.join(projectRoot, "public", "demo.gif"));
const FRAMES_DIR = getArg("--frames", path.join(projectRoot, "demo-frames"));
const DELAY_CS = Math.round(100 / FPS); // centiseconds per frame

// ── Load sharp ─────────────────────────────────────────────────────────────
let sharp;
const sharpCandidates = [
  "/Users/funtoco/workSpace/fun-growth-loadmap/node_modules/sharp/lib/index.js",
];
for (const c of sharpCandidates) {
  try {
    const m = await import(c);
    sharp = m.default ?? m;
    break;
  } catch { /* try next */ }
}
if (!sharp) throw new Error("sharp not found in known locations");

// ── GIF89a encoder ─────────────────────────────────────────────────────────

/** LZW compress an array of palette indices. Returns Buffer. */
function lzwEncode(indices, minCodeSize) {
  const CLEAR = 1 << minCodeSize;
  const EOI   = CLEAR + 1;
  let nextCode = EOI + 1;
  let table = new Map();
  const resetTable = () => {
    table.clear();
    for (let i = 0; i < CLEAR; i++) table.set(String(i), i);
    nextCode = EOI + 1;
  };
  resetTable();

  const output = [];
  let codeSize = minCodeSize + 1;
  let buf = 0, bufBits = 0;
  const emit = (code) => {
    buf |= code << bufBits;
    bufBits += codeSize;
    while (bufBits >= 8) {
      output.push(buf & 0xff);
      buf >>= 8;
      bufBits -= 8;
    }
  };
  const flush = () => {
    if (bufBits > 0) { output.push(buf & 0xff); buf = 0; bufBits = 0; }
  };

  emit(CLEAR);

  let str = "";
  for (let i = 0; i < indices.length; i++) {
    const c = String(indices[i]);
    const strC = str + "," + c;
    if (table.has(strC)) {
      str = strC;
    } else {
      emit(table.get(str));
      if (nextCode > 4095) {
        emit(CLEAR);
        resetTable();
        codeSize = minCodeSize + 1;
      } else {
        table.set(strC, nextCode++);
        if (nextCode - 1 >= (1 << codeSize) && codeSize < 12) codeSize++;
      }
      str = c;
    }
  }
  if (str !== "") emit(table.get(str));
  emit(EOI);
  flush();
  return Buffer.from(output);
}

/** Pack LZW output into sub-blocks (max 255 bytes each). */
function packSubBlocks(data) {
  const out = [];
  let offset = 0;
  while (offset < data.length) {
    const blockSize = Math.min(255, data.length - offset);
    out.push(blockSize);
    for (let i = 0; i < blockSize; i++) out.push(data[offset + i]);
    offset += blockSize;
  }
  out.push(0); // block terminator
  return Buffer.from(out);
}

/** Build one GIF frame (GCE + Image Descriptor + Image Data). */
function buildFrame({ pixels, palette, width, height, delay }) {
  const parts = [];

  // Graphic Control Extension
  const gce = Buffer.alloc(8);
  gce[0] = 0x21; // extension introducer
  gce[1] = 0xf9; // GCE label
  gce[2] = 4;    // block size
  gce[3] = 0x00; // packed: no disposal, no user input, no transparency
  gce.writeUInt16LE(delay, 4); // delay in centiseconds
  gce[6] = 0;    // transparent index (unused)
  gce[7] = 0;    // block terminator
  parts.push(gce);

  // Local Color Table flag = 0 (use global), interlace = 0
  const imgDesc = Buffer.alloc(10);
  imgDesc[0] = 0x2c; // image separator
  imgDesc.writeUInt16LE(0, 1); // left
  imgDesc.writeUInt16LE(0, 3); // top
  imgDesc.writeUInt16LE(width, 5);
  imgDesc.writeUInt16LE(height, 7);
  imgDesc[9] = 0x00; // no local color table
  parts.push(imgDesc);

  // LZW minimum code size
  const minCodeSize = Math.max(2, Math.ceil(Math.log2(palette.length)));
  parts.push(Buffer.from([minCodeSize]));

  // Compress and pack
  const compressed = lzwEncode(pixels, minCodeSize);
  parts.push(packSubBlocks(compressed));

  return Buffer.concat(parts);
}

/** Build full GIF89a from frames. */
function buildGif({ frames, width, height, palette, delay }) {
  const parts = [];

  // Header
  parts.push(Buffer.from("GIF89a"));

  // Logical Screen Descriptor
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(width, 0);
  lsd.writeUInt16LE(height, 2);
  const paletteSize = Math.ceil(Math.log2(palette.length)) - 1;
  lsd[4] = 0x80 | paletteSize; // global color table flag + size
  lsd[5] = 0; // background color index
  lsd[6] = 0; // pixel aspect ratio
  parts.push(lsd);

  // Global Color Table
  const gct = Buffer.alloc(3 * (1 << (paletteSize + 1)));
  for (let i = 0; i < palette.length; i++) {
    gct[i * 3    ] = palette[i][0];
    gct[i * 3 + 1] = palette[i][1];
    gct[i * 3 + 2] = palette[i][2];
  }
  parts.push(gct);

  // Application Extension for looping (NETSCAPE 2.0)
  parts.push(Buffer.from([
    0x21, 0xff, 11,
    0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, // "NETSCAPE2.0"
    3, 1, 0, 0, 0, // loop count = 0 (infinite)
  ]));

  // Frames
  for (const frame of frames) {
    parts.push(buildFrame({ ...frame, width, height, delay, palette }));
  }

  // Trailer
  parts.push(Buffer.from([0x3b]));

  return Buffer.concat(parts);
}

// ── Main ───────────────────────────────────────────────────────────────────

const frameFiles = (await fs.readdir(FRAMES_DIR))
  .filter(f => f.endsWith(".png") && !f.startsWith("demo"))
  .sort()
  .map(f => path.join(FRAMES_DIR, f));

if (frameFiles.length === 0) {
  console.error(`No PNG frames found in ${FRAMES_DIR}`);
  process.exitCode = 1;
  process.exit();
}

console.log(`Processing ${frameFiles.length} frames → ${OUT}`);
console.log(`  size: ${WIDTH}×${HEIGHT}, ${FPS} fps (${DELAY_CS} cs/frame)`);

// Build a unified palette from the first frame (representative of the design)
// Quantize first frame to 256 colors using sharp's PNG output with limited palette
const paletteSource = await sharp(frameFiles[0])
  .resize(WIDTH, HEIGHT, { fit: "cover", position: "top" })
  .png({ palette: true, colors: 256 })
  .toBuffer();

// Extract raw RGBA from palette source
const paletteFrameRaw = await sharp(paletteSource).raw().toBuffer();
const paletteFrameMeta = await sharp(paletteSource).metadata();
console.log(`  palette frame: ${paletteFrameMeta.width}×${paletteFrameMeta.height}`);

// Build a simple 256-color palette by sampling unique colors from the quantized image
const colorMap = new Map();
const palette = [];
const pixelCount = paletteFrameMeta.width * paletteFrameMeta.height;
for (let i = 0; i < pixelCount; i++) {
  const r = paletteFrameRaw[i * 4];
  const g = paletteFrameRaw[i * 4 + 1];
  const b = paletteFrameRaw[i * 4 + 2];
  const key = (r << 16) | (g << 8) | b;
  if (!colorMap.has(key) && palette.length < 256) {
    colorMap.set(key, palette.length);
    palette.push([r, g, b]);
  }
}
// Pad palette to next power of 2
while (palette.length < 256) palette.push([0, 0, 0]);
console.log(`  palette: ${colorMap.size} unique colors`);

// Helper: find nearest palette color (Euclidean distance)
function nearestColor(r, g, b) {
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const dr = r - palette[i][0], dg = g - palette[i][1], db = b - palette[i][2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDist) { bestDist = d; best = i; }
    if (d === 0) break;
  }
  return best;
}

// Process each frame
const gifFrames = [];
for (let fi = 0; fi < frameFiles.length; fi++) {
  process.stdout.write(`  frame ${fi + 1}/${frameFiles.length}: ${path.basename(frameFiles[fi])}...`);
  const raw = await sharp(frameFiles[fi])
    .resize(WIDTH, HEIGHT, { fit: "cover", position: "top" })
    .raw()
    .toBuffer();

  const pixels = new Uint8Array(WIDTH * HEIGHT);
  for (let i = 0; i < WIDTH * HEIGHT; i++) {
    pixels[i] = nearestColor(raw[i * 4], raw[i * 4 + 1], raw[i * 4 + 2]);
  }
  gifFrames.push({ pixels });
  process.stdout.write(` done\n`);
}

console.log("Encoding GIF...");
const gif = buildGif({
  frames: gifFrames,
  width: WIDTH,
  height: HEIGHT,
  palette,
  delay: DELAY_CS,
});

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, gif);
console.log(`\n✓ GIF written: ${OUT} (${(gif.length / 1024).toFixed(0)} KB)`);
