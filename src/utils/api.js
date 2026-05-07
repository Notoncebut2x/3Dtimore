// Baltimore City ArcGIS Feature Service endpoints (try in order)
const ENDPOINTS = [
  'https://services1.arcgis.com/UWYHeuuJISiGmgXx/arcgis/rest/services/RealProperty/FeatureServer/0',
  'https://geodata.baltimorecity.gov/egis/rest/services/Planning/Realproperty/MapServer/0',
];

const COMMERCIAL_WHERE = [
  "LANDUSEDESC LIKE '%COMMERCIAL%'",
  "LANDUSEDESC LIKE '%OFFICE%'",
  "LANDUSEDESC LIKE '%INDUSTRIAL%'",
  "LANDUSEDESC LIKE '%HOTEL%'",
  "LANDUSEDESC LIKE '%MIXED%'",
  "LANDUSEDESC LIKE '%ENTERTAINMENT%'",
  "FULLCASH > 2000000",
].join(' OR ');

const OUT_FIELDS = [
  'BLOCKLOT', 'BLOCK', 'LOT', 'ADDRESS', 'OWNER1', 'OWNER2',
  'LANDUSE', 'LANDUSEDESC', 'ZONING', 'FULLCASH', 'ASSESSPREM',
  'LOTSIZE', 'YR_BUILT', 'NO_STRIES', 'BLDG_NO', 'NO_IMPS',
  'STRUCAREA', 'LTOAREA', 'SALEDATE', 'SALEPRICE',
].join(',');

