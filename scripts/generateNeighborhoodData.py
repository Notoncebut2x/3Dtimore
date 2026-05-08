"""
Converts NSA shapefile to GeoJSON and enriches each neighborhood with:
- Demographics (from shapefile)
- Median income (from ACS census tracts via spatial join)
- Transit line counts (from OSM transit cache)
- Grocery store counts (from OSM grocery cache)
- Cultural amenity counts (from OSM cultural cache)
- Estimated walk score
"""
import json, math, urllib.request
import geopandas as gpd
from shapely.geometry import shape, Point, mapping
from shapely.ops import unary_union

SHAPEFILE = "data/Neighborhood_Statistical_Area_(NSA)_Boundaries/Neighborhood_Statistical_Area_(NSA)_Boundaries.shp"
TRANSIT_CACHE = "data/analysis_cache/transit_39.2748_-76.5921_5.json"
GROCERY_CACHE = "data/analysis_cache/grocery_39.2748_-76.5921_5.json"
CULTURAL_CACHE = "data/analysis_cache/cultural_39.2748_-76.5921_5.json"
ACS_CACHE = "data/analysis_cache/acs_baltimore_tracts.json"
OUTPUT = "public/data/neighborhoods.geojson"
SUPERMARKETS_OUTPUT = "public/data/supermarkets.json"

# Census TIGER tract boundaries for Baltimore City (FIPS 24510)
TIGER_URL = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/"
    "MapServer/8/query?where=STATE%3D'24'+AND+COUNTY%3D'510'"
    "&outFields=TRACT&outSR=4326&f=geojson"
)

def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.asin(math.sqrt(a))

SUPERMARKET_TYPES = {'supermarket', 'grocery'}

def is_supermarket(el):
    tags = el.get('tags', {})
    return tags.get('shop') in SUPERMARKET_TYPES or tags.get('amenity') in SUPERMARKET_TYPES

def points_within_polygon(elements, polygon, filter_fn=None):
    """Count OSM elements whose lat/lon fall within a shapely polygon."""
    count = 0
    for el in elements:
        if 'lat' not in el or 'lon' not in el:
            continue
        if filter_fn and not filter_fn(el):
            continue
        pt = Point(el['lon'], el['lat'])
        if polygon.contains(pt):
            count += 1
    return count

def points_within_km(elements, clat, clon, km, filter_fn=None):
    """Count OSM elements within km radius of centroid."""
    return sum(
        1 for el in elements
        if 'lat' in el
        and (not filter_fn or filter_fn(el))
        and haversine_km(clat, clon, el['lat'], el['lon']) <= km
    )

def count_transit_lines(elements, polygon, clat, clon):
    """
    Count transit lines within polygon and check each mode within 1.2km
    (~15-min walk) radius of neighborhood centroid.
    """
    bus_routes = set()
    has_light_rail = False
    has_subway = False
    bus_15min = False
    lr_15min = False
    subway_15min = False
    WALK_KM = 1.2  # ~15 min at 80m/min

    for el in elements:
        if 'lat' not in el or 'lon' not in el:
            continue
        tags = el.get('tags', {})
        el_lat, el_lon = el['lat'], el['lon']
        dist = haversine_km(clat, clon, el_lat, el_lon)
        in_poly = polygon.contains(Point(el_lon, el_lat))
        within_15min = dist <= WALK_KM

        is_lr = tags.get('light_rail') == 'yes' or tags.get('network', '').lower().find('light') >= 0
        is_sub = tags.get('subway') == 'yes' or tags.get('railway') in ('subway', 'metro')

        if in_poly:
            if is_lr:
                has_light_rail = True
            if is_sub:
                has_subway = True
            route_ref = tags.get('route_ref', '')
            if route_ref:
                for r in route_ref.split(';'):
                    r = r.strip()
                    if r and not r.startswith('LR') and not r.startswith('Metro'):
                        bus_routes.add(r)

        if within_15min:
            if is_lr:
                lr_15min = True
            elif is_sub:
                subway_15min = True
            elif tags.get('route_ref') or tags.get('bus') == 'yes':
                bus_15min = True

    return {
        'bus_lines': len(bus_routes),
        'light_rail': 1 if has_light_rail else 0,
        'subway': 1 if has_subway else 0,
        'total': len(bus_routes) + (1 if has_light_rail else 0) + (1 if has_subway else 0),
        'within_15min': {
            'bus': bus_15min,
            'light_rail': lr_15min,
            'subway': subway_15min
        }
    }

def estimate_walk_score(grocery_15, cultural_count, transit):
    """
    Rough walk score estimate: 0-100
    Based on grocery access, cultural density, and transit.
    """
    score = 0
    # Grocery (up to 40 pts)
    score += min(40, grocery_15 * 5)
    # Transit (up to 35 pts)
    score += min(20, transit['bus_lines'] * 2)
    score += transit['light_rail'] * 10
    score += transit['subway'] * 5
    # Cultural (up to 25 pts)
    score += min(25, cultural_count * 3)
    return min(100, score)

def load_acs_income():
    """Build a dict of tract_id -> median_income from ACS cache."""
    with open(ACS_CACHE) as f:
        rows = json.load(f)
    header = rows[0]
    income_idx = header.index('B19013_001E')
    tract_idx = header.index('tract')
    result = {}
    for row in rows[1:]:
        tract = row[tract_idx]
        try:
            income = int(row[income_idx])
            if income > 0:
                result[tract] = income
        except (ValueError, TypeError):
            pass
    return result

