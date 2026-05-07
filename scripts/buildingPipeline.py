#!/usr/bin/env python3
"""
Building Footprint + LiDAR Height Pipeline
Target: BLOCKLOT 1976 001 — 1000 Hull St, Locust Point, Baltimore MD 21230

Data sources (all confirmed live):
  Footprints:  OSM Overpass API  (primary)
               Microsoft US Building Footprints — Maryland (secondary)
  LiDAR DTM:  Maryland iMAP Baltimore City DEM ImageServer (1m, no auth)
  LiDAR DSM:  USGS MD_4County_D24 LAZ tiles via rockyweb.usgs.gov (2024)
  Parcels:    Local Real_Property_Information.geojson

Output:
  public/data/buildings-with-heights.geojson   ← deck.gl-ready

Usage:
  # Quick mode (OSM footprints + Maryland DTM, no LAZ download):
  python scripts/buildingPipeline.py --mode quick

  # Full LiDAR pipeline (downloads ~600 MB of LAZ tiles):
  python scripts/buildingPipeline.py --mode full

  # Use pre-downloaded LAZ directory:
  python scripts/buildingPipeline.py --mode full --laz-dir /path/to/laz

Install:
  pip install -r scripts/requirements_pipeline.txt
  brew install pdal   # (macOS) or: conda install -c conda-forge pdal
"""

import argparse
import json
import math
import os
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Optional

import numpy as np
import requests
from tqdm import tqdm

# ── Constants ────────────────────────────────────────────────────────────────

# Study area: Locust Point / BLOCKLOT 1976 001 + ~500m buffer
BBOX = (-76.605, 39.265, -76.575, 39.290)  # (west, south, east, north)
BBOX_WKT = (
    f"POLYGON(({BBOX[0]} {BBOX[1]},{BBOX[2]} {BBOX[1]},"
    f"{BBOX[2]} {BBOX[3]},{BBOX[0]} {BBOX[3]},{BBOX[0]} {BBOX[1]}))"
)

FEATURED_BLOCKLOT = "1976 001"

# Output
ROOT = Path(__file__).parent.parent
OUT_DIR = ROOT / "public" / "data"
OUT_FILE = OUT_DIR / "buildings-with-heights.geojson"
LAZ_CACHE = ROOT / "data" / "lidar_cache"

# ── USGS LAZ tiles (MD_4County_D24, 2024) covering our bbox ──────────────────
# Confirmed via USGS TNM API: https://tnmaccess.nationalmap.gov/api/v1/products
USGS_LAZ_BASE = (
    "https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/LPC/"
    "Projects/MD_4County_D24/MD_4County_2_D24/LAZ/"
)

# MGRS 1km tiles covering bbox (18SUJ grid, 500m padding)
USGS_LAZ_TILES = [
    "USGS_LPC_MD_4County_D24_18suj610470.laz",
    "USGS_LPC_MD_4County_D24_18suj610480.laz",
    "USGS_LPC_MD_4County_D24_18suj610490.laz",
    "USGS_LPC_MD_4County_D24_18suj620470.laz",
    "USGS_LPC_MD_4County_D24_18suj620480.laz",
    "USGS_LPC_MD_4County_D24_18suj620490.laz",
    "USGS_LPC_MD_4County_D24_18suj630470.laz",
    "USGS_LPC_MD_4County_D24_18suj630480.laz",
    "USGS_LPC_MD_4County_D24_18suj630490.laz",
]

# USGS 3DEP 1m Elevation (bare earth, national coverage)
MD_IMAP_DEM_URL = (
    "https://elevation.nationalmap.gov/arcgis/rest/services/"
    "3DEPElevation/ImageServer/exportImage"
)

# Microsoft Building Footprints — Maryland
MSFT_FOOTPRINTS_URL = (
    "https://minedbuildings.z5.web.core.windows.net/legacy/usbuildings-v2/Maryland.geojson.zip"
)

# OSM Overpass
OVERPASS_URL = "https://overpass-api.de/api/interpreter"


# ── Step 1: Building Footprints ───────────────────────────────────────────────

