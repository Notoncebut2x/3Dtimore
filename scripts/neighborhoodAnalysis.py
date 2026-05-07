#!/usr/bin/env python3
"""
Neighborhood Analysis Pipeline — 3Dtimore
Calculates walkability/accessibility metrics for a target parcel.

Data sources:
  OSM Overpass API  — amenities, transit stops, cultural venues
  Census ACS 5-year — demographics by census tract
  MTA Maryland GTFS — bus & light-rail route names (optional, falls back to OSM)

Output:
  public/data/neighborhood-metrics.json

Usage:
  python scripts/neighborhoodAnalysis.py
  python scripts/neighborhoodAnalysis.py --lat 39.2748 --lon -76.5921 --label "1000 Hull St"
"""

import argparse
import json
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

# ── Target ────────────────────────────────────────────────────────────────────

DEFAULT_LAT     = 39.2748
DEFAULT_LON     = -76.5921
DEFAULT_LABEL   = "1000 Hull St, Locust Point"
DEFAULT_BLOCKLOT = "1976 001"

RADII_MI = [1, 5]

# ── Paths ─────────────────────────────────────────────────────────────────────

ROOT     = Path(__file__).parent.parent
OUT_FILE = ROOT / "public" / "data" / "neighborhood-metrics.json"
CACHE_DIR = ROOT / "data" / "analysis_cache"

# ── APIs ──────────────────────────────────────────────────────────────────────

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_HEADERS = {"User-Agent": "3Dtimore/1.0 (research; rpnealon@gmail.com)"}

# Census ACS 5-year 2022 — Baltimore City (state=24, county=510)
CENSUS_ACS_URL = "https://api.census.gov/data/2022/acs/acs5"
CENSUS_TIGER_TRACTS = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/"
    "tigerWMS_ACS2022/MapServer/6/query"
)

# Maryland MTA GTFS (bus + light rail)
MTA_GTFS_URLS = {
    "bus":        "https://feeds.mta.maryland.gov/gtfs/bus",
    "light_rail": "https://feeds.mta.maryland.gov/gtfs/light-rail",
    "metro":      "https://feeds.mta.maryland.gov/gtfs/metro",
    "commuter":   "https://feeds.mta.maryland.gov/gtfs/marc",
}

# ── Geometry helpers ──────────────────────────────────────────────────────────

def haversine_mi(lon1, lat1, lon2, lat2):
    R = 3958.8
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))


def radius_m(miles):
    return int(miles * 1609.34)


# ── Overpass helpers ──────────────────────────────────────────────────────────

def overpass(query: str, cache_key: str = None) -> dict:
    """Run an Overpass query, with simple file caching."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = CACHE_DIR / f"{cache_key}.json" if cache_key else None

    if cache_path and cache_path.exists():
        with open(cache_path) as f:
            return json.load(f)

    for attempt in range(3):
        try:
            r = requests.post(
                OVERPASS_URL,
                data={"data": query},
                headers=OVERPASS_HEADERS,
                timeout=90,
            )
            r.raise_for_status()
            data = r.json()
            if cache_path:
                with open(cache_path, "w") as f:
                    json.dump(data, f)
            return data
        except Exception as e:
            if attempt == 2:
                raise
            print(f"    Overpass retry {attempt + 1}: {e}")
            time.sleep(3 * (attempt + 1))


def elements_within(elements, lat, lon, max_mi):
    """Filter OSM elements to those within max_mi of (lat, lon)."""
    result = []
    for el in elements:
        elat = el.get("lat") or (el.get("center", {}) or {}).get("lat")
        elon = el.get("lon") or (el.get("center", {}) or {}).get("lon")
        if elat is None or elon is None:
            continue
        if haversine_mi(lon, lat, elon, elat) <= max_mi:
            result.append(el)
    return result


def bucket_by_radius(elements, lat, lon, radii_mi):
    """Return dict {radius_mi: [elements]} for each radius."""
    buckets = {r: [] for r in radii_mi}
    for el in elements:
        elat = el.get("lat") or (el.get("center", {}) or {}).get("lat")
        elon = el.get("lon") or (el.get("center", {}) or {}).get("lon")
        if elat is None or elon is None:
            continue
        d = haversine_mi(lon, lat, elon, elat)
        for r in sorted(radii_mi):
            if d <= r:
                buckets[r].append(el)
                break  # count in smallest bucket only; accumulate below
    # Accumulate: 5mi includes everything in 1mi
    sorted_r = sorted(radii_mi)
    for i in range(1, len(sorted_r)):
        buckets[sorted_r[i]].extend(buckets[sorted_r[i - 1]])
    return buckets


def name_list(elements, max_names=10):
    names = []
    for el in elements:
        tags = el.get("tags", {})
        name = tags.get("name") or tags.get("brand") or tags.get("operator")
        if name and name not in names:
            names.append(name)
        if len(names) >= max_names:
            break
    return names


# ── Step 1: Grocery stores ────────────────────────────────────────────────────

def fetch_grocery(lat, lon, max_radius_mi):
    print("  Querying grocery stores…")
    r = radius_m(max_radius_mi)
    query = f"""