def fetch_tiger_tracts():
    """Fetch Baltimore City census tract geometries from Census TIGER."""
    print("  Fetching Census TIGER tract boundaries...")
    try:
        with urllib.request.urlopen(TIGER_URL, timeout=30) as r:
            data = json.load(r)
        tracts = []
        for feat in data.get('features', []):
            tract_id = feat['properties'].get('TRACT', '')
            geom = shape(feat['geometry'])
            tracts.append((tract_id, geom))
        print(f"  Got {len(tracts)} census tracts")
        return tracts
    except Exception as e:
        print(f"  TIGER fetch failed: {e} — income will be estimated")
        return []

def main():
    print("Reading NSA shapefile...")
    gdf = gpd.read_file(SHAPEFILE)
    gdf = gdf.to_crs("EPSG:4326")

    print("Loading OSM caches...")
    with open(TRANSIT_CACHE) as f:
        transit_elements = json.load(f)['elements']
    with open(GROCERY_CACHE) as f:
        grocery_elements = json.load(f)['elements']

    # Export supermarket locations as a standalone file
    supermarkets = [
        {
            "name": el.get('tags', {}).get('name', 'Supermarket'),
            "lat": el['lat'],
            "lon": el['lon']
        }
        for el in grocery_elements
        if 'lat' in el and is_supermarket(el)
    ]
    with open(SUPERMARKETS_OUTPUT, 'w') as f:
        json.dump(supermarkets, f)
    print(f"  Exported {len(supermarkets)} supermarkets to {SUPERMARKETS_OUTPUT}")
    with open(CULTURAL_CACHE) as f:
        cultural_elements = json.load(f)['elements']

    print("Loading ACS income data...")
    tract_income = load_acs_income()

    print("Fetching Census tract boundaries for income spatial join...")
    tiger_tracts = fetch_tiger_tracts()

    features = []
    total = len(gdf)
    for i, row in gdf.iterrows():
        name = row['Name']
        if i % 50 == 0:
            print(f"  Processing {i}/{total}: {name}")

        geom = row.geometry
        if geom is None or geom.is_empty:
            continue

        centroid = geom.centroid
        clat, clon = centroid.y, centroid.x

        def safe_int(val):
            try:
                v = float(val)
                return 0 if (v != v) else int(v)  # NaN check
            except (TypeError, ValueError):
                return 0

        # Population
        pop = safe_int(row.get('Population'))

        def pct(n, total): return round(n / total * 100, 1) if total > 0 else 0

        # Housing & occupancy
        total_units  = safe_int(row.get('Total_Unit'))
        occupied     = safe_int(row.get('Occ_Occupi'))
        vacant       = safe_int(row.get('Occ_Vacant'))
        owner        = safe_int(row.get('Tenure_Own'))
        renter       = safe_int(row.get('Tenure_Ren'))

        # Household composition (used as housing-type proxy)
        hh_total     = safe_int(row.get('HH_Total')) or 1
        hh_family    = safe_int(row.get('HH_Family'))
        hh_married   = safe_int(row.get('HH_Married'))
        hh_nonfamily = safe_int(row.get('HH_NonFami'))
        avg_hh_size  = round(pop / hh_total, 1) if hh_total > 0 else 0

        # Median income from TIGER spatial join
        median_income = None
        if tiger_tracts:
            best_overlap = 0
            for tract_id, tract_geom in tiger_tracts:
                try:
                    overlap = geom.intersection(tract_geom).area
                    if overlap > best_overlap:
                        best_overlap = overlap
                        if tract_id in tract_income:
                            median_income = tract_income[tract_id]
                except Exception:
                    pass

        # Fallback income estimate from owner-occupancy rate
        if median_income is None:
            owner_rate = owner / (total_units or 1)
            median_income = int(25000 + owner_rate * 75000)

        # Transit
        transit = count_transit_lines(transit_elements, geom, clat, clon)

        # Supermarkets only (exclude convenience stores)
        grocery_in_nbhd = points_within_polygon(grocery_elements, geom, is_supermarket)
        grocery_15min = points_within_km(grocery_elements, clat, clon, 9, is_supermarket)
        grocery_30min = points_within_km(grocery_elements, clat, clon, 20, is_supermarket)

        # Cultural amenities within neighborhood
        cultural_count = points_within_polygon(cultural_elements, geom)

        # Walk score
        walk_score = estimate_walk_score(grocery_15min, cultural_count, transit)

        features.append({
            "type": "Feature",
            "geometry": mapping(geom),
            "properties": {
                "name": name,
                "centroid": [round(clon, 6), round(clat, 6)],
                "population": pop,
                "median_income": median_income,
                "walk_score": walk_score,
                "household": {
                    "avg_size": avg_hh_size,
                    "total": hh_total,
                    "family_pct": pct(hh_family, hh_total),
                    "married_pct": pct(hh_married, hh_total),
                    "nonfamily_pct": pct(hh_nonfamily, hh_total)
                },
                "occupancy": {
                    "total_units": total_units,
                    "occupied_pct": pct(occupied, total_units),
                    "vacant_pct": pct(vacant, total_units),
                    "owner_pct": pct(owner, occupied or 1),
                    "renter_pct": pct(renter, occupied or 1)
                },
                "transit": transit,
                "grocery": {
                    "in_neighborhood": grocery_in_nbhd,
                    "within_15min_drive": grocery_15min,
                    "within_30min_drive": grocery_30min
                },
                "cultural_amenities": cultural_count
            }
        })

    out = {"type": "FeatureCollection", "features": features}
    with open(OUTPUT, 'w') as f:
        json.dump(out, f)
    print(f"\nDone. Wrote {len(features)} neighborhoods to {OUTPUT}")

if __name__ == "__main__":
    main()