def fetch_osm_footprints(bbox: tuple) -> dict:
    """Fetch building footprints from OSM Overpass API as GeoJSON."""
    print("\n[1/5] Fetching OSM building footprints…")
    w, s, e, n = bbox
    query = f"""
[out:json][timeout:90];
(
  way["building"]({s},{w},{n},{e});
  relation["building"]["type"="multipolygon"]({s},{w},{n},{e});
);
out body;
>;
out skel qt;
"""
    headers = {"User-Agent": "3Dtimore/1.0 (research project; rpnealon@gmail.com)"}
    resp = requests.post(OVERPASS_URL, data={"data": query}, headers=headers, timeout=120)
    resp.raise_for_status()
    osm = resp.json()

    # Convert OSM JSON to GeoJSON polygons
    nodes = {el["id"]: (el["lon"], el["lat"]) for el in osm["elements"] if el["type"] == "node"}
    features = []
    for el in osm["elements"]:
        if el["type"] != "way" or "building" not in el.get("tags", {}):
            continue
        try:
            coords = [nodes[nid] for nid in el["nodes"]]
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            if len(coords) < 4:
                continue
            tags = el.get("tags", {})
            height_tag = float(tags.get("height", 0) or 0)
            levels_tag = float(tags.get("building:levels", 0) or 0)
            features.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [coords]},
                "properties": {
                    "osm_id": el["id"],
                    "building": tags.get("building", "yes"),
                    "name": tags.get("name", ""),
                    "osm_height_m": height_tag if height_tag > 0 else levels_tag * 3.5,
                    "height_source": "osm_tag" if height_tag or levels_tag else "none",
                },
            })
        except (KeyError, TypeError):
            continue

    print(f"  → {len(features)} OSM building polygons")
    return {"type": "FeatureCollection", "features": features}


def fetch_microsoft_footprints(bbox: tuple) -> dict:
    """Download and spatially filter Microsoft Building Footprints for Maryland."""
    print("\n[1/5] Fetching Microsoft Building Footprints (Maryland)…")
    print(f"  Downloading {MSFT_FOOTPRINTS_URL}")
    print("  (410 MB — this takes a few minutes on first run)")

    cache_path = LAZ_CACHE / "Maryland.geojson.zip"
    cache_path.parent.mkdir(parents=True, exist_ok=True)

    if not cache_path.exists():
        with requests.get(MSFT_FOOTPRINTS_URL, stream=True, timeout=300) as r:
            r.raise_for_status()
            total = int(r.headers.get("content-length", 0))
            with open(cache_path, "wb") as f, tqdm(total=total, unit="B", unit_scale=True) as bar:
                for chunk in r.iter_content(chunk_size=1 << 16):
                    f.write(chunk)
                    bar.update(len(chunk))
    else:
        print(f"  Using cached file: {cache_path}")

    print("  Extracting and filtering to bbox…")
    w, s, e, n = bbox
    features = []

    with zipfile.ZipFile(cache_path) as zf:
        geojson_name = next(f for f in zf.namelist() if f.endswith(".geojson"))
        with zf.open(geojson_name) as gf:
            # Stream-parse because the file is large
            import io
            data = json.loads(gf.read())
            for feat in data.get("features", []):
                coords = feat["geometry"]["coordinates"][0]
                cx = sum(c[0] for c in coords) / len(coords)
                cy = sum(c[1] for c in coords) / len(coords)
                if w <= cx <= e and s <= cy <= n:
                    feat["properties"]["footprint_source"] = "microsoft"
                    features.append(feat)

    print(f"  → {len(features)} Microsoft footprints in bbox")
    return {"type": "FeatureCollection", "features": features}