[out:json][timeout:60];
(
  node["shop"~"^(supermarket|grocery|greengrocer|convenience|food)$"](around:{r},{lat},{lon});
  way ["shop"~"^(supermarket|grocery|greengrocer)$"](around:{r},{lat},{lon});
);
out center tags;
"""
    data = overpass(query, cache_key=f"grocery_{lat}_{lon}_{max_radius_mi}")
    return data.get("elements", [])


# ── Step 2: Transit ───────────────────────────────────────────────────────────

def fetch_transit(lat, lon, max_radius_mi):
    print("  Querying transit stops & routes…")
    r = radius_m(max_radius_mi)
    query = f"""
[out:json][timeout:60];
(
  node["highway"="bus_stop"](around:{r},{lat},{lon});
  node["public_transport"="stop_position"](around:{r},{lat},{lon});
  node["railway"~"^(station|halt|tram_stop|light_rail)$"](around:{r},{lat},{lon});
  node["amenity"="bus_station"](around:{r},{lat},{lon});
  relation["route"~"^(bus|tram|light_rail|subway|train)$"](around:{r},{lat},{lon});
);
out center tags;
"""
    data = overpass(query, cache_key=f"transit_{lat}_{lon}_{max_radius_mi}")
    return data.get("elements", [])


def parse_transit(elements, lat, lon, radii_mi):
    """Split transit elements into bus stops, rail stops, and route names."""
    bus_stops, rail_stops, bus_routes, rail_routes = [], [], set(), set()

    for el in elements:
        tags = el.get("tags", {})
        etype = el.get("type")

        elat = el.get("lat") or (el.get("center", {}) or {}).get("lat")
        elon = el.get("lon") or (el.get("center", {}) or {}).get("lon")

        if etype == "relation":
            route = tags.get("route", "")
            name = tags.get("name") or tags.get("ref") or ""
            if route in ("bus",):
                bus_routes.add(name)
            elif route in ("tram", "light_rail", "subway", "train"):
                rail_routes.add(name)
            continue

        if elat is None:
            continue

        highway = tags.get("highway", "")
        railway = tags.get("railway", "")
        pt = tags.get("public_transport", "")

        is_rail = railway in ("station", "halt", "tram_stop", "light_rail") or pt == "stop_position"
        is_bus = highway == "bus_stop" or tags.get("amenity") == "bus_station"

        if is_rail:
            rail_stops.append(el)
        elif is_bus:
            bus_stops.append(el)

    def count_by_radius(stops):
        out = {}
        for r in radii_mi:
            within = [s for s in stops
                      if haversine_mi(lon, lat,
                                      s.get("lon") or s.get("center", {}).get("lon", 0),
                                      s.get("lat") or s.get("center", {}).get("lat", 0)) <= r]
            out[f"{r}mi"] = len(within)
        return out

    return {
        "bus_stops":   count_by_radius(bus_stops),
        "rail_stops":  count_by_radius(rail_stops),
        "bus_routes":  sorted(r for r in bus_routes if r),
        "rail_routes": sorted(r for r in rail_routes if r),
    }


# ── Step 3: Schools ───────────────────────────────────────────────────────────

def fetch_schools(lat, lon, max_radius_mi):
    print("  Querying schools…")
    r = radius_m(max_radius_mi)
    query = f"""