async function queryEndpoint(baseUrl, params) {
  const url = `${baseUrl}/query?${new URLSearchParams(params)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchCommercialProperties() {
  const params = {
    where: COMMERCIAL_WHERE,
    outFields: OUT_FIELDS,
    returnGeometry: true,
    geometryType: 'esriGeometryPolygon',
    outSR: 4326,
    f: 'geojson',
    resultRecordCount: 5000,
  };

  for (const endpoint of ENDPOINTS) {
    try {
      const data = await queryEndpoint(endpoint, params);
      if (data.features?.length > 0) return data;
    } catch (e) {
      console.warn(`Endpoint failed: ${endpoint}`, e.message);
    }
  }
  throw new Error('All endpoints failed');
}

export async function fetchByBlocklot(blocklot) {
  const params = {
    where: `BLOCKLOT = '${blocklot}'`,
    outFields: '*',
    returnGeometry: true,
    outSR: 4326,
    f: 'geojson',
    resultRecordCount: 1,
  };

  for (const endpoint of ENDPOINTS) {
    try {
      const data = await queryEndpoint(endpoint, params);
      if (data.features?.length > 0) return data.features[0];
    } catch (e) {
      console.warn(`Endpoint failed: ${endpoint}`, e.message);
    }
  }
  return null;
}

// Approximate bounding box of Baltimore City
export async function fetchByBBox(west, south, east, north) {
  const geometry = JSON.stringify({ xmin: west, ymin: south, xmax: east, ymax: north, spatialReference: { wkid: 4326 } });
  const params = {
    where: COMMERCIAL_WHERE,
    geometry,
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: OUT_FIELDS,
    returnGeometry: true,
    outSR: 4326,
    f: 'geojson',
    resultRecordCount: 2000,
  };

  for (const endpoint of ENDPOINTS) {
    try {
      const data = await queryEndpoint(endpoint, params);
      if (data.features?.length >= 0) return data;
    } catch (e) {
      console.warn(`Endpoint failed: ${endpoint}`, e.message);
    }
  }
  throw new Error('All endpoints failed');
}

// Helper: create a rectangular GeoJSON polygon from center + dimensions
function makeRect(lng, lat, widthM, heightM) {
  const dlat = (heightM / 2) / 111000;
  const dlng = (widthM / 2) / (111000 * Math.cos((lat * Math.PI) / 180));
  return {
    type: 'Polygon',
    coordinates: [[
      [lng - dlng, lat - dlat],
      [lng + dlng, lat - dlat],
      [lng + dlng, lat + dlat],
      [lng - dlng, lat + dlat],
      [lng - dlng, lat - dlat],
    ]],
  };
}

// Real polygon geometry for BLOCKLOT 1976 001 — sourced from Baltimore Real Property GeoJSON
const BLOCKLOT_1976_001_GEOMETRY = {
  type: 'Polygon',
  coordinates: [[
    [-76.58997216598192, 39.27565266636016],
    [-76.58989146828505, 39.27579023748242],
    [-76.58984326974462, 39.27587235271474],
    [-76.58990885402302, 39.275892953346364],
    [-76.58996911022273, 39.275790234443555],
    [-76.59013735831965, 39.27550341899014],
    [-76.59074940261156, 39.27568439670953],
    [-76.59068725508484, 39.275790379113865],
    [-76.59058950627421, 39.27595691086473],
    [-76.5920352524114,  39.27619918255073],
    [-76.59235095850241, 39.27566305943807],
    [-76.59261658923475, 39.275202785623755],
    [-76.59288078270855, 39.27528837493914],
    [-76.59310570110304, 39.27489871132104],
    [-76.59314427347357, 39.27483111195632],
    [-76.59315335679733, 39.27481807589115],
    [-76.59327956217571, 39.27465899663143],
    [-76.59331089159974, 39.27461714591865],
    [-76.59334555915686, 39.27458271417235],
    [-76.59338187015202, 39.2745493213061],
    [-76.59341977366945, 39.274517015287834],
    [-76.59345921519262, 39.27448584126175],
    [-76.59347994355979, 39.27447033065269],
    [-76.59348092969769, 39.27446961855675],
    [-76.59350325430435, 39.27445360319371],
    [-76.59351562405398, 39.274444924945996],
    [-76.59347578565122, 39.27438857109469],
    [-76.59334111925874, 39.27440273629483],
    [-76.59320611010187, 39.27441476944029],
    [-76.5930708138375,  39.27442466509978],
    [-76.5929352865648,  39.27443241960102],
    [-76.5927995843828,  39.274438029271906],
    [-76.5926637633807,  39.2744414921978],
    [-76.5925278796458,  39.27444280681574],
    [-76.59244953138888, 39.274442686792824],
    [-76.59237122722202, 39.27444063752599],
    [-76.59229304626712, 39.27443666069581],
    [-76.59221506672979, 39.27443076008828],
    [-76.59213736634719, 39.27442294229938],
    [-76.59206002420882, 39.27441321463298],
    [-76.59198311757936, 39.27440158719815],
    [-76.59190672326501, 39.27438807115679],
    [-76.59183091850575, 39.27437268083561],
    [-76.59175577918106, 39.27435543125934],
    [-76.59168138070571, 39.27433633956002],
    [-76.59154111982711, 39.274285914862084],
    [-76.59152896807096, 39.27430671901301],
    [-76.59152543561599, 39.27430551608656],
    [-76.59139601450363, 39.27426146623065],
    [-76.59141360186419, 39.274231491487605],
    [-76.59090696075944, 39.27405901073751],
    [-76.59007116605576, 39.275483859401476],
    [-76.58997216598192, 39.27565266636016],
  ]],
};

// Curated sample dataset — anchored on real Baltimore parcels
export function getSampleData() {
  const properties = [
    {
      // Real data sourced from Baltimore Real Property GeoJSON
      BLOCKLOT: '1976 001',
      FULLADDR: '1000 HULL ST',
      OWNER_1: 'UA LOCUST POINT HOLDINGS, LLC',
      LANDUSEDESC: 'INDUSTRIAL - COMMERCIAL',
      ZONECODE: 'C-2*',
      USEGROUP: 'I',
      ARTAXBAS: 37174100,
      TAXBASE: 37174100,
      CURRLAND: 9746000,
      CURRIMPR: 27428100,
      SALEPRIC: 58000000,
      SALEDATE: '07062011',
      LOT_SIZE: '9.746 ACRES',
      YEAR_BUILD: 1929,
      STRUCTAREA: null,
      NEIGHBOR: 'LOCUST POINT INDUSTRIAL AREA',
      ZIP_CODE: '21230',
      _featured: true,
      _geometry: BLOCKLOT_1976_001_GEOMETRY,
    },
    {
      BLOCKLOT: '1987B010', FULLADDR: '1100 KEY HIGHWAY EAST', OWNER_1: 'ASR BALTIMORE REFINERY LLC',
      LANDUSEDESC: 'COMMERCIAL', ZONECODE: 'C-2', ARTAXBAS: 24078233,
      YEAR_BUILD: 1922, LOT_SIZE: '2.1 ACRES',
      _center: [-76.5947, 39.2741], _w: 200, _h: 170,
    },
    {
      BLOCKLOT: '1827 003', FULLADDR: '901 S BOND ST', OWNER_1: 'BOND STREET WHARF LLC',
      LANDUSEDESC: 'COMMERCIAL - MIXED USE', ZONECODE: 'C-2', ARTAXBAS: 38872700,
      YEAR_BUILD: 2002, LOT_SIZE: '1.8 ACRES',
      _center: [-76.5942, 39.2807], _w: 150, _h: 120,
    },
    {
      BLOCKLOT: '1875 002', FULLADDR: '915 S WOLFE ST', OWNER_1: 'VA8 UNION WHARF LLC',
      LANDUSEDESC: 'COMMERCIAL - MIXED USE', ZONECODE: 'C-2', ARTAXBAS: 70890000,
      YEAR_BUILD: 2014, LOT_SIZE: '3.2 ACRES',
      _center: [-76.5887, 39.2815], _w: 160, _h: 140,
    },
    {
      BLOCKLOT: '1815 002', FULLADDR: '1000 WILLS ST', OWNER_1: 'HARBOR POINT PARCEL 2 HOLDINGS',
      LANDUSEDESC: 'COMMERCIAL - OFFICE', ZONECODE: 'C-2', ARTAXBAS: 184727133,
      YEAR_BUILD: 2016, LOT_SIZE: '4.5 ACRES',
      _center: [-76.5982, 39.2811], _w: 180, _h: 160,
    },
    {
      BLOCKLOT: '2014A001', FULLADDR: '900 E FORT AVE', OWNER_1: '900 EAST FORT AVENUE LLC',
      LANDUSEDESC: 'COMMERCIAL - MIXED USE', ZONECODE: 'C-2', ARTAXBAS: 76924533,
      YEAR_BUILD: 2017, LOT_SIZE: '2.8 ACRES',
      _center: [-76.6000, 39.2718], _w: 170, _h: 140,
    },
    {
      BLOCKLOT: '1900 003', FULLADDR: '100 LIGHT ST', OWNER_1: 'ONE LIGHT STREET LLC',
      LANDUSEDESC: 'COMMERCIAL - OFFICE', ZONECODE: 'B-4-2', ARTAXBAS: 62000000,
      YEAR_BUILD: 1972, LOT_SIZE: '0.5 ACRES',
      _center: [-76.6133, 39.2898], _w: 70, _h: 90,
    },
    {
      BLOCKLOT: '1803 002', ADDRESS: '100 INTERNATIONAL DR', OWNER1: 'T ROWE PRICE REALTY LLC',
      LANDUSEDESC: 'COMMERCIAL - OFFICE', ZONING: 'B-4-2', FULLCASH: 82000000,
      LOTSIZE: 38000, YR_BUILT: 2009, NO_STRIES: 28, STRUCAREA: 1200000,
      _center: [-76.6092, 39.2908], _w: 90, _h: 110,
    },
    {
      BLOCKLOT: '2001 005', ADDRESS: '101 W FAYETTE ST', OWNER1: 'RENAISSANCE HOTEL LLC',
      LANDUSEDESC: 'COMMERCIAL - HOTELS AND MOTELS', ZONING: 'B-4-2', FULLCASH: 95000000,
      LOTSIZE: 42000, YR_BUILT: 1983, NO_STRIES: 32, STRUCAREA: 1400000,
      _center: [-76.6151, 39.2855], _w: 95, _h: 115,
    },
    {
      BLOCKLOT: '1869 001', ADDRESS: '650 S EXETER ST', OWNER1: 'HARBOR EAST DEVELOPMENT LLC',
      LANDUSEDESC: 'COMMERCIAL - RETAIL', ZONING: 'B-3-2', FULLCASH: 28000000,
      LOTSIZE: 18000, YR_BUILT: 2005, NO_STRIES: 4, STRUCAREA: 72000,
      _center: [-76.6089, 39.2873], _w: 65, _h: 80,
    },
    {
      BLOCKLOT: '1980 008', ADDRESS: '200 W PRATT ST', OWNER1: 'HARBORPLACE ASSOCIATES LLC',
      LANDUSEDESC: 'COMMERCIAL - ENTERTAINMENT', ZONING: 'B-2-2', FULLCASH: 32000000,
      LOTSIZE: 35000, YR_BUILT: 1980, NO_STRIES: 5, STRUCAREA: 175000,
      _center: [-76.6140, 39.2875], _w: 110, _h: 80,
    },
    {
      BLOCKLOT: '1750 001', ADDRESS: '100 N CHARLES ST', OWNER1: 'CHARLES CENTER LLC',
      LANDUSEDESC: 'COMMERCIAL - OFFICE', ZONING: 'B-4-2', FULLCASH: 35000000,
      LOTSIZE: 20000, YR_BUILT: 1969, NO_STRIES: 20, STRUCAREA: 500000,
      _center: [-76.6145, 39.2920], _w: 65, _h: 75,
    },
    {
      BLOCKLOT: '1650 001', ADDRESS: '700 N CALVERT ST', OWNER1: 'MOUNT VERNON PROPERTIES LLC',
      LANDUSEDESC: 'MIXED COMMERCIAL/RESIDENTIAL', ZONING: 'O-R-3', FULLCASH: 15000000,
      LOTSIZE: 15000, YR_BUILT: 1965, NO_STRIES: 8, STRUCAREA: 120000,
      _center: [-76.6170, 39.2935], _w: 55, _h: 70,
    },
    {
      BLOCKLOT: '1720 002', ADDRESS: '200 N GAY ST', OWNER1: 'OLD TOWN MARKET LLC',
      LANDUSEDESC: 'COMMERCIAL - RETAIL', ZONING: 'B-2-2', FULLCASH: 12000000,
      LOTSIZE: 25000, YR_BUILT: 1975, NO_STRIES: 3, STRUCAREA: 75000,
      _center: [-76.6075, 39.2924], _w: 75, _h: 90,
    },
    {
      BLOCKLOT: '1600 003', ADDRESS: '301 N CHARLES ST', OWNER1: 'NORTHCHARLES ENTERTAINMENT LLC',
      LANDUSEDESC: 'COMMERCIAL - ENTERTAINMENT', ZONING: 'B-2-2', FULLCASH: 9500000,
      LOTSIZE: 12000, YR_BUILT: 1958, NO_STRIES: 5, STRUCAREA: 60000,
      _center: [-76.6127, 39.2948], _w: 50, _h: 65,
    },
    {
      BLOCKLOT: '1820 001', ADDRESS: '600 E PRATT ST', OWNER1: 'EAST HARBOR HOTEL LLC',
      LANDUSEDESC: 'COMMERCIAL - HOTELS AND MOTELS', ZONING: 'B-3-2', FULLCASH: 25000000,
      LOTSIZE: 19000, YR_BUILT: 1995, NO_STRIES: 12, STRUCAREA: 228000,
      _center: [-76.6058, 39.2906], _w: 65, _h: 80,
    },
    {
      BLOCKLOT: '1700 005', ADDRESS: '100 E LOMBARD ST', OWNER1: 'MERCHANT SQUARE LLC',
      LANDUSEDESC: 'MIXED COMMERCIAL/RESIDENTIAL', ZONING: 'O-R-2', FULLCASH: 18500000,
      LOTSIZE: 17500, YR_BUILT: 1988, NO_STRIES: 7, STRUCAREA: 122500,
      _center: [-76.6110, 39.2930], _w: 60, _h: 75,
    },
    {
      BLOCKLOT: '2100 004', ADDRESS: '100 COVINGTON ST', OWNER1: 'FEDERAL HILL COMMERCIAL LLC',
      LANDUSEDESC: 'COMMERCIAL - RETAIL', ZONING: 'B-2-1', FULLCASH: 8500000,
      LOTSIZE: 14000, YR_BUILT: 1962, NO_STRIES: 3, STRUCAREA: 42000,
      _center: [-76.6123, 39.2841], _w: 55, _h: 70,
    },
    {
      BLOCKLOT: '1500 007', ADDRESS: '10 E NORTH AVE', OWNER1: 'MIDTOWN DEVELOPMENT LLC',
      LANDUSEDESC: 'INDUSTRIAL - WAREHOUSE', ZONING: 'I-1', FULLCASH: 4200000,
      LOTSIZE: 45000, YR_BUILT: 1948, NO_STRIES: 2, STRUCAREA: 90000,
      _center: [-76.6200, 39.2960], _w: 120, _h: 130,
    },
    {
      BLOCKLOT: '2200 002', ADDRESS: '201 KEY HWY', OWNER1: 'SOUTH HARBOR LLC',
      LANDUSEDESC: 'COMMERCIAL - RETAIL', ZONING: 'B-2-2', FULLCASH: 6800000,
      LOTSIZE: 11000, YR_BUILT: 2001, NO_STRIES: 2, STRUCAREA: 22000,
      _center: [-76.6098, 39.2828], _w: 50, _h: 65,
    },
    {
      BLOCKLOT: '1855 003', ADDRESS: '400 E PRATT ST', OWNER1: 'PIER 5 HOTEL LLC',
      LANDUSEDESC: 'COMMERCIAL - HOTELS AND MOTELS', ZONING: 'B-4-2', FULLCASH: 38000000,
      LOTSIZE: 24000, YR_BUILT: 2001, NO_STRIES: 14, STRUCAREA: 336000,
      _center: [-76.6072, 39.2867], _w: 70, _h: 85,
    },
    {
      BLOCKLOT: '1930 001', ADDRESS: '300 W PRATT ST', OWNER1: 'BALTIMORE CONVENTION CTR LLC',
      LANDUSEDESC: 'COMMERCIAL - ENTERTAINMENT', ZONING: 'B-4-2', FULLCASH: 120000000,
      LOTSIZE: 95000, YR_BUILT: 1979, NO_STRIES: 4, STRUCAREA: 380000,
      _center: [-76.6155, 39.2862], _w: 200, _h: 140,
    },
    {
      BLOCKLOT: '1785 002', ADDRESS: '200 S CHARLES ST', OWNER1: 'BALT GAS ELECTRIC LLC',
      LANDUSEDESC: 'COMMERCIAL - OFFICE', ZONING: 'B-4-2', FULLCASH: 55000000,
      LOTSIZE: 30000, YR_BUILT: 1916, NO_STRIES: 21, STRUCAREA: 630000,
      _center: [-76.6131, 39.2890], _w: 75, _h: 90,
    },
    {
      BLOCKLOT: '1910 006', ADDRESS: '1 N CHARLES ST', OWNER1: 'LEGG MASON REALTY LLC',
      LANDUSEDESC: 'COMMERCIAL - OFFICE', ZONING: 'B-4-2', FULLCASH: 72000000,
      LOTSIZE: 26000, YR_BUILT: 2009, NO_STRIES: 26, STRUCAREA: 676000,
      _center: [-76.6121, 39.2912], _w: 72, _h: 88,
    },
    {
      BLOCKLOT: '1670 001', ADDRESS: '500 N CHARLES ST', OWNER1: 'TREMONT HOTEL LLC',
      LANDUSEDESC: 'COMMERCIAL - HOTELS AND MOTELS', ZONING: 'B-3-2', FULLCASH: 22000000,
      LOTSIZE: 16000, YR_BUILT: 1967, NO_STRIES: 10, STRUCAREA: 160000,
      _center: [-76.6148, 39.2941], _w: 58, _h: 72,
    },
  ];

  const features = properties.map(({ _center, _w, _h, _featured, _geometry, ...props }) => ({
    type: 'Feature',
    geometry: _geometry || makeRect(_center[0], _center[1], _w, _h),
    properties: props,
  }));

  return { type: 'FeatureCollection', features };
}
