// The World on Saturday — the world news of Saturday 21 November 2026,
// drawn as a newspaper front page and written to /output/entry.png.
// Node 22, standard library only (node:fs, node:path, node:zlib).
// No network, no randomness, no timestamps: both runs write identical bytes.
//
// The picture is rasterised by hand into an RGB framebuffer: a 5x7 bitmap
// font (one 35-bit string per glyph), filled rectangles, lines, circles and
// a few small pictograms, then encoded as a PNG with a CRC32 + zlib writer
// written here from scratch.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

// ---------------------------------------------------------------------------
// 5x7 bitmap font. Each glyph is 7 rows of 5 bits, written as one string of
// 35 characters ("1" = ink, "0" = paper). Only the characters the front page
// uses are defined; drawText() uppercases its input first.
// ---------------------------------------------------------------------------
const FONT: Record<string, string> = {
  A: "01110100011000111111100011000110001",
  B: "11110100011000111110100011000111110",
  C: "01110100011000010000100001000101110",
  D: "11110100011000110001100011000111110",
  E: "11111100001000011110100001000011111",
  F: "11111100001000011110100001000010000",
  G: "01110100011000010111100011000101111",
  H: "10001100011000111111100011000110001",
  I: "01110001000010000100001000010001110",
  J: "00111000100001000010000101001001100",
  K: "10001100101010011000101001001010001",
  L: "10000100001000010000100001000011111",
  M: "10001110111010110101100011000110001",
  N: "10001110011010110011100011000110001",
  O: "01110100011000110001100011000101110",
  P: "11110100011000111110100001000010000",
  Q: "01110100011000110001101011001001101",
  R: "11110100011000111110101001001010001",
  S: "01111100001000001110000010000111110",
  T: "11111001000010000100001000010000100",
  U: "10001100011000110001100011000101110",
  V: "10001100011000110001100010101000100",
  W: "10001100011000110101101011010101010",
  X: "10001100010101000100010101000110001",
  Y: "10001100010101000100001000010000100",
  Z: "11111000010001000100010001000011111",
  "0": "01110100011001110101110011000101110",
  "1": "00100011000010000100001000010001110",
  "2": "01110100010000100110010001000011111",
  "3": "11111000100010000010000011000101110",
  "4": "00010001100101010010111110001000010",
  "5": "11111100001111000001000011000101110",
  "6": "00110010001000011110100011000101110",
  "7": "11111000010001000100010001000010000",
  "8": "01110100011000101110100011000101110",
  "9": "01110100011000101111000010001001100",
  " ": "00000000000000000000000000000000000",
  ".": "00000000000000000000000000110001100",
  ",": "000000000000000000000011000010001000",
  ":": "00000011000110000000011000110000000",
  "-": "00000000000000001110000000000000000",
  "'": "00100001000100000000000000000000000",
  "(": "00010001000100001000010000010000010",
  ")": "01000001000001000010000100001001000",
  "%": "11001110100001000100010000101110011",
  "/": "00001000100001000100010001000010000",
  "&": "01100100101010001000101011001001101",
  "!": "00100001000010000100001000000000100",
  "?": "01110100010000100110001000000000100",
  "+": "00000001000010011111001000010000000",
  "=": "00000000001111100000111110000000000",
  $: "00100011111010001110001011111000100",
};

// ---------------------------------------------------------------------------
// Framebuffer and drawing primitives (1024 x 1024, RGB, paper background).
// ---------------------------------------------------------------------------
const W = 1024;
const H = 1024;
const buf = Buffer.alloc(W * H * 3);
const PAPER: [number, number, number] = [247, 242, 231];
const INK: [number, number, number] = [20, 20, 20];
const RED: [number, number, number] = [176, 30, 36];
const NAVY: [number, number, number] = [29, 53, 87];
const GOLD: [number, number, number] = [198, 138, 24];
const TEAL: [number, number, number] = [31, 122, 110];
const GREY: [number, number, number] = [110, 110, 104];
const WHITE: [number, number, number] = [255, 255, 255];
const LIGHT: [number, number, number] = [233, 226, 210];

type RGB = [number, number, number];

function fill(c: RGB): void {
  for (let i = 0; i < W * H; i++) {
    buf[i * 3] = c[0];
    buf[i * 3 + 1] = c[1];
    buf[i * 3 + 2] = c[2];
  }
}

function px(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = c[0];
  buf[i + 1] = c[1];
  buf[i + 2] = c[2];
}

function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) px(i, j, c);
  }
}

function hline(x: number, y: number, w: number, c: RGB, t = 1): void {
  rect(x, y, w, t, c);
}

function vline(x: number, y: number, h: number, c: RGB, t = 1): void {
  rect(x, y, t, h, c);
}

function box(x: number, y: number, w: number, h: number, c: RGB, t = 2): void {
  hline(x, y, w, c, t);
  hline(x, y + h - t, w, c, t);
  vline(x, y, h, c, t);
  vline(x + w - t, y, h, c, t);
}