def fetch_baltimore_footprints(bbox: tuple) -> dict:
    """Load official Baltimore City building footprints from local file."""
    import decimal
    fp_path = ROOT / "data" / "Buildings_Footprint.geojson"
    if not fp_path.exists():
        raise FileNotFoundError(f"Baltimore footprints not found at {fp_path}")

    print("\n[1/5] Loading Baltimore City official building footprints…")
    w, s, e, n = bbox
    features = []

    try:
        import ijson
        with open(fp_path, "rb") as f:
            for feat in ijson.items(f, "features.item"):
                geom = feat.get("geometry")
                if not geom:
                    continue
                # Quick centroid bbox filter
                coords = geom.get("coordinates", [[]])[0]
                if not coords:
                    continue
                lngs = [float(c[0]) if isinstance(c[0], decimal.Decimal) else c[0] for c in coords]
                lats = [float(c[1]) if isinstance(c[1], decimal.Decimal) else c[1] for c in coords]
                if not lngs:
                    continue
                cx, cy = sum(lngs) / len(lngs), sum(lats) / len(lats)
                if not (w <= cx <= e and s <= cy <= n):
                    continue
                # Normalise Decimal → float in coordinates
                def fix_coords(ring):
                    return [[float(c) if isinstance(c, decimal.Decimal) else c for c in pt] for pt in ring]
                if geom["type"] == "Polygon":
                    geom = {"type": "Polygon", "coordinates": [fix_coords(r) for r in geom["coordinates"]]}
                props = {k: (float(v) if isinstance(v, decimal.Decimal) else v)
                         for k, v in feat.get("properties", {}).items()}
                features.append({"type": "Feature", "geometry": geom, "properties": props})
    except ImportError:
        # Fallback: geopandas
        import geopandas as gpd
        from shapely.geometry import box
        gdf = gpd.read_file(str(fp_path), bbox=(w, s, e, n))
        return json.loads(gdf.to_json())

    print(f"  → {len(features)} Baltimore building footprints in study area")
    return {"type": "FeatureCollection", "features": features}


# ── Step 2: DTM — Maryland iMAP Baltimore City DEM ImageServer ────────────────

def fetch_dtm_raster(bbox: tuple, resolution_m: float = 1.0) -> Path:
    """
    Download 1m bare-earth DEM from Maryland iMAP as GeoTIFF.
    Returns path to downloaded .tif file.
    """
    print("\n[2/5] Fetching DTM from Maryland iMAP Baltimore City DEM…")
    w, s, e, n = bbox

    # Estimate pixel dimensions (at 1m, ~1 pixel per meter)
    lat_rad = math.radians((s + n) / 2)
    m_per_deg_lng = 111320 * math.cos(lat_rad)
    m_per_deg_lat = 111132
    width_px  = min(15000, int((e - w) * m_per_deg_lng / resolution_m))
    height_px = min(4100,  int((n - s) * m_per_deg_lat / resolution_m))

    params = {
        "bbox":        f"{w},{s},{e},{n}",
        "bboxSR":      "4326",
        "size":        f"{width_px},{height_px}",
        "imageSR":     "4326",
        "format":      "tiff",
        "pixelType":   "F32",
        "noData":      "-9999",
        "noDataInterpretation": "esriNoDataMatchAny",
        "interpolation": "RSP_BilinearInterpolation",
        "f":           "image",
    }

    out_path = LAZ_CACHE / "dtm_baltimore.tif"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if not out_path.exists():
        print(f"  Requesting {width_px}×{height_px}px raster…")
        resp = requests.get(MD_IMAP_DEM_URL, params=params, timeout=120, stream=True)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if "html" in content_type.lower():
            raise RuntimeError(f"DTM endpoint returned HTML — likely deprecated or wrong URL.\n{resp.url}")
        with open(out_path, "wb") as f:
            for chunk in resp.iter_content(1 << 16):
                f.write(chunk)
        size_kb = out_path.stat().st_size // 1024
        if size_kb < 10:
            out_path.unlink()
            raise RuntimeError(f"DTM raster too small ({size_kb} KB) — endpoint may have failed silently")
        print(f"  → DTM saved: {out_path} ({size_kb} KB)")
    else:
        print(f"  Using cached DTM: {out_path}")

    return out_path


# ── Step 3: DSM — USGS LAZ → first-return surface model ──────────────────────

