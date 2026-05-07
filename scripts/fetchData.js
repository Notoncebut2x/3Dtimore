#!/usr/bin/env node
/**
 * Data pipeline: fetch Baltimore commercial property GeoJSON and save locally.
 * Run: node scripts/fetchData.js
 * Output: public/data/commercial-properties.geojson
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '../public/data');
const OUT_FILE = join(OUT_DIR, 'commercial-properties.geojson');

const ENDPOINTS = [
  'https://services1.arcgis.com/UWYHeuuJISiGmgXx/arcgis/rest/services/RealProperty/FeatureServer/0',
  'https://geodata.baltimorecity.gov/egis/rest/services/Planning/Realproperty/MapServer/0',
];

const WHERE = [
  "LANDUSEDESC LIKE '%COMMERCIAL%'",
  "LANDUSEDESC LIKE '%OFFICE%'",
  "LANDUSEDESC LIKE '%INDUSTRIAL%'",
  "LANDUSEDESC LIKE '%HOTEL%'",
  "LANDUSEDESC LIKE '%MIXED%'",
  "FULLCASH > 2000000",
].join(' OR ');

const OUT_FIELDS = [
  'BLOCKLOT', 'BLOCK', 'LOT', 'ADDRESS', 'OWNER1', 'OWNER2',
  'LANDUSE', 'LANDUSEDESC', 'ZONING', 'FULLCASH', 'ASSESSPREM',
  'LOTSIZE', 'YR_BUILT', 'NO_STRIES', 'BLDG_NO', 'NO_IMPS',
  'STRUCAREA', 'LTOAREA', 'SALEDATE', 'SALEPRICE',
].join(',');

async function fetchPage(baseUrl, offset = 0, count = 2000) {
  const params = new URLSearchParams({
    where: WHERE,
    outFields: OUT_FIELDS,
    returnGeometry: true,
    geometryType: 'esriGeometryPolygon',
    outSR: 4326,
    f: 'geojson',
    resultRecordCount: count,
    resultOffset: offset,
  });

  const res = await fetch(`${baseUrl}/query?${params}`, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

async function fetchAllFromEndpoint(baseUrl) {
  const allFeatures = [];
  let offset = 0;
  const pageSize = 2000;

  console.log(`  Trying: ${baseUrl}`);

  while (true) {
    const data = await fetchPage(baseUrl, offset, pageSize);
    if (!data.features?.length) break;

    allFeatures.push(...data.features);
    process.stdout.write(`\r  Fetched ${allFeatures.length} features...`);

    if (!data.exceededTransferLimit) break;
    offset += pageSize;

    // Rate limit courtesy delay
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\n  Total: ${allFeatures.length} features`);
  return allFeatures;
}

async function main() {
  console.log('\n🏙️  Baltimore Commercial Property Data Fetcher');
  console.log('='.repeat(50));

  let allFeatures = [];

  for (const endpoint of ENDPOINTS) {
    try {
      allFeatures = await fetchAllFromEndpoint(endpoint);
      if (allFeatures.length > 0) break;
    } catch (e) {
      console.warn(`  ✗ Failed: ${e.message}`);
    }
  }

  if (allFeatures.length === 0) {
    console.error('\n✗ All endpoints failed. Check network access or API availability.');
    process.exit(1);
  }

  // Clean up null geometries
  const valid = allFeatures.filter((f) => f.geometry !== null);
  console.log(`\n✓ Valid geometries: ${valid.length} / ${allFeatures.length}`);

  const geojson = {
    type: 'FeatureCollection',
    generatedAt: new Date().toISOString(),
    features: valid,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(geojson));

  const sizeKB = Math.round(Buffer.byteLength(JSON.stringify(geojson)) / 1024);
  console.log(`\n✓ Saved to: ${OUT_FILE} (${sizeKB} KB)\n`);
}

main().catch((e) => {
  console.error('\n✗ Fatal:', e.message);
  process.exit(1);
});