[out:json][timeout:60];
(
  node["amenity"~"^(school|university|college|kindergarten)$"](around:{r},{lat},{lon});
  way ["amenity"~"^(school|university|college|kindergarten)$"](around:{r},{lat},{lon});
);
out center tags;
"""
    data = overpass(query, cache_key=f"schools_{lat}_{lon}_{max_radius_mi}")
    return data.get("elements", [])


# ── Step 4: Hospitals & healthcare ───────────────────────────────────────────

def fetch_hospitals(lat, lon, max_radius_mi):
    print("  Querying hospitals & clinics…")
    r = radius_m(max_radius_mi)
    query = f"""
[out:json][timeout:60];
(
  node["amenity"~"^(hospital|clinic|doctors|pharmacy)$"](around:{r},{lat},{lon});
  way ["amenity"~"^(hospital|clinic)$"](around:{r},{lat},{lon});
);
out center tags;
"""
    data = overpass(query, cache_key=f"hospitals_{lat}_{lon}_{max_radius_mi}")
    return data.get("elements", [])


# ── Step 5: Cultural anchors ──────────────────────────────────────────────────

def fetch_cultural(lat, lon, max_radius_mi):
    print("  Querying cultural anchors…")
    r = radius_m(max_radius_mi)
    query = f"""
[out:json][timeout:60];
(
  node["tourism"~"^(museum|gallery|attraction|artwork)$"](around:{r},{lat},{lon});
  way ["tourism"~"^(museum|gallery)$"](around:{r},{lat},{lon});
  node["leisure"~"^(stadium|sports_centre|arena)$"](around:{r},{lat},{lon});
  way ["leisure"~"^(stadium|sports_centre|arena)$"](around:{r},{lat},{lon});
  node["amenity"~"^(theatre|arts_centre|music_venue|cinema|nightclub)$"](around:{r},{lat},{lon});
  way ["amenity"~"^(theatre|arts_centre|music_venue|cinema)$"](around:{r},{lat},{lon});
  node["amenity"="place_of_worship"]["denomination"!=""]["name"](around:{r},{lat},{lon});
);
out center tags;
"""
    data = overpass(query, cache_key=f"cultural_{lat}_{lon}_{max_radius_mi}")
    return data.get("elements", [])


def parse_cultural(elements, lat, lon, radii_mi):
    def classify(tags):
        t = tags.get("tourism", "")
        l = tags.get("leisure", "")
        a = tags.get("amenity", "")
        if t in ("museum", "gallery"):                        return "museums"
        if l in ("stadium", "arena") or "stadium" in tags.get("name", "").lower():
            return "stadiums"
        if a in ("music_venue", "nightclub"):                 return "music_venues"
        if a in ("theatre", "arts_centre", "cinema"):        return "theatres"
        if t in ("attraction", "artwork"):                    return "attractions"
        return "other"

    categories = {}
    for el in elements:
        tags = el.get("tags", {})
        cat = classify(tags)
        elat = el.get("lat") or (el.get("center", {}) or {}).get("lat")
        elon = el.get("lon") or (el.get("center", {}) or {}).get("lon")
        if elat is None:
            continue
        d = haversine_mi(lon, lat, elon, elat)
        for r in radii_mi:
            key = f"{r}mi"
            if d <= r:
                if cat not in categories:
                    categories[cat] = {f"{r}mi": [] for r in radii_mi}
                name = tags.get("name", "")
                if name and name not in categories[cat][key]:
                    categories[cat][key].append(name)

    result = {}
    for cat, by_radius in categories.items():
        result[cat] = {k: {"count": len(v), "names": v[:8]} for k, v in by_radius.items()}
    return result


# ── Step 6: Food halls ────────────────────────────────────────────────────────

def fetch_food_halls(lat, lon, max_radius_mi):
    print("  Querying food halls & markets…")
    r = radius_m(max_radius_mi)
    query = f"""