function disc(cx: number, cy: number, r: number, c: RGB): void {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) px(x, y, c);
    }
  }
}

function ring(cx: number, cy: number, r: number, c: RGB, t = 3): void {
  for (let y = cy - r - t; y <= cy + r + t; y++) {
    for (let x = cx - r - t; x <= cx + r + t; x++) {
      const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      if (Math.abs(d - r) <= t / 2) px(x, y, c);
    }
  }
}

// A straight line between two points (Bresenham), thickness t.
function line(x0: number, y0: number, x1: number, y1: number, c: RGB, t = 2): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    rect(x - Math.floor(t / 2), y - Math.floor(t / 2), t, t, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

// A starburst (explosion) centred at (cx, cy): 12 spikes radiating out.
function starburst(cx: number, cy: number, r1: number, r2: number, c: RGB): void {
  const spikes = 12;
  for (let s = 0; s < spikes; s++) {
    const a = (s / spikes) * Math.PI * 2;
    const r = s % 2 === 0 ? r2 : Math.round(r2 * 0.62);
    line(cx, cy, Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), c, 5);
  }
  disc(cx, cy, r1, c);
}

// ---------------------------------------------------------------------------
// Text: draw one glyph, measure a string, draw a string, wrap to a width.
// scale 1 = 5x7 px per glyph; a glyph cell is 6*scale wide (1 px tracking).
// ---------------------------------------------------------------------------
function drawChar(ch: string, x: number, y: number, scale: number, c: RGB): void {
  const g = FONT[ch];
  if (!g) return;
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 5; col++) {
      if (g[row * 5 + col] === "1") {
        rect(x + col * scale, y + row * scale, scale, scale, c);
      }
    }
  }
}

function textWidth(s: string, scale: number): number {
  return s.length * 6 * scale - scale;
}

function drawText(s: string, x: number, y: number, scale: number, c: RGB): void {
  const up = s.toUpperCase();
  for (let i = 0; i < up.length; i++) {
    drawChar(up[i], x + i * 6 * scale, y, scale, c);
  }
}

function drawCentred(s: string, cx: number, y: number, scale: number, c: RGB): void {
  drawText(s, cx - Math.floor(textWidth(s.toUpperCase(), scale) / 2), y, scale, c);
}

