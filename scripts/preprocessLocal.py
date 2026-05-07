#!/usr/bin/env python3
"""
Preprocesses Baltimore Real Property GeoJSON into a browser-ready subset.

Input:  data/Real_Property_Information.geojson   (563 MB)
Output: public/data/commercial-properties.geojson

Run: python scripts/preprocessLocal.py
"""

import json, sys, os
from pathlib import Path

ROOT     = Path(__file__).parent.parent
IN_FILE  = ROOT / "data" / "Real_Property_Information.geojson"
OUT_DIR  = ROOT / "public" / "data"
OUT_FILE = OUT_DIR / "commercial-properties.geojson"

COMMERCIAL_USEGROUPS = {"C", "I", "M", "CC", "OR"}
MIN_VALUE = 500_000

KEEP_PROPS = [
    "OBJECTID", "BLOCKLOT", "FULLADDR", "OWNER_1", "OWNER_2",
    "USEGROUP", "ZONECODE", "ARTAXBAS", "TAXBASE", "CURRLAND", "CURRIMPR",
    "LOT_SIZE", "YEAR_BUILD", "STRUCTAREA", "SALEPRIC", "SALEDATE",
    "NEIGHBOR", "ZIP_CODE", "SDATLINK", "DHCDUSE1",
]

def keep(props):
    ug    = (props.get("USEGROUP") or "").strip().upper()
    value = props.get("ARTAXBAS") or props.get("FULLCASH") or props.get("TAXBASE") or 0
    return ug in COMMERCIAL_USEGROUPS or value >= MIN_VALUE

def slim(props):
    return {k: props.get(k) for k in KEEP_PROPS}

print("\n  Baltimore Real Property Preprocessor")
print("=" * 50)
print(f"Input:  {IN_FILE}")
print(f"Output: {OUT_FILE}\n")

if not IN_FILE.exists():
    sys.exit(f"ERROR: {IN_FILE} not found")

OUT_DIR.mkdir(parents=True, exist_ok=True)

try:
    import ijson
    USE_IJSON = True
except ImportError:
    USE_IJSON = False

if USE_IJSON:
    print("Streaming with ijson…")
    total = kept = 0
    features_out = []

    with open(IN_FILE, "rb") as f:
        for feature in ijson.items(f, "features.item"):
            total += 1
            if total % 10_000 == 0:
                print(f"\r  Scanned {total:,}  kept {kept:,}…", end="", flush=True)
            geom = feature.get("geometry")
            if not geom:
                continue
            if geom.get("type") not in ("Polygon", "MultiPolygon"):
                continue
            props = feature.get("properties") or {}
            if not keep(props):
                continue
            features_out.append({"type": "Feature", "geometry": geom, "properties": slim(props)})
            kept += 1

else:
    # Fallback: line-by-line scan — works because each feature is on one line
    # in Baltimore's GeoJSON export.
    print("ijson not available, using line-by-line fallback…")
    total = kept = 0
    features_out = []

    with open(IN_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip().rstrip(",")
            if not line.startswith('{"type":"Feature"') and not line.startswith('{ "type": "Feature"'):
                continue
            total += 1
            if total % 10_000 == 0:
                print(f"\r  Scanned {total:,}  kept {kept:,}…", end="", flush=True)
            try:
                feature = json.loads(line)
            except json.JSONDecodeError:
                continue
            geom = feature.get("geometry")
            if not geom or geom.get("type") not in ("Polygon", "MultiPolygon"):
                continue
            props = feature.get("properties") or {}
            if not keep(props):
                continue
            features_out.append({"type": "Feature", "geometry": geom, "properties": slim(props)})
            kept += 1

print(f"\r{' ' * 60}\r", end="")
print(f"Scanned:  {total:,}")
print(f"Kept:     {kept:,}")

output = {
    "type": "FeatureCollection",
    "generatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    "sourceFile": "Real_Property_Information.geojson",
    "features": features_out,
}

import decimal

class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, decimal.Decimal):
            return float(o)
        return super().default(o)

with open(OUT_FILE, "w") as f:
    json.dump(output, f, separators=(",", ":"), cls=DecimalEncoder)

size_mb = OUT_FILE.stat().st_size / 1024 / 1024
print(f"\n  Written: {OUT_FILE}  ({size_mb:.1f} MB)")
print("  Restart npm run dev — the app will load this file automatically.\n")
