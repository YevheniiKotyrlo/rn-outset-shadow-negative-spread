// Counts the dark pixels below each box in the screenshot reproduce.sh takes, and exits 1 while a box whose spread
// empties its shadow shape paints anything there, 0 once none does, 2 when the control's shadow is missing or a step fails.
// Usage: node compare-shadow-bars.mjs <screenshot.png> <screen WxH> <density dpi>
//   "empty:<box name>=<left>,<top>,<right>,<bottom>"... "control:<box name>=<left>,<top>,<right>,<bottom>"
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

// The black shadow's pixels; the white screen and the boxes' slate fill are far brighter.
const darkChannelLimit = 64;
const regionDepthDp = 30;
// '0 40px 0 -20px' on a 100x50 box: a 60x10 shape 10 dp below it.
const controlBarAreaDp = 60 * 10;

function fail(message) {
  console.log(`step failed: ${message}`);
  process.exit(2);
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) {
    return left;
  }
  return toUp <= toUpLeft ? up : upLeft;
}

function predictor(filter, left, up, upLeft) {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4:
      return paeth(left, up, upLeft);
    default:
      throw new Error(`unknown PNG row filter ${filter}`);
  }
}

function decodePng(path) {
  const file = readFileSync(path);
  if (file.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`${path} is not a PNG`);
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const compressed = [];
  while (offset < file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('latin1', offset + 4, offset + 8);
    const body = file.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [bitDepth, colorType] = [body[8], body[9]];
      const interlaced = body[12] !== 0;
      if (bitDepth !== 8 || interlaced || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`${path} is not an 8-bit, non-interlaced RGB or RGBA PNG`);
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      compressed.push(body);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const filtered = inflateSync(Buffer.concat(compressed));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  const emptyRow = Buffer.alloc(stride);
  for (let row = 0; row < height; row += 1) {
    const filter = filtered[row * (stride + 1)];
    const line = filtered.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    const current = pixels.subarray(row * stride, (row + 1) * stride);
    const previous = row > 0 ? pixels.subarray((row - 1) * stride, row * stride) : emptyRow;
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? current[index - channels] : 0;
      const upLeft = index >= channels ? previous[index - channels] : 0;
      current[index] = (line[index] + predictor(filter, left, previous[index], upLeft)) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

function darkPixels(screenshot, region) {
  let count = 0;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let y = region.top; y < region.bottom; y += 1) {
    for (let x = region.left; x < region.right; x += 1) {
      const index = (y * screenshot.width + x) * screenshot.channels;
      const isDark = [0, 1, 2].every(channel => screenshot.pixels[index + channel] < darkChannelLimit);
      if (isDark) {
        count += 1;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
    }
  }
  return { count, extent: count === 0 ? null : { left, top, right, bottom } };
}

function parseBox(argument, screen, density) {
  const match = /^(empty|control):(.+)=(\d+),(\d+),(\d+),(\d+)$/.exec(argument);
  if (!match) {
    fail(`"${argument}" is not "empty|control:<box name>=<left>,<top>,<right>,<bottom>"`);
  }
  const [left, top, right, bottom] = match.slice(3).map(Number);
  return {
    role: match[1],
    name: match[2],
    bounds: { left, top, right, bottom },
    region: { left, top: bottom, right, bottom: Math.min(screen.height, bottom + Math.round(regionDepthDp * density)) },
  };
}

function describeExtent(extent, box, density) {
  if (extent === null) {
    return 'none';
  }
  const inDp = pixels => Math.round(pixels / density);
  return (
    `spanning ${extent.right - extent.left}x${extent.bottom - extent.top} px` +
    ` (${inDp(extent.right - extent.left)}x${inDp(extent.bottom - extent.top)} dp),` +
    ` ${inDp(extent.left - box.bounds.left)} dp from its left edge and ${inDp(extent.top - box.bounds.bottom)} dp below it`
  );
}

function joinNames(names) {
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function main(argumentList) {
  const [screenshotPath, screenArgument, dpiArgument, ...boxArguments] = argumentList;
  const screenMatch = /^(\d+)x(\d+)$/.exec(screenArgument ?? '');
  if (!screenshotPath || !screenMatch || !/^\d+$/.test(dpiArgument ?? '')) {
    fail('usage: compare-shadow-bars.mjs <screenshot.png> <WxH> <dpi> "empty|control:<box>=<l>,<t>,<r>,<b>"...');
  }
  let screenshot;
  try {
    screenshot = decodePng(screenshotPath);
  } catch (error) {
    fail(`reading the screenshot: ${error.message}`);
  }
  const [screenWidth, screenHeight] = screenMatch.slice(1).map(Number);
  if (screenshot.width !== screenWidth || screenshot.height !== screenHeight) {
    fail(`the screenshot is ${screenshot.width}x${screenshot.height}, where the window the box bounds come from is ${screenWidth}x${screenHeight}`);
  }
  const density = Number(dpiArgument) / 160;
  const boxes = boxArguments.map(argument => parseBox(argument, screenshot, density));
  const emptyBoxes = boxes.filter(box => box.role === 'empty');
  const controls = boxes.filter(box => box.role === 'control');
  if (emptyBoxes.length === 0 || controls.length === 0) {
    fail('needs at least one "empty:" box and one "control:" box');
  }

  const painting = [];
  const missingControls = [];
  for (const box of boxes) {
    const { bounds, region } = box;
    const { count, extent } = darkPixels(screenshot, region);
    const regionSize = `${region.right - region.left}x${region.bottom - region.top} px`;
    const expectation =
      box.role === 'empty' ? 'where its shadow shape is empty' : 'where its shadow paints a 60x10 dp shape';
    console.log(
      `${box.name}: ${bounds.right - bounds.left}x${bounds.bottom - bounds.top} px at (${bounds.left}, ${bounds.top});` +
        ` ${count} dark pixels in the ${regionSize} below it, ${expectation}: ${describeExtent(extent, box, density)}`,
    );
    if (box.role === 'empty' && count > 0) {
      painting.push(box.name);
    }
    if (box.role === 'control' && count < (controlBarAreaDp * density * density) / 2) {
      missingControls.push(box.name);
    }
  }
  if (missingControls.length > 0) {
    const subject = joinNames(missingControls.map(name => `the ${name}`));
    console.log(`SUMMARY: ${subject} paints no shadow shape below it, so the comparison shows nothing`);
    process.exit(2);
  }
  if (painting.length > 0) {
    const subject = joinNames(painting.map(name => `the ${name}`));
    const paints = painting.length === 1 ? 'paints a bar below it' : 'each paint a bar below them';
    console.log(`SUMMARY: ${subject} ${paints}, where the spread empties the shadow shape`);
    process.exit(1);
  }
  console.log('SUMMARY: no box whose spread empties its shadow shape paints a shadow, and the control paints its shape');
  process.exit(0);
}

main(process.argv.slice(2));