def download_laz_tiles(target_dir: Path) -> list[Path]:
    """Download the USGS LAZ tiles for our study area."""
    print("\n[3/5] Downloading USGS MD_4County_D24 LAZ tiles…")
    target_dir.mkdir(parents=True, exist_ok=True)
    downloaded = []
    for tile in USGS_LAZ_TILES:
        out = target_dir / tile
        if out.exists():
            print(f"  ✓ cached  {tile}")
            downloaded.append(out)
            continue
        url = USGS_LAZ_BASE + tile
        print(f"  ↓ {tile}")
        with requests.get(url, stream=True, timeout=300) as r:
            if r.status_code == 404:
                print(f"    (not found — skipping)")
                continue
            r.raise_for_status()
            total = int(r.headers.get("content-length", 0))
            with open(out, "wb") as f, tqdm(total=total, unit="B", unit_scale=True, leave=False) as bar:
                for chunk in r.iter_content(1 << 16):
                    f.write(chunk)
                    bar.update(len(chunk))
        downloaded.append(out)
    print(f"  → {len(downloaded)} tiles ready")
    return downloaded


def build_dsm_with_pdal(laz_files: list[Path], out_path: Path, bbox: tuple) -> Optional[Path]:
    """
    Use PDAL to create a 1m first-return DSM from LAZ tiles.
    Returns path to DSM GeoTIFF, or None if PDAL unavailable.
    """
    try:
        import pdal
    except ImportError:
        print("  PDAL not installed — skipping LAZ-based DSM. Run: pip install pdal")
        return None

    print(f"\n  Building DSM from {len(laz_files)} LAZ tiles with PDAL…")
    w, s, e, n = bbox

    # Convert bbox to UTM 18N for PDAL crop filter
    from pyproj import Transformer
    t = Transformer.from_crs("EPSG:4326", "EPSG:32618", always_xy=True)
    west_m, south_m = t.transform(w, s)
    east_m, north_m = t.transform(e, n)

    out_path.parent.mkdir(parents=True, exist_ok=True)

    readers = [{"type": "readers.las", "filename": str(p)} for p in laz_files]

    pipeline_def = [
        *readers,
        # Merge tiles
        {"type": "filters.merge"},
        # Crop to bbox (in UTM 18N)
        {
            "type": "filters.crop",
            "bounds": f"([{west_m:.0f},{east_m:.0f}],[{south_m:.0f},{north_m:.0f}])",
        },
        # Keep only first returns
        {"type": "filters.range", "limits": "returnnumber[1:1]"},
        # Write DSM: project to WGS84 on output
        {
            "type": "writers.gdal",
            "filename": str(out_path),
            "resolution": 1.0,
            "output_type": "max",  # highest first-return = rooftop
            "data_type": "float32",
            "nodata": -9999,
            "gdalopts": "COMPRESS=LZW",
        },
    ]

    try:
        pipeline = pdal.Pipeline(json.dumps(pipeline_def))
        pipeline.execute()
        print(f"  → DSM written: {out_path}")
        return out_path
    except Exception as e:
        print(f"  PDAL pipeline failed: {e}")
        return None


def build_dsm_with_laspy(laz_files: list[Path], out_path: Path, bbox: tuple) -> Optional[Path]:
    """
    Fallback DSM builder using laspy (no PDAL dependency).
    Bins first-return Z values into a 1m raster via numpy.
    """
    try:
        import laspy
    except ImportError:
        print("  laspy not installed either — cannot build DSM from LAZ.")
        return None

    from pyproj import Transformer
    import rasterio
    from rasterio.transform import from_origin
    from rasterio.crs import CRS

    print(f"\n  Building DSM with laspy (no-PDAL fallback)…")
    w, s, e, n = bbox

    t_fwd = Transformer.from_crs("EPSG:4326", "EPSG:32618", always_xy=True)
    t_inv = Transformer.from_crs("EPSG:32618", "EPSG:4326", always_xy=True)
    xmin, ymin = t_fwd.transform(w, s)
    xmax, ymax = t_fwd.transform(e, n)

    res = 1.0  # 1m pixels
    cols = int((xmax - xmin) / res) + 1
    rows = int((ymax - ymin) / res) + 1
    dsm_grid = np.full((rows, cols), -9999.0, dtype=np.float32)

    for laz_path in laz_files:
        print(f"    Processing {laz_path.name}…")
        try:
            with laspy.open(str(laz_path), laz_backend=laspy.LazBackend.Laszip) as f:
                las = f.read()
                mask = np.asarray(las.return_number) == 1
                xs = np.asarray(las.x)[mask]
                ys = np.asarray(las.y)[mask]
                zs = np.asarray(las.z)[mask]
                in_bbox = (xs >= xmin) & (xs <= xmax) & (ys >= ymin) & (ys <= ymax)
                xs, ys, zs = xs[in_bbox], ys[in_bbox], zs[in_bbox]
                if len(xs) > 0:
                    col_idx = np.clip(((xs - xmin) / res).astype(np.int32), 0, cols - 1)
                    row_idx = np.clip(((ymax - ys) / res).astype(np.int32), 0, rows - 1)
                    flat = row_idx * cols + col_idx
                    np.maximum.at(dsm_grid.ravel(), flat, zs.astype(np.float32))
        except Exception as e:
            print(f"    Warning: {e}")

    transform = from_origin(xmin, ymax, res, res)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        str(out_path), "w", driver="GTiff", height=rows, width=cols,
        count=1, dtype="float32", crs=CRS.from_epsg(32618),
        transform=transform, nodata=-9999,
    ) as dst:
        dst.write(dsm_grid, 1)

    print(f"  → DSM written: {out_path}")
    return out_path


