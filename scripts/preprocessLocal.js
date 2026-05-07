#!/usr/bin/env node
/**
 * Preprocesses the local Baltimore Real Property GeoJSON into a browser-ready
 * subset (commercial/industrial/notable parcels only).
 *
 * Input:  data/Real_Property_Information.geojson   (563 MB, all parcels)
 * Output: public/data/commercial-properties.geojson (~5–10 MB, filtered)
 *
 * Run: node scripts/preprocessLocal.js
 */

import { createReadStream, createWriteStream, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IN_FILE  = join(__dirname, '../data/Real_Property_Information.geojson');
const OUT_DIR  = join(__dirname, '../public/data');
const OUT_FILE = join(OUT_DIR, 'commercial-properties.geojson');

const COMMERCIAL_USEGROUPS = new Set(['C', 'I', 'M', 'CC', 'OR']);
const MIN_VALUE = 500_000;

function keepFeature(props) {
  const ug = (props.USEGROUP || '').trim().toUpperCase();
  const value = props.ARTAXBAS || props.FULLCASH || props.TAXBASE || 0;
  return COMMERCIAL_USEGROUPS.has(ug) || value >= MIN_VALUE;
}

function slimProps(p) {
  return {
    OBJECTID:   p.OBJECTID,
    BLOCKLOT:   p.BLOCKLOT,
    FULLADDR:   p.FULLADDR,
    OWNER_1:    p.OWNER_1,
    OWNER_2:    p.OWNER_2,
    USEGROUP:   p.USEGROUP,
    ZONECODE:   p.ZONECODE,
    ARTAXBAS:   p.ARTAXBAS,
    TAXBASE:    p.TAXBASE,
    CURRLAND:   p.CURRLAND,
    CURRIMPR:   p.CURRIMPR,
    LOT_SIZE:   p.LOT_SIZE,
    YEAR_BUILD: p.YEAR_BUILD,
    STRUCTAREA: p.STRUCTAREA,
    SALEPRIC:   p.SALEPRIC,
    SALEDATE:   p.SALEDATE,
    NEIGHBOR:   p.NEIGHBOR,
    ZIP_CODE:   p.ZIP_CODE,
    SDATLINK:   p.SDATLINK,
    DHCDUSE1:   p.DHCDUSE1,
  };
}

console.log('\n  Baltimore Real Property Preprocessor');
console.log('='.repeat(50));
console.log('Stream-parsing 563 MB GeoJSON…\n');

// Stream parse strategy: read file in chunks, accumulate until we have a full
// feature JSON object, then parse and filter it.
// GeoJSON feature collections look like:
//   {"type":"FeatureCollection","features":[{...},{...},...]}
// Each feature is separated by "},\n{" or similar.
// We buffer until we find balanced braces for each feature.

mkdirSync(OUT_DIR, { recursive: true });

const outStream = createWriteStream(OUT_FILE);
outStream.write('{"type":"FeatureCollection","generatedAt":"' +
  new Date().toISOString() + '","sourceFile":"Real_Property_Information.geojson","features":[');

let buffer = '';
let inFeatures = false;
let braceDepth = 0;
let featureStart = -1;
let total = 0;
let kept = 0;
let firstOut = true;

const stream = createReadStream(IN_FILE, { encoding: 'utf8', highWaterMark: 1 << 20 }); // 1MB chunks

stream.on('data', chunk => {
  buffer += chunk;

  // Scan for feature boundaries
  let i = 0;

  if (!inFeatures) {
    // Find the start of the features array
    const idx = buffer.indexOf('"features"');
    if (idx === -1) { buffer = buffer.slice(-20); return; }
    const arrStart = buffer.indexOf('[', idx);
    if (arrStart === -1) { buffer = buffer.slice(-(buffer.length - idx)); return; }
    buffer = buffer.slice(arrStart + 1);
    inFeatures = true;
    i = 0;
  }

  while (i < buffer.length) {
    const ch = buffer[i];
    if (featureStart === -1) {
      if (ch === '{') { featureStart = i; braceDepth = 1; }
      i++;
      continue;
    }
    if (ch === '{') braceDepth++;
    else if (ch === '}') {
      braceDepth--;
      if (braceDepth === 0) {
        // Complete feature found
        const raw = buffer.slice(featureStart, i + 1);
        try {
          const f = JSON.parse(raw);
          total++;
          if (total % 10000 === 0) process.stdout.write(`\r  Scanned ${total.toLocaleString()} features, kept ${kept.toLocaleString()}…`);
          if (f.geometry &&
              (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') &&
              keepFeature(f.properties || {})) {
            const out = JSON.stringify({ type: 'Feature', geometry: f.geometry, properties: slimProps(f.properties) });
            outStream.write((firstOut ? '' : ',') + out);
            firstOut = false;
            kept++;
          }
        } catch (_) { /* malformed feature, skip */ }
        buffer = buffer.slice(i + 1);
        i = 0;
        featureStart = -1;
        continue;
      }
    }
    i++;
  }

  // Keep only the unprocessed tail
  if (featureStart !== -1) {
    buffer = buffer.slice(featureStart);
    featureStart = 0;
  } else {
    buffer = buffer.slice(-2); // keep last 2 chars in case brace straddles chunk
    featureStart = -1;
  }
});

stream.on('end', () => {
  outStream.write(']}');
  outStream.end(() => {
    process.stdout.write('\r' + ' '.repeat(70) + '\r');
    console.log(`\nTotal scanned:   ${total.toLocaleString()}`);
    console.log(`Kept (filtered): ${kept.toLocaleString()}`);
    console.log(`\n  Written: ${OUT_FILE}`);
    console.log('  Restart npm run dev — app will load this file automatically.\n');
  });
});

stream.on('error', e => { console.error('Read error:', e); process.exit(1); });
