// Generate simple PWA icons (no external dependencies)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPNG(size, bgColor, emoji) {
  // Create a simple colored square with text-like pattern
  const width = size;
  const height = size;

  // Build raw image data (RGBA)
  const rawData = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = width * 0.4;

      // Distance from center
      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < radius) {
        // Inside circle - lightning bolt shape (simplified as bright center)
        const factor = 1 - (dist / radius);
        rawData[idx]     = Math.min(255, Math.floor(59 + factor * 100));  // R
        rawData[idx + 1] = Math.min(255, Math.floor(130 + factor * 80)); // G
        rawData[idx + 2] = Math.min(255, Math.floor(246));               // B
        rawData[idx + 3] = 255;                                           // A
      } else if (dist < radius + 2) {
        // Border
        rawData[idx]     = 255;
        rawData[idx + 1] = 255;
        rawData[idx + 2] = 255;
        rawData[idx + 3] = 60;
      } else {
        // Background
        rawData[idx]     = 15;  // #0f172a
        rawData[idx + 1] = 23;
        rawData[idx + 2] = 42;
        rawData[idx + 3] = 255;
      }
    }
  }

  // PNG encoding
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(buf) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      crc = crc ^ buf[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
    }
    return (crc ^ -1) >>> 0;
  }

  function chunk(type, data) {
    const typeBuffer = Buffer.from(type, 'ascii');
    const lenBuffer = Buffer.alloc(4);
    lenBuffer.writeUInt32BE(data.length, 0);
    const combined = Buffer.concat([typeBuffer, data]);
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE(crc32(combined), 0);
    return Buffer.concat([lenBuffer, combined, crcBuffer]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type (RGBA)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Add filter byte (0 = none) to each row
  const filtered = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered[y * (width * 4 + 1)] = 0; // filter byte
    rawData.copy(filtered, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(filtered);

  const png = Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);

  return png;
}

// Generate icons
const outDir = path.join(__dirname, 'public');

const icon192 = createPNG(192, [15, 23, 42], '⚡');
const icon512 = createPNG(512, [15, 23, 42], '⚡');

fs.writeFileSync(path.join(outDir, 'icon-192.png'), icon192);
fs.writeFileSync(path.join(outDir, 'icon-512.png'), icon512);

console.log('Icons generated:');
console.log(`  icon-192.png (${icon192.length} bytes)`);
console.log(`  icon-512.png (${icon512.length} bytes)`);