[out:json][timeout:60];
(
  node["amenity"="food_court"](around:{r},{lat},{lon});
  way ["amenity"="food_court"](around:{r},{lat},{lon});
  node["shop"="mall"]["name"~"[Mm]arket|[Ff]ood [Hh]all|[Mm]arcado"](around:{r},{lat},{lon});
  way ["shop"="mall"]["name"~"[Mm]arket|[Ff]ood [Hh]all"](around:{r},{lat},{lon});
  node["amenity"="marketplace"](around:{r},{lat},{lon});
  way ["amenity"="marketplace"](around:{r},{lat},{lon});
  node["name"~"[Ff]ood [Hh]all|[Mm]arket|[Ff]armers [Mm]arket"](around:{r},{lat},{lon});
);
out center tags;
"""
    data = overpass(query, cache_key=f"food_halls_{lat}_{lon}_{max_radius_mi}")
    return data.get("elements", [])


# ── Step 7: ACS 5-year demographics ──────────────────────────────────────────

ACS_VARS = {
    "B01003_001E": "total_population",
    "B19013_001E": "median_household_income",
    "B17001_002E": "population_below_poverty",
    "B25003_001E": "total_housing_units",
    "B25003_002E": "owner_occupied_units",
    "B15003_022E": "bachelors_degree_or_higher",
    "B08301_001E": "total_commuters",
    "B08301_010E": "transit_commuters",
    "B01002_001E": "median_age",
}


def fetch_acs_tracts(lat, lon, max_radius_mi):
    """
    Fetch ACS 5-year data for all Baltimore City census tracts,
    then filter by centroid proximity and compute weighted averages.
    """
    print("  Fetching census tract boundaries…")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    tract_cache = CACHE_DIR / "acs_tracts_baltimore.json"

    # Step 1: get tract centroids from TIGER
    if not tract_cache.exists():
        try:
            r = requests.get(
                CENSUS_TIGER_TRACTS,
                params={
                    "where": "STATE='24' AND COUNTY='510'",
                    "outFields": "GEOID,CENTLAT,CENTLON,NAME",
                    "returnGeometry": "false",
                    "f": "json",
                },
                timeout=30,
            )
            r.raise_for_status()
            tracts_geo = r.json()
            with open(tract_cache, "w") as f:
                json.dump(tracts_geo, f)
        except Exception as e:
            print(f"    ⚠ TIGER tract fetch failed: {e}")
            return {}
    else:
        with open(tract_cache) as f:
            tracts_geo = json.load(f)

    # Step 2: collect tract GEOIDs within max radius
    features = tracts_geo.get("features", [])
    nearby = {}  # geoid -> distance_mi
    for feat in features:
        attrs = feat.get("attributes", {})
        geoid = str(attrs.get("GEOID", ""))
        tlat = attrs.get("CENTLAT")
        tlon = attrs.get("CENTLON")
        if tlat is None or tlon is None:
            continue
        d = haversine_mi(lon, lat, float(tlon), float(tlat))
        if d <= max_radius_mi:
            nearby[geoid] = d

    if not nearby:
        print("    ⚠ No tracts found within radius")
        return {}

    # Step 3: fetch ACS data for all Baltimore City tracts
    print(f"  Fetching ACS 5-year data ({len(nearby)} tracts within {max_radius_mi}mi)…")
    acs_cache = CACHE_DIR / "acs_baltimore_tracts.json"
    if not acs_cache.exists():
        try:
            get_vars = ",".join(ACS_VARS.keys())
            r = requests.get(
                CENSUS_ACS_URL,
                params={
                    "get": f"NAME,{get_vars}",
                    "for": "tract:*",
                    "in": "state:24 county:510",
                },
                timeout=30,
            )
            r.raise_for_status()
            acs_raw = r.json()
            with open(acs_cache, "w") as f:
                json.dump(acs_raw, f)
        except Exception as e:
            print(f"    ⚠ ACS fetch failed: {e}")
            return {}
    else:
        with open(acs_cache) as f:
            acs_raw = json.load(f)

    # Step 4: parse ACS response
    if not acs_raw or len(acs_raw) < 2:
        return {}
    headers = acs_raw[0]
    rows = acs_raw[1:]

    # Build index: geoid -> values
    var_keys = list(ACS_VARS.keys())
    tract_data = {}
    for row in rows:
        row_dict = dict(zip(headers, row))
        state = row_dict.get("state", "24")
        county = row_dict.get("county", "510")
        tract = row_dict.get("tract", "")
        geoid = f"{state}{county}{tract}"
        if geoid not in nearby:
            continue
        tract_data[geoid] = {
            ACS_VARS[v]: round(float(row_dict.get(v) or 0))
            for v in var_keys
            if row_dict.get(v) not in (None, "", "-666666666")
        }

    if not tract_data:
        return {}

    # Step 5: aggregate by radius (weighted by population)
    def aggregate(geoids):
        totals = {}
        total_pop = 0
        weighted_income = 0
        weighted_age = 0

        for gid in geoids:
            d = tract_data.get(gid, {})
            pop = d.get("total_population", 0)
            total_pop += pop
            weighted_income += d.get("median_household_income", 0) * pop
            weighted_age    += d.get("median_age", 0) * pop
            for k, v in d.items():
                if k not in ("median_household_income", "median_age"):
                    totals[k] = totals.get(k, 0) + v

        totals["total_population"] = total_pop
        if total_pop > 0:
            totals["median_household_income"] = round(weighted_income / total_pop)
            totals["median_age"] = round(weighted_age / total_pop, 1)
            totals["poverty_rate"] = round(
                totals.get("population_below_poverty", 0) / total_pop, 3
            )
            totals["owner_occupancy_rate"] = round(
                totals.get("owner_occupied_units", 0)
                / max(1, totals.get("total_housing_units", 1)), 3
            )
            totals["transit_commute_share"] = round(
                totals.get("transit_commuters", 0)
                / max(1, totals.get("total_commuters", 1)), 3
            )
        return totals

    result = {}
    for r in RADII_MI:
        geoids_in_r = [gid for gid, d in nearby.items() if d <= r]
        result[f"{r}mi"] = aggregate(geoids_in_r)

    return result


# ── Bucket helper for simple count metrics ────────────────────────────────────

def bucket_counts(elements, lat, lon, radii_mi, include_names=True):
    out = {}
    for r in radii_mi:
        within = elements_within(elements, lat, lon, r)
        entry = {"count": len(within)}
        if include_names:
            entry["names"] = name_list(within)
        out[f"{r}mi"] = entry
    return out


# ── Main ──────────────────────────────────────────────────────────────────────

def run(lat, lon, label, blocklot):
    print(f"\n{'='*60}")
    print(f"  Neighborhood Analysis Pipeline")
    print(f"  Target: {label} ({blocklot})")
    print(f"  Center: {lat}, {lon}")
    print(f"  Radii:  {RADII_MI} miles")
    print(f"{'='*60}\n")

    max_r = max(RADII_MI)
    metrics = {}

    # ── Grocery ──────────────────────────────────────────────────────────────
    print("[1/7] Grocery stores")
    try:
        grocery = fetch_grocery(lat, lon, max_r)
        metrics["grocery_stores"] = bucket_counts(grocery, lat, lon, RADII_MI)
        for r in RADII_MI:
            c = metrics["grocery_stores"][f"{r}mi"]["count"]
            print(f"       {r}mi: {c} stores")
    except Exception as e:
        print(f"  ⚠ {e}")
        metrics["grocery_stores"] = {}

    # ── Transit ───────────────────────────────────────────────────────────────
    print("[2/7] Transit")
    try:
        transit_els = fetch_transit(lat, lon, max_r)
        metrics["transit"] = parse_transit(transit_els, lat, lon, RADII_MI)
        for r in RADII_MI:
            bs = metrics["transit"]["bus_stops"].get(f"{r}mi", 0)
            rs = metrics["transit"]["rail_stops"].get(f"{r}mi", 0)
            print(f"       {r}mi: {bs} bus stops, {rs} rail stops")
        print(f"       Bus routes: {metrics['transit']['bus_routes']}")
        print(f"       Rail routes: {metrics['transit']['rail_routes']}")
    except Exception as e:
        print(f"  ⚠ {e}")
        metrics["transit"] = {}

    # ── Schools ───────────────────────────────────────────────────────────────
    print("[3/7] Schools")
    try:
        schools = fetch_schools(lat, lon, max_r)
        metrics["schools"] = bucket_counts(schools, lat, lon, RADII_MI)
        for r in RADII_MI:
            c = metrics["schools"][f"{r}mi"]["count"]
            print(f"       {r}mi: {c} schools")
    except Exception as e:
        print(f"  ⚠ {e}")
        metrics["schools"] = {}

    # ── Hospitals ─────────────────────────────────────────────────────────────
    print("[4/7] Hospitals & clinics")
    try:
        hospitals = fetch_hospitals(lat, lon, max_r)
        # Separate hospitals from clinics/pharmacies
        hosp_only = [e for e in hospitals
                     if e.get("tags", {}).get("amenity") in ("hospital",)]
        clinic_only = [e for e in hospitals
                       if e.get("tags", {}).get("amenity") in ("clinic", "doctors", "pharmacy")]
        metrics["hospitals"] = bucket_counts(hosp_only, lat, lon, RADII_MI)
        metrics["clinics_pharmacies"] = bucket_counts(clinic_only, lat, lon, RADII_MI)
        for r in RADII_MI:
            h = metrics["hospitals"][f"{r}mi"]["count"]
            c = metrics["clinics_pharmacies"][f"{r}mi"]["count"]
            print(f"       {r}mi: {h} hospitals, {c} clinics/pharmacies")
    except Exception as e:
        print(f"  ⚠ {e}")
        metrics["hospitals"] = {}

    # ── Cultural ──────────────────────────────────────────────────────────────
    print("[5/7] Cultural anchors")
    try:
        cultural = fetch_cultural(lat, lon, max_r)
        metrics["cultural"] = parse_cultural(cultural, lat, lon, RADII_MI)
        for cat, by_r in metrics["cultural"].items():
            for r in RADII_MI:
                c = by_r.get(f"{r}mi", {}).get("count", 0)
                if c:
                    print(f"       {r}mi {cat}: {c}")
    except Exception as e:
        print(f"  ⚠ {e}")
        metrics["cultural"] = {}

    # ── Food halls ────────────────────────────────────────────────────────────
    print("[6/7] Food halls & markets")
    try:
        food = fetch_food_halls(lat, lon, max_r)
        metrics["food_halls"] = bucket_counts(food, lat, lon, RADII_MI)
        for r in RADII_MI:
            c = metrics["food_halls"][f"{r}mi"]["count"]
            print(f"       {r}mi: {c} food halls/markets")
    except Exception as e:
        print(f"  ⚠ {e}")
        metrics["food_halls"] = {}

    # ── ACS Demographics ──────────────────────────────────────────────────────
    print("[7/7] ACS 5-year demographics")
    try:
        demographics = fetch_acs_tracts(lat, lon, max_r)
        metrics["demographics"] = demographics
        for r in RADII_MI:
            d = demographics.get(f"{r}mi", {})
            pop = d.get("total_population", "?")
            inc = d.get("median_household_income", "?")
            pov = d.get("poverty_rate", "?")
            print(f"       {r}mi: pop={pop:,} | med_income=${inc:,} | poverty={pov:.1%}"
                  if isinstance(pop, int) and isinstance(inc, int) and isinstance(pov, float)
                  else f"       {r}mi: {d}")
    except Exception as e:
        print(f"  ⚠ {e}")
        metrics["demographics"] = {}

    # ── Write output ──────────────────────────────────────────────────────────
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    output = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "target": {
            "blocklot": blocklot,
            "label": label,
            "lat": lat,
            "lon": lon,
        },
        "radii_mi": RADII_MI,
        "metrics": metrics,
    }

    with open(OUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n✓ Written: {OUT_FILE}")
    print(f"  ({OUT_FILE.stat().st_size // 1024} KB)\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Neighborhood analysis pipeline")
    parser.add_argument("--lat",      type=float, default=DEFAULT_LAT)
    parser.add_argument("--lon",      type=float, default=DEFAULT_LON)
    parser.add_argument("--label",    default=DEFAULT_LABEL)
    parser.add_argument("--blocklot", default=DEFAULT_BLOCKLOT)
    parser.add_argument("--no-cache", action="store_true",
                        help="Ignore cached Overpass responses")
    args = parser.parse_args()

    if args.no_cache:
        import shutil
        if CACHE_DIR.exists():
            shutil.rmtree(CACHE_DIR)
            print("Cache cleared.\n")

    run(args.lat, args.lon, args.label, args.blocklot)