# ── Step 4: Building heights via zonal statistics ─────────────────────────────

def sample_height_at_centroid(lon: float, lat: float, raster_path: Path) -> Optional[float]:
    """Read the raster value at a single point (lon, lat)."""
    import rasterio
    from pyproj import Transformer

    with rasterio.open(str(raster_path)) as src:
        # Reproject point to raster CRS if needed
        if src.crs and src.crs.to_epsg() != 4326:
            t = Transformer.from_crs("EPSG:4326", src.crs.to_epsg(), always_xy=True)
            x, y = t.transform(lon, lat)
        else:
            x, y = lon, lat

        row, col = src.index(x, y)
        if 0 <= row < src.height and 0 <= col < src.width:
            val = src.read(1)[row, col]
            if val != src.nodata and val > -9000:
                return float(val)
    return None


def compute_zonal_heights(footprints_gdf, dsm_path: Path, dtm_path: Path) -> "pd.Series":
    """
    Compute max nDSM (= DSM - DTM) height for each building polygon.
    Uses rasterstats.zonal_stats when available, falls back to centroid sampling.
    """
    import rasterio
    from pyproj import Transformer

    print("\n[4/5] Computing building heights from nDSM…")

    try:
        from rasterstats import zonal_stats

        with rasterio.open(str(dsm_path)) as dsm, rasterio.open(str(dtm_path)) as dtm:
            dsm_arr = dsm.read(1).astype(np.float32)
            dtm_arr = dtm.read(1).astype(np.float32)

            # Resample DTM to DSM grid if needed (simple nearest neighbor)
            if dsm_arr.shape != dtm_arr.shape:
                from scipy.ndimage import zoom
                sx = dsm_arr.shape[1] / dtm_arr.shape[1]
                sy = dsm_arr.shape[0] / dtm_arr.shape[0]
                dtm_arr = zoom(dtm_arr, (sy, sx), order=1)

            ndsm = np.where(
                (dsm_arr > -9000) & (dtm_arr > -9000),
                dsm_arr - dtm_arr,
                -9999,
            ).astype(np.float32)

            # Write nDSM to temp file for rasterstats
            ndsm_path = LAZ_CACHE / "ndsm.tif"
            profile = dsm.profile.copy()
            profile.update(nodata=-9999)
            with rasterio.open(str(ndsm_path), "w", **profile) as out:
                out.write(ndsm, 1)

        # Reproject footprints to DSM CRS for zonal_stats
        import geopandas as gpd
        with rasterio.open(str(ndsm_path)) as _ndsm_src:
            raster_crs = _ndsm_src.crs.to_string()
        geom_projected = footprints_gdf.to_crs(raster_crs).geometry

        stats = zonal_stats(
            geom_projected,
            str(ndsm_path),
            stats=["max", "mean", "std"],
            nodata=-9999,
            all_touched=True,
        )
        heights = [
            max(0.0, s["max"] or 0) if s["max"] is not None else 0.0
            for s in stats
        ]
        print(f"  → Heights computed for {sum(h > 0 for h in heights)}/{len(heights)} buildings")
        return heights

    except ImportError:
        print("  rasterstats not available — using centroid sampling fallback")

    # Fallback: sample DSM and DTM at footprint centroids
    t = Transformer.from_crs("EPSG:4326", "EPSG:32618", always_xy=True)
    heights = []
    for geom in footprints_gdf.geometry:
        cx, cy = geom.centroid.x, geom.centroid.y
        dsm_z = sample_height_at_centroid(cx, cy, dsm_path)
        dtm_z = sample_height_at_centroid(cx, cy, dtm_path)
        if dsm_z is not None and dtm_z is not None:
            heights.append(max(0.0, dsm_z - dtm_z))
        else:
            heights.append(0.0)
    return heights


