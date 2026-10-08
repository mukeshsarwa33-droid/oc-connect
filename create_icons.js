const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Create PNG from raw RGBA buffer using pure built-in Node modules (zlib)
function createPngBuffer(width, height, rgbaBuffer) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // 8-bit depth
  ihdr.writeUInt8(6, 9); // RGBA color type
  ihdr.writeUInt8(0, 10); // Deflate compression
  ihdr.writeUInt8(0, 11); // Filter method
  ihdr.writeUInt8(0, 12); // No interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);

  // Scanlines with filter byte 0 (None)
  const scanlineLength = width * 4 + 1;
  const rawData = Buffer.alloc(height * scanlineLength);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineLength;
    rawData[rowOffset] = 0; // Filter byte: None
    for (let x = 0; x < width; x++) {
      const srcOffset = (y * width + x) * 4;
      const dstOffset = rowOffset + 1 + x * 4;
      rawData[dstOffset] = rgbaBuffer[srcOffset];         // R
      rawData[dstOffset + 1] = rgbaBuffer[srcOffset + 1]; // G
      rawData[dstOffset + 2] = rgbaBuffer[srcOffset + 2]; // B
      rawData[dstOffset + 3] = rgbaBuffer[srcOffset + 3]; // A
    }
  }

  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressedData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(4 + 4 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const crc = crc32(chunk.subarray(4, 8 + len));
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

// CRC32 implementation
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1);
    else c = c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// Generate Okanagan College App Icon (Emerald Green + Gold + Shield + "OC")
function drawOcAppIcon(size, isMaskable = false) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2;
  const cornerRadius = isMaskable ? 0 : size * 0.22; // iOS squircle radius

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Squircle distance check if not maskable
      let inside = true;
      if (!isMaskable) {
        const dx = Math.abs(x - cx);
        const dy = Math.abs(y - cy);
        const half = size / 2;
        if (dx > half - cornerRadius && dy > half - cornerRadius) {
          const cdx = dx - (half - cornerRadius);
          const cdy = dy - (half - cornerRadius);
          if (cdx * cdx + cdy * cdy > cornerRadius * cornerRadius) {
            inside = false;
          }
        }
      }

      if (!inside) {
        buf[idx] = 0;
        buf[idx + 1] = 0;
        buf[idx + 2] = 0;
        buf[idx + 3] = 0;
        continue;
      }

      // Background Gradient: #075E54 to #128C7E
      const t = y / size;
      const rVal = Math.round(7 * (1 - t) + 18 * t);
      const gVal = Math.round(94 * (1 - t) + 140 * t);
      const bVal = Math.round(84 * (1 - t) + 126 * t);

      let pR = rVal;
      let pG = gVal;
      let pB = bVal;
      let pA = 255;

      // Inner subtle glow circle
      const distFromCenter = Math.hypot(x - cx, y - (cy - size * 0.05));
      const circleRadius = size * 0.38;

      if (distFromCenter < circleRadius) {
        // Gold accent border ring
        if (distFromCenter > circleRadius - size * 0.035) {
          pR = 255; pG = 193; pB = 7; // Gold #FFC107
        } else {
          // Inside shield/circle dark backdrop #054C44
          pR = 5; pG = 76; pB = 68;
        }
      }

      // Graduation Cap / Shield Accent at top (y between cy - size*0.35 and cy - size*0.12)
      const capTop = cy - size * 0.32;
      const capBottom = cy - size * 0.15;
      if (y >= capTop && y <= capBottom) {
        const capWidth = (1 - Math.abs(y - (capTop + (capBottom - capTop)/2)) / ((capBottom - capTop)/2)) * (size * 0.32);
        if (Math.abs(x - cx) <= capWidth) {
          pR = 255; pG = 255; pB = 255; // Crisp White cap
        }
      }

      // Lettering "O" on left (cx - size*0.16)
      const oCenterX = cx - size * 0.15;
      const oCenterY = cy + size * 0.08;
      const oDist = Math.hypot(x - oCenterX, y - oCenterY);
      const oOuter = size * 0.16;
      const oInner = size * 0.09;
      if (oDist <= oOuter && oDist >= oInner) {
        pR = 255; pG = 255; pB = 255; // White "O"
      }

      // Lettering "C" on right (cx + size*0.16)
      const cCenterX = cx + size * 0.15;
      const cCenterY = cy + size * 0.08;
      const cDist = Math.hypot(x - cCenterX, y - cCenterY);
      const cOuter = size * 0.16;
      const cInner = size * 0.09;
      if (cDist <= cOuter && cDist >= cInner) {
        // Leave opening on the right of the "C"
        const angle = Math.atan2(y - cCenterY, x - cCenterX);
        if (angle < -0.6 || angle > 0.6) {
          pR = 255; pG = 255; pB = 255; // White "C"
        }
      }

      // Bottom pill badge: "LIVE" or Gold Dot at bottom
      const dotDist = Math.hypot(x - cx, y - (cy + size * 0.34));
      if (dotDist <= size * 0.035) {
        pR = 37; pG = 211; pB = 102; // Emerald Green pulse dot #25D366
      }

      buf[idx] = pR;
      buf[idx + 1] = pG;
      buf[idx + 2] = pB;
      buf[idx + 3] = pA;
    }
  }

  return createPngBuffer(size, size, buf);
}

// Ensure directory exists
const iconsDir = path.join(__dirname, 'public', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

console.log('Generating high-resolution PWA icons...');

const icon192 = drawOcAppIcon(192, false);
fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), icon192);
console.log('Created icon-192.png');

const icon512 = drawOcAppIcon(512, false);
fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), icon512);
console.log('Created icon-512.png');

const iconApple = drawOcAppIcon(180, false);
fs.writeFileSync(path.join(iconsDir, 'apple-touch-icon.png'), iconApple);
console.log('Created apple-touch-icon.png');

const iconMaskable = drawOcAppIcon(512, true);
fs.writeFileSync(path.join(iconsDir, 'maskable-icon-512.png'), iconMaskable);
console.log('Created maskable-icon-512.png');

// Also create vector SVG icon
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="ocGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#075E54" />
      <stop offset="100%" stop-color="#128C7E" />
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="115" fill="url(#ocGrad)"/>
  <circle cx="256" cy="240" r="190" fill="#054C44" stroke="#FFC107" stroke-width="12" filter="url(#shadow)"/>
  <!-- Graduation Cap -->
  <path d="M256 100 L380 160 L256 220 L132 160 Z" fill="#FFFFFF"/>
  <path d="M190 190 L190 240 Q256 280 322 240 L322 190" fill="none" stroke="#FFFFFF" stroke-width="12"/>
  <circle cx="390" cy="180" r="10" fill="#FFC107"/>
  <!-- OC Monogram -->
  <text x="180" y="360" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', Roboto, sans-serif" font-weight="900" font-size="140" fill="#FFFFFF" text-anchor="middle">O</text>
  <text x="330" y="360" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', Roboto, sans-serif" font-weight="900" font-size="140" fill="#FFFFFF" text-anchor="middle">C</text>
  <!-- Live Pulse Dot -->
  <circle cx="256" cy="425" r="14" fill="#25D366" stroke="#FFFFFF" stroke-width="4"/>
</svg>`;

fs.writeFileSync(path.join(iconsDir, 'icon.svg'), svgContent);
console.log('Created icon.svg');
console.log('All icons generated successfully!');