// Greedy word wrap: returns lines that fit in maxW px at the given scale.
function wrap(s: string, scale: number, maxW: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur === "" ? w : cur + " " + w;
    if (textWidth(trial, scale) <= maxW || cur === "") {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

function drawPara(s: string, x: number, y: number, scale: number, c: RGB, maxW: number): number {
  const lines = wrap(s, scale, maxW);
  const lh = 9 * scale;
  for (let i = 0; i < lines.length; i++) {
    drawText(lines[i], x, y + i * lh, scale, c);
  }
  return y + lines.length * lh;
}

// ---------------------------------------------------------------------------
// PNG encoder: CRC32 table, chunk writer, raw scanlines (filter 0) deflated.
// ---------------------------------------------------------------------------
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    buf.copy(raw, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// The front page: "The World on Saturday", 21 November 2026.
// Six stories, each verified against a trusted source on 21 November 2026:
//   1. Russian missiles land in Poland — AP / The Times
//   2. Wall Street sinks into correction — NPR / Wall Street Journal
//   3. Trump hails the Xi-Putin summit — AP / Reuters
//   4. COP31 talks spill into overtime — Reuters / UN News
//   5. Bank customer data leaked in vendor hack — Wall Street Journal
//   6. Cyclone Akvan hits India's east coast — Reuters / India Met Dept
// ---------------------------------------------------------------------------
fill(PAPER);

// --- Masthead ---------------------------------------------------------------
rect(0, 0, W, 10, INK);
drawCentred("THE WORLD ON SATURDAY", W / 2, 30, 5, INK);
hline(28, 78, W - 56, INK, 3);
drawCentred("SATURDAY, 21 NOVEMBER 2026", W / 2, 92, 3, RED);
drawCentred("SIX STORIES THAT DEFINED THE DAY  -  FROM WARSAW TO WALL STREET", W / 2, 128, 2, INK);
hline(28, 158, W - 56, INK, 3);

// --- Lead story: Poland -----------------------------------------------------
const leadY = 176;
box(28, leadY, W - 56, 252, INK, 3);
rect(28, leadY, W - 56, 34, RED);
drawText("WAR IN EUROPE  -  POLAND", 44, leadY + 10, 2, WHITE);
// Illustration panel (right): night sky, blast, missile over a field.
rect(668, leadY + 34, 300, 218, NAVY);
// Missile flying left to right across the top of the panel.
line(700, leadY + 66, 812, leadY + 66, WHITE, 6);
line(812, leadY + 66, 790, leadY + 58, WHITE, 5);
line(812, leadY + 66, 790, leadY + 74, WHITE, 5);
line(716, leadY + 66, 700, leadY + 58, WHITE, 4);
line(716, leadY + 66, 700, leadY + 74, WHITE, 4);
starburst(850, leadY + 150, 24, 58, GOLD);
starburst(850, leadY + 150, 13, 30, RED);
drawText("POLAND", 684, leadY + 196, 2, WHITE);
drawText("KH-101 MISSILE", 684, leadY + 218, 1, GOLD);
drawText("RUSSIAN MISSILES LAND IN POLAND", 44, leadY + 48, 3, INK);
drawPara(
  "Two Russian missiles and a suspected drone came down in south-east Poland on Friday during a huge Russian attack on Ukraine. Prime Minister Donald Tusk called it a deliberate provocation.",
  44, leadY + 96, 2, INK, 600,
);
drawPara(
  "NATO chief Mark Rutte called it a grave violation and is due in Warsaw today. No injuries were reported.",
  44, leadY + 192, 2, RED, 600,
);

// --- Story boxes 2-5 (two columns, two rows) --------------------------------
interface Story {
  kicker: string;
  headline: string;
  body: string;
  accent: RGB;
}

const stories: Story[] = [
  {
    kicker: "WALL STREET",
    headline: "STOCKS SINK AS AI RALLY UNWINDS",
    body: "The S&P 500 fell 3.7% on Friday and entered correction territory, down more than 10% from its peak. The Nasdaq slid 5.3% and turned negative for the year. Nvidia fell 14% as Reuters reported the SEC is probing its accounting.",
    accent: RED,
  },
  {
    kicker: "DIPLOMACY - SHENZHEN",
    headline: "TRUMP HAILS XI-PUTIN TALKS",
    body: "President Trump called his first trilateral meeting with Xi Jinping and Vladimir Putin a success at a White House briefing on Friday. The joint declaration pledged talks on nuclear risks, but produced few concrete breakthroughs on Ukraine.",
    accent: NAVY,
  },
  {
    kicker: "CLIMATE - ANTALYA",
    headline: "COP31 TALKS SPILL INTO OVERTIME",
    body: "UN climate talks in Antalya ran past their Friday deadline into Saturday, split over fossil fuels. The latest draft dropped all mention of ending fossil-fuel use, drawing protests from France, Panama and others.",
    accent: TEAL,
  },
  {
    kicker: "CYBERATTACK",
    headline: "BANK DATA LEAKED IN VENDOR HACK",
    body: "JPMorgan Chase, Visa and Mastercard said customer data was exposed after hackers hit third-party providers. A ransomware group claimed the leak and posted files online. The firms said payment systems and card numbers were not affected.",
    accent: GOLD,
  },
];

function drawStory(s: Story, x: number, y: number, w: number, h: number): void {
  box(x, y, w, h, INK, 2);
  rect(x, y, w, 30, s.accent);
  drawText(s.kicker, x + 14, y + 9, 2, WHITE);
  const hy = drawPara(s.headline, x + 14, y + 44, 2, INK, w - 28);
  drawPara(s.body, x + 14, hy + 6, 2, INK, w - 28);
  // Small pictogram in the accent bar's right end: a falling chart line.
  line(x + w - 66, y + 9, x + w - 50, y + 21, WHITE, 3);
  line(x + w - 50, y + 21, x + w - 34, y + 8, WHITE, 3);
  line(x + w - 34, y + 8, x + w - 18, y + 22, WHITE, 3);
}

const colW = 466;
const rowY1 = 444;
const rowY2 = 652;
const boxH = 200;
drawStory(stories[0], 28, rowY1, colW, boxH);
drawStory(stories[1], 530, rowY1, colW, boxH);
drawStory(stories[2], 28, rowY2, colW, boxH);
drawStory(stories[3], 530, rowY2, colW, boxH);

// --- Story 6: cyclone, full-width strip --------------------------------------
const cycY = 862;
box(28, cycY, W - 56, 110, INK, 2);
rect(28, cycY, W - 56, 30, TEAL);
drawText("WEATHER - INDIA", 44, cycY + 9, 2, WHITE);
// Cyclone spiral pictogram on the right of the strip.
ring(930, cycY + 68, 26, TEAL, 4);
ring(930, cycY + 68, 16, TEAL, 4);
disc(930, cycY + 68, 5, RED);
drawText("CYCLONE AKVAN HITS INDIA'S EAST COAST", 44, cycY + 42, 2, INK);
drawPara(
  "Cyclone Akvan crossed the Odisha coast near Gopalpur on Friday, winds gusting to 90 km/h. Over 300,000 people moved to shelters.",
  44, cycY + 68, 2, INK, 830,
);

// --- Footer ------------------------------------------------------------------
hline(28, 984, W - 56, INK, 2);
drawCentred("SATURDAY 21 NOVEMBER 2026  -  SOURCES: AP, REUTERS, THE TIMES, NPR, WSJ, UN NEWS, IMD", W / 2, 994, 1, GREY);

// --- Write the file ----------------------------------------------------------
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "entry.png"), encodePng());