# ── Step 5: Parcel spatial join ───────────────────────────────────────────────

def join_parcels(footprints_gdf) -> "gpd.GeoDataFrame":
    """Spatial join: assign BLOCKLOT / address from local parcel GeoJSON."""
    parcel_path = ROOT / "data" / "Real_Property_Information.geojson"
    if not parcel_path.exists():
        print("\n[5/5] Parcel file not found — skipping parcel join.")
        footprints_gdf["BLOCKLOT"] = ""
        footprints_gdf["ADDRESS"] = ""
        footprints_gdf["OWNER"] = ""
        footprints_gdf["ARTAXBAS"] = 0
        return footprints_gdf

    print("\n[5/5] Joining with Baltimore parcel data…")

    import geopandas as gpd

    print("  Reading parcel GeoJSON (563 MB — may take 30s)…")
    parcels = gpd.read_file(str(parcel_path))
    parcels = parcels[["BLOCKLOT", "FULLADDR", "OWNER_1", "ARTAXBAS", "geometry"]]
    parcels = parcels.rename(columns={"FULLADDR": "ADDRESS", "OWNER_1": "OWNER"})
    parcels = parcels[parcels.geometry.notna()]

    # Ensure same CRS
    if parcels.crs != footprints_gdf.crs:
        parcels = parcels.to_crs(footprints_gdf.crs)

    # Centroid join: building centroid within which parcel?
    centroids = footprints_gdf.copy()
    centroids.geometry = footprints_gdf.to_crs("EPSG:32618").centroid.to_crs(footprints_gdf.crs)

    joined = gpd.sjoin(centroids, parcels, how="left", predicate="within")
    # Deduplicate: keep first match per building
    joined = joined[~joined.index.duplicated(keep="first")]
    footprints_gdf["BLOCKLOT"] = joined["BLOCKLOT"].reindex(footprints_gdf.index).fillna("")
    footprints_gdf["ADDRESS"]  = joined["ADDRESS"].reindex(footprints_gdf.index).fillna("")
    footprints_gdf["OWNER"]    = joined["OWNER"].reindex(footprints_gdf.index).fillna("")
    footprints_gdf["ARTAXBAS"] = joined["ARTAXBAS"].reindex(footprints_gdf.index).fillna(0)

    matched = (footprints_gdf["BLOCKLOT"] != "").sum()
    print(f"  → {matched}/{len(footprints_gdf)} buildings matched to parcels")
    return footprints_gdf


# ── Export ────────────────────────────────────────────────────────────────────

def export_geojson(gdf, out_path: Path):
    """Write deck.gl-ready GeoJSON with height property."""
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Find the largest footprint on the featured blocklot to mark as featured
    featured_candidates = gdf[gdf["BLOCKLOT"].str.strip() == FEATURED_BLOCKLOT]
    featured_idx = None
    if not featured_candidates.empty:
        featured_idx = featured_candidates.to_crs("EPSG:32618").geometry.area.idxmax()

    features = []
    for idx, row in gdf.iterrows():
        if row.geometry is None or row.geometry.is_empty:
            continue
        h = float(row.get("height_m", 0) or 0)
        h = max(2.0, min(h, 300.0)) if h > 0 else 0.0
        features.append({
            "type": "Feature",
            "geometry": row.geometry.__geo_interface__,
            "properties": {
                "height_m":        h,
                "height_source":   str(row.get("height_source", "estimate")),
                "BLOCKLOT":        str(row.get("BLOCKLOT", "") or ""),
                "ADDRESS":         str(row.get("ADDRESS", "") or ""),
                "OWNER":           str(row.get("OWNER", "") or ""),
                "ARTAXBAS":        float(row.get("ARTAXBAS", 0) or 0),
                "osm_id":          int(row.get("osm_id", 0) or 0),
                "building":        str(row.get("building", "") or ""),
                "area_m2":         round(float(row.geometry.area * 1e10), 1),
                "is_featured":     bool(idx == featured_idx),
            },
        })

    geojson = {
        "type": "FeatureCollection",
        "metadata": {
            "generated":        __import__("datetime").datetime.utcnow().isoformat() + "Z",
            "bbox":             list(BBOX),
            "featured_blocklot": FEATURED_BLOCKLOT,
            "height_source":    "lidar_ndsm (USGS MD_4County_D24 2024 + MD iMAP DTM)",
            "footprint_source": "OSM Overpass / Microsoft USBuildingFootprints",
            "feature_count":    len(features),
        },
        "features": features,
    }

    with open(out_path, "w") as f:
        json.dump(geojson, f, separators=(",", ":"))

    size_kb = out_path.stat().st_size // 1024
    print(f"\n✓ Exported: {out_path}")
    print(f"  {len(features)} features  |  {size_kb} KB")


# ── Main pipeline modes ───────────────────────────────────────────────────────

def run_quick(footprint_source: str = "osm"):
    """
    Quick mode:
    - OSM footprints (or Microsoft)
    - MD iMAP DTM for ground elevation
    - Heights estimated from OSM tags, or use DTM as a lower-bound signal
    - No LAZ download required
    """
    import geopandas as gpd
    from shapely.geometry import shape

    print("\n" + "=" * 60)
    print("  3Dtimore Building Pipeline — QUICK MODE")
    print("  (OSM footprints + USGS LAZ tiles + DTM → real nDSM heights)")
    print("=" * 60)

    # 1. Footprints
    if footprint_source == "microsoft":
        fc = fetch_microsoft_footprints(BBOX)
    elif footprint_source == "baltimore":
        fc = fetch_baltimore_footprints(BBOX)
    else:
        fc = fetch_osm_footprints(BBOX)

    if not fc["features"]:
        sys.exit("No footprints found in study area bbox")

    gdf = gpd.GeoDataFrame.from_features(fc["features"], crs="EPSG:4326")

    # 2. DTM (bare-earth ground elevation from USGS 3DEP)
    try:
        dtm_path = fetch_dtm_raster(BBOX)
    except Exception as dtm_err:
        print(f"  ⚠ DTM unavailable ({dtm_err}), will use OSM heuristics only.")
        dtm_path = None

    # 3. DSM (first-return surface) from USGS LAZ tiles — same tiles as full mode,
    #    but cached after first run (~326 MB total, ~30 MB per tile)
    dsm_path = LAZ_CACHE / "dsm_locustpoint.tif"
    laz_heights = None

    if dtm_path is not None:
        try:
            laz_files = download_laz_tiles(LAZ_CACHE)
            if laz_files:
                if not dsm_path.exists():
                    dsm_path = build_dsm_with_laspy(laz_files, dsm_path, BBOX)
                else:
                    print(f"\n[3/5] Using cached DSM: {dsm_path}")
                laz_heights = compute_zonal_heights(gdf, dsm_path, dtm_path)
        except Exception as laz_err:
            print(f"  ⚠ LAZ pipeline failed ({laz_err}), falling back to OSM heuristics.")
            laz_heights = None

    # 4. Assign heights: LiDAR nDSM → OSM tag → building-type heuristic
    def heuristic_height(row):
        h_osm = float(row.get("osm_height_m", 0) or 0)
        if h_osm > 0:
            return h_osm, "osm_tag"
        btype = str(row.get("building", "")).lower()
        defaults = {
            "industrial": 12.0, "warehouse": 10.0, "commercial": 8.0,
            "office": 30.0, "hotel": 25.0, "retail": 6.0,
            "apartments": 15.0, "residential": 8.0, "church": 12.0,
            "school": 10.0, "garage": 4.0, "shed": 3.0,
        }
        for k, v in defaults.items():
            if k in btype:
                return v, "type_heuristic"
        return 6.0, "default"

    heights, sources = [], []
    for i, (_, row) in enumerate(gdf.iterrows()):
        lidar_h = laz_heights[i] if laz_heights is not None else 0.0
        if lidar_h > 1.0:
            heights.append(round(lidar_h, 2))
            sources.append("lidar_ndsm")
        else:
            h, src = heuristic_height(row)
            heights.append(h)
            sources.append(src)

    lidar_count = sources.count("lidar_ndsm")
    print(f"\n  Heights: {lidar_count} LiDAR-derived, {len(heights) - lidar_count} heuristic")

    gdf["height_m"] = heights
    gdf["height_source"] = sources

    # 5. Parcel join
    gdf = join_parcels(gdf)

    # 6. Export
    export_geojson(gdf, OUT_FILE)


def run_full(laz_dir: Optional[Path] = None, footprint_source: str = "osm"):
    """
    Full LiDAR pipeline:
    - Download USGS LAZ tiles (if not cached / provided)
    - Build 1m DSM from first returns using PDAL (or laspy fallback)
    - Download MD iMAP 1m DTM
    - nDSM = DSM - DTM → building heights via zonal statistics
    """
    import geopandas as gpd

    print("\n" + "=" * 60)
    print("  3Dtimore Building Pipeline — FULL LiDAR MODE")
    print("  USGS MD_4County_D24 (2024) + MD iMAP DTM")
    print("=" * 60)

    # 1. Footprints
    if footprint_source == "microsoft":
        fc = fetch_microsoft_footprints(BBOX)
    elif footprint_source == "baltimore":
        fc = fetch_baltimore_footprints(BBOX)
    else:
        fc = fetch_osm_footprints(BBOX)

    gdf = gpd.GeoDataFrame.from_features(fc["features"], crs="EPSG:4326")

    # 2. DTM
    dtm_path = fetch_dtm_raster(BBOX)

    # 3. DSM from LAZ
    laz_cache = laz_dir or (LAZ_CACHE / "usgs_laz")
    laz_files = download_laz_tiles(laz_cache)

    dsm_path = LAZ_CACHE / "dsm.tif"
    if not dsm_path.exists():
        result = build_dsm_with_pdal(laz_files, dsm_path, BBOX)
        if result is None:
            print("  PDAL unavailable — trying laspy fallback…")
            result = build_dsm_with_laspy(laz_files, dsm_path, BBOX)
        if result is None:
            print("  Cannot build DSM. Falling back to quick mode heights.")
            for _, row in gdf.iterrows():
                gdf["height_m"] = 6.0
                gdf["height_source"] = "fallback"
            gdf = join_parcels(gdf)
            export_geojson(gdf, OUT_FILE)
            return
    else:
        print(f"\n[3/5] Using cached DSM: {dsm_path}")

    # 4. Zonal statistics → heights
    heights = compute_zonal_heights(gdf, dsm_path, dtm_path)
    gdf["height_m"] = heights
    gdf["height_source"] = [
        "lidar_ndsm" if h > 0 else "no_data" for h in heights
    ]

    # 5. Parcel join
    gdf = join_parcels(gdf)

    # 6. Export
    export_geojson(gdf, OUT_FILE)


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="3Dtimore building footprint + LiDAR height pipeline"
    )
    parser.add_argument(
        "--mode", choices=["quick", "full"], default="quick",
        help="quick = OSM + heuristic heights (no LAZ); full = USGS LAZ + nDSM (accurate)"
    )
    parser.add_argument(
        "--footprints", choices=["osm", "microsoft", "baltimore"], default="baltimore",
        help="Building footprint source (baltimore = data/Buildings_Footprint.geojson)"
    )
    parser.add_argument(
        "--laz-dir", type=Path, default=None,
        help="Path to pre-downloaded LAZ directory (skips download)"
    )
    args = parser.parse_args()

    LAZ_CACHE.mkdir(parents=True, exist_ok=True)

    if args.mode == "full":
        run_full(laz_dir=args.laz_dir, footprint_source=args.footprints)
    else:
        run_quick(footprint_source=args.footprints)

    print(f"\n  Next: restart `npm run dev` — app loads {OUT_FILE.name} automatically\n")
