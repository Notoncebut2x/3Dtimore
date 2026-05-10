#!/usr/bin/env python3
"""
Building Footprint + LiDAR Height Pipeline
Coverage: all 69 properties in public/data/properties.json + 600m padding

Data sources:
  Footprints:  OSM Overpass API  (primary)
               Baltimore City Buildings_Footprint.geojson (secondary)
  LiDAR:      NOAA 2008 Baltimore City COPC LAZ tiles (AWS S3, public)
               Streams only bbox points via PDAL COPC reader (no full download)
               Fallback: download tile → laspy → delete
  DTM:        Maryland iMAP Baltimore City DEM (confirmed working, tiled export)

Output:
  public/data/buildings-with-heights.geojson   ← deck.gl-ready

Usage:
  python scripts/buildingPipeline.py --mode quick
  python scripts/buildingPipeline.py --mode full

Install:
  pip install -r scripts/requirements_pipeline.txt
  pip install pdal   # optional but enables streaming (no large downloads)
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

ROOT     = Path(__file__).parent.parent
OUT_DIR  = ROOT / "public" / "data"
OUT_FILE = OUT_DIR / "buildings-with-heights.geojson"
LAZ_CACHE = ROOT / "data" / "lidar_cache"

def _compute_bbox(padding_deg: float = 0.006) -> tuple:
    props_file = OUT_DIR / "properties.json"
    if props_file.exists():
        with open(props_file) as f:
            props = json.load(f)
        lons = [p["lon"] for p in props]
        lats = [p["lat"] for p in props]
        return (
            min(lons) - padding_deg,
            min(lats) - padding_deg,
            max(lons) + padding_deg,
            max(lats) + padding_deg,
        )
    return (-76.645, 39.258, -76.540, 39.315)

BBOX = _compute_bbox()

# NOAA 2008 Baltimore City LiDAR — COPC LAZ tiles on AWS S3 (public, no auth)
NOAA_S3_BASE     = "https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/laz/geoid18/1199/"
NOAA_URLLIST     = NOAA_S3_BASE + "urllist1199.txt"
NOAA_MINMAX_CSV  = NOAA_S3_BASE + "2008_CityofBaltimore_minmax.csv"

# Maryland iMAP Baltimore City DEM — use meters variant so units match DSM
MD_IMAP_DEM_URL  = (
    "https://mdgeodata.md.gov/lidar/rest/services/BaltimoreCity/"
    "MD_baltimorecity_dem_m/ImageServer/exportImage"
)
MD_IMAP_MAX_H    = 4000   # service hard limit (pixels)
MD_IMAP_MAX_W    = 15000

# OSM Overpass
OVERPASS_URL = "https://overpass-api.de/api/interpreter"


# ── Step 1: Building Footprints ───────────────────────────────────────────────

def fetch_osm_footprints(bbox: tuple) -> dict:
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
    headers = {"User-Agent": "3Dtimore/1.0 (research; rpnealon@gmail.com)"}
    resp = requests.post(OVERPASS_URL, data={"data": query}, headers=headers, timeout=120)
    resp.raise_for_status()
    osm = resp.json()

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
            height_tag  = float(tags.get("height", 0) or 0)
            levels_tag  = float(tags.get("building:levels", 0) or 0)
            features.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [coords]},
                "properties": {
                    "osm_id":        el["id"],
                    "building":      tags.get("building", "yes"),
                    "name":          tags.get("name", ""),
                    "osm_height_m":  height_tag if height_tag > 0 else levels_tag * 3.5,
                    "height_source": "osm_tag" if (height_tag or levels_tag) else "none",
                },
            })
        except (KeyError, TypeError):
            continue

    print(f"  → {len(features)} OSM building polygons")
    return {"type": "FeatureCollection", "features": features}


def fetch_baltimore_footprints(bbox: tuple) -> dict:
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
                def fix_coords(ring):
                    return [[float(c) if isinstance(c, decimal.Decimal) else c for c in pt] for pt in ring]
                if geom["type"] == "Polygon":
                    geom = {"type": "Polygon", "coordinates": [fix_coords(r) for r in geom["coordinates"]]}
                props = {k: (float(v) if isinstance(v, decimal.Decimal) else v)
                         for k, v in feat.get("properties", {}).items()}
                features.append({"type": "Feature", "geometry": geom, "properties": props})
    except ImportError:
        import geopandas as gpd
        gdf = gpd.read_file(str(fp_path), bbox=(w, s, e, n))
        return json.loads(gdf.to_json())

    print(f"  → {len(features)} Baltimore building footprints in study area")
    return {"type": "FeatureCollection", "features": features}


# ── Step 2: DTM — Maryland iMAP DEM (tiled, confirmed working) ────────────────

def fetch_dtm_raster(bbox: tuple, resolution_m: float = 5.0) -> Optional[Path]:
    """
    Download bare-earth DEM from Maryland iMAP as GeoTIFF.
    Requests at 5m resolution (safe for the service, sufficient for nDSM).
    Returns path to final .tif, or None on failure.
    """
    print("\n[2/5] Fetching DTM from Maryland iMAP Baltimore City DEM…")
    w, s, e, n = bbox

    lat_rad       = math.radians((s + n) / 2)
    m_per_deg_lng = 111320 * math.cos(lat_rad)
    m_per_deg_lat = 111132
    total_w_px    = min(2048, int((e - w) * m_per_deg_lng / resolution_m))
    total_h_px    = min(2048, int((n - s) * m_per_deg_lat / resolution_m))

    bbox_tag = f"{abs(w):.3f}_{s:.3f}_{abs(e):.3f}_{n:.3f}".replace(".", "")
    out_path = LAZ_CACHE / f"dtm_{bbox_tag}.tif"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if out_path.exists():
        print(f"  Using cached DTM: {out_path}")
        return out_path

    params = {
        "bbox":        f"{w},{s},{e},{n}",
        "bboxSR":      "4326",
        "size":        f"{total_w_px},{total_h_px}",
        "imageSR":     "4326",
        "format":      "tiff",
        "pixelType":   "F32",
        "noData":      "-9999",
        "noDataInterpretation": "esriNoDataMatchAny",
        "interpolation": "RSP_BilinearInterpolation",
        "f":           "image",
    }

    print(f"  Requesting DTM ({total_w_px}×{total_h_px}px at {resolution_m}m resolution)…")
    try:
        resp = requests.get(MD_IMAP_DEM_URL, params=params, timeout=120, stream=True)
        resp.raise_for_status()
        if "html" in resp.headers.get("content-type", "").lower():
            raise RuntimeError("DTM endpoint returned HTML — check URL")
        with open(out_path, "wb") as f_out:
            for chunk in resp.iter_content(1 << 16):
                f_out.write(chunk)
        size_kb = out_path.stat().st_size // 1024
        if size_kb < 10:
            out_path.unlink()
            raise RuntimeError(f"Response too small ({size_kb} KB)")
        print(f"  → DTM saved: {out_path} ({size_kb} KB)")
        return out_path
    except Exception as e:
        print(f"  ⚠ DTM failed: {e}")
        out_path.unlink(missing_ok=True)
        return None


# ── Step 3: DSM — NOAA COPC LAZ tiles (streaming or download+delete) ──────────

def _bbox_wgs84_to_projected(bbox, epsg_out=32618):
    """Convert WGS84 bbox to projected meters."""
    from pyproj import Transformer
    t = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg_out}", always_xy=True)
    w, s, e, n = bbox
    xmin, ymin = t.transform(w, s)
    xmax, ymax = t.transform(e, n)
    return xmin, ymin, xmax, ymax


def _las_header_bbox(url: str) -> Optional[tuple]:
    """
    Read the first 256 bytes of a LAS/COPC file via HTTP Range request
    to extract its X/Y bounding box (stored as 8-byte doubles in the LAS header).
    Returns (xmin, ymin, xmax, ymax) in the file's native CRS, or None on failure.
    """
    import struct
    try:
        resp = requests.get(url, headers={"Range": "bytes=0-255"}, timeout=15)
        if resp.status_code not in (200, 206) or len(resp.content) < 243:
            return None
        raw = resp.content
        # LAS 1.x header (LAS 1.2–1.4), little-endian doubles:
        # offset 179: Max X, 187: Min X, 195: Max Y, 203: Min Y
        max_x, min_x, max_y, min_y = struct.unpack_from('<dddd', raw, 179)
        return (min_x, min_y, max_x, max_y)
    except Exception:
        return None


def fetch_noaa_tile_list(bbox: tuple) -> list[str]:
    """
    List all COPC LAZ tiles in the NOAA S3 bucket via the S3 ListObjects API,
    then filter to tiles whose bounding box overlaps our study bbox using
    HTTP Range requests on the LAS header (no full download).
    Returns list of matching tile URLs.
    """
    print("  Listing NOAA S3 tiles…")
    w, s, e, n = bbox

    # 1. List all tile keys via S3 XML API
    s3_list_url = "https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/?prefix=laz/geoid18/1199/&delimiter=/"
    resp = requests.get(s3_list_url, timeout=30)
    resp.raise_for_status()
    import re
    keys = re.findall(r'<Key>(laz/geoid18/1199/[^<]+\.laz)</Key>', resp.text)
    all_urls = [f"https://noaa-nos-coastal-lidar-pds.s3.amazonaws.com/{k}" for k in keys]
    print(f"  → {len(all_urls)} tiles in bucket — reading headers to filter by bbox…")

    # 2. Read LAS header from each tile (256 bytes via Range request) to get bbox
    xmin_b, ymin_b, xmax_b, ymax_b = _bbox_wgs84_to_projected(bbox)
    matching = []
    for url in all_urls:
        tile_bbox = _las_header_bbox(url)
        if tile_bbox is None:
            matching.append(url)  # can't determine — include it
            continue
        tx_min, ty_min, tx_max, ty_max = tile_bbox
        # Determine if projected (large numbers) or geographic
        if abs(tx_min) > 1000:
            bx_min, by_min, bx_max, by_max = xmin_b, ymin_b, xmax_b, ymax_b
        else:
            bx_min, by_min, bx_max, by_max = w, s, e, n
        if tx_min <= bx_max and tx_max >= bx_min and ty_min <= by_max and ty_max >= by_min:
            matching.append(url)

    print(f"  → {len(matching)} tiles overlap study bbox")
    return matching


def build_dsm_copc_pdal(tile_urls: list[str], out_path: Path, bbox: tuple) -> Optional[Path]:
    """
    Use PDAL COPC reader to stream ONLY bbox points from each tile over HTTP.
    No full tile download — COPC spatial index handles it.
    Extracts first returns (DSM = surface including rooftops).
    """
    try:
        import pdal
    except ImportError:
        print("  PDAL not installed — falling back to download+delete method.")
        return None

    from pyproj import Transformer
    t = Transformer.from_crs("EPSG:4326", "EPSG:32618", always_xy=True)
    w, s, e, n = bbox
    xmin, ymin = t.transform(w, s)
    xmax, ymax = t.transform(e, n)

    print(f"\n  Streaming {len(tile_urls)} COPC tiles via PDAL (no full download)…")

    all_xyz = []
    for url in tile_urls:
        fname = url.split("/")[-1]
        print(f"    → {fname}")
        pipeline_def = [
            {
                "type": "readers.copc",
                "filename": url,
                "bounds": f"([{xmin:.1f},{xmax:.1f}],[{ymin:.1f},{ymax:.1f}])",
            },
            # First returns only
            {"type": "filters.range", "limits": "ReturnNumber[1:1]"},
        ]
        try:
            pipeline = pdal.Pipeline(json.dumps(pipeline_def))
            n_pts = pipeline.execute()
            if n_pts == 0:
                continue
            arr = pipeline.arrays[0]
            xs  = arr["X"].astype(np.float32)
            ys  = arr["Y"].astype(np.float32)
            zs  = arr["Z"].astype(np.float32)
            in_bbox = (xs >= xmin) & (xs <= xmax) & (ys >= ymin) & (ys <= ymax)
            all_xyz.append((xs[in_bbox], ys[in_bbox], zs[in_bbox]))
            print(f"       {int(in_bbox.sum()):,} points in bbox")
        except Exception as e:
            print(f"       ⚠ skipped: {e}")

    if not all_xyz:
        print("  No points returned from any tile.")
        return None

    xs = np.concatenate([a[0] for a in all_xyz])
    ys = np.concatenate([a[1] for a in all_xyz])
    zs = np.concatenate([a[2] for a in all_xyz])
    return _write_dsm_raster(xs, ys, zs, xmin, ymin, xmax, ymax, out_path)


def build_dsm_download_delete(tile_urls: list[str], out_path: Path, bbox: tuple) -> Optional[Path]:
    """
    Download each COPC/LAZ tile one at a time, extract bbox first-return points
    with laspy, then immediately delete the raw tile. Stitches results into one DSM.
    """
    try:
        import laspy
    except ImportError:
        print("  laspy not installed. Run: pip install laspy lazrs-python")
        return None

    from pyproj import Transformer
    t = Transformer.from_crs("EPSG:4326", "EPSG:32618", always_xy=True)
    w, s, e, n = bbox
    xmin, ymin = t.transform(w, s)
    xmax, ymax = t.transform(e, n)

    print(f"\n  Downloading {len(tile_urls)} tiles (process → delete strategy)…")
    LAZ_CACHE.mkdir(parents=True, exist_ok=True)

    all_xyz = []
    for url in tile_urls:
        fname    = url.split("/")[-1]
        tmp_path = LAZ_CACHE / fname
        print(f"\n  ↓ {fname}")
        try:
            with requests.get(url, stream=True, timeout=300) as r:
                r.raise_for_status()
                total = int(r.headers.get("content-length", 0))
                with open(tmp_path, "wb") as f, tqdm(total=total, unit="B", unit_scale=True, leave=False) as bar:
                    for chunk in r.iter_content(1 << 16):
                        f.write(chunk)
                        bar.update(len(chunk))

            size_mb = tmp_path.stat().st_size // (1024 * 1024)
            print(f"    Downloaded {size_mb} MB — extracting points…")

            with laspy.open(str(tmp_path)) as lf:
                las = lf.read()
                # First returns
                ret = np.asarray(las.return_number)
                mask = (ret == 1)
                xs = np.asarray(las.x, dtype=np.float32)[mask]
                ys = np.asarray(las.y, dtype=np.float32)[mask]
                zs = np.asarray(las.z, dtype=np.float32)[mask]
                in_bbox = (xs >= xmin) & (xs <= xmax) & (ys >= ymin) & (ys <= ymax)
                xs, ys, zs = xs[in_bbox], ys[in_bbox], zs[in_bbox]
                print(f"    {len(xs):,} first-return points in bbox")
                if len(xs) > 0:
                    all_xyz.append((xs, ys, zs))

        except Exception as e:
            print(f"  ⚠ Failed: {e}")
        finally:
            if tmp_path.exists():
                tmp_path.unlink()
                print(f"    Deleted {fname}")

    if not all_xyz:
        print("  No points collected.")
        return None

    xs = np.concatenate([a[0] for a in all_xyz])
    ys = np.concatenate([a[1] for a in all_xyz])
    zs = np.concatenate([a[2] for a in all_xyz])
    return _write_dsm_raster(xs, ys, zs, xmin, ymin, xmax, ymax, out_path)


def _write_dsm_raster(xs, ys, zs, xmin, ymin, xmax, ymax, out_path: Path) -> Optional[Path]:
    """Bin point cloud first-return Z into a 1m DSM raster, save as GeoTIFF."""
    import rasterio
    from rasterio.transform import from_origin
    from rasterio.crs import CRS

    res  = 1.0
    cols = int((xmax - xmin) / res) + 1
    rows = int((ymax - ymin) / res) + 1

    print(f"\n  Building DSM raster ({cols}×{rows}px, {len(xs):,} points)…")
    dsm = np.full((rows, cols), -9999.0, dtype=np.float32)

    col_idx = np.clip(((xs - xmin) / res).astype(np.int32), 0, cols - 1)
    row_idx = np.clip(((ymax - ys) / res).astype(np.int32), 0, rows - 1)
    flat    = row_idx * cols + col_idx
    np.maximum.at(dsm.ravel(), flat, zs)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    transform = from_origin(xmin, ymax, res, res)
    with rasterio.open(
        str(out_path), "w", driver="GTiff",
        height=rows, width=cols, count=1, dtype="float32",
        crs=CRS.from_epsg(32618), transform=transform, nodata=-9999,
        compress="lzw",
    ) as dst:
        dst.write(dsm, 1)

    size_mb = out_path.stat().st_size // (1024 * 1024)
    print(f"  → DSM written: {out_path} ({size_mb} MB)")
    return out_path


# ── Step 4: Building heights via zonal statistics ─────────────────────────────

def compute_zonal_heights(footprints_gdf, dsm_path: Path, dtm_path: Path) -> list:
    import rasterio
    print("\n[4/5] Computing building heights from nDSM (DSM − DTM)…")

    try:
        from rasterstats import zonal_stats
        from scipy.ndimage import zoom as scipy_zoom

        from rasterio.warp import reproject, Resampling

        with rasterio.open(str(dsm_path)) as dsm_src:
            dsm_arr   = dsm_src.read(1).astype(np.float32)
            dsm_crs   = dsm_src.crs
            dsm_trans = dsm_src.transform
            dsm_shape = (dsm_src.height, dsm_src.width)
            dsm_nodata = dsm_src.nodata or -9999

        # Warp DTM into DSM's CRS, extent, and resolution
        dtm_warped = np.full(dsm_shape, -9999.0, dtype=np.float32)
        with rasterio.open(str(dtm_path)) as dtm_src:
            reproject(
                source=rasterio.band(dtm_src, 1),
                destination=dtm_warped,
                src_transform=dtm_src.transform,
                src_crs=dtm_src.crs,
                dst_transform=dsm_trans,
                dst_crs=dsm_crs,
                resampling=Resampling.bilinear,
                src_nodata=dtm_src.nodata or -9999,
                dst_nodata=-9999,
            )

        ndsm = np.where(
            (dsm_arr > -9000) & (dtm_warped > -9000),
            dsm_arr - dtm_warped,
            -9999,
        ).astype(np.float32)

        ndsm_path = LAZ_CACHE / "ndsm.tif"
        with rasterio.open(
            str(ndsm_path), "w", driver="GTiff",
            height=dsm_shape[0], width=dsm_shape[1],
            count=1, dtype="float32", crs=dsm_crs,
            transform=dsm_trans, nodata=-9999, compress="lzw",
        ) as out:
            out.write(ndsm, 1)

        import geopandas as gpd
        with rasterio.open(str(ndsm_path)) as src:
            raster_crs = src.crs.to_string()
        geom_proj = footprints_gdf.to_crs(raster_crs).geometry

        stats = zonal_stats(geom_proj, str(ndsm_path), stats=["percentile_90", "max"], nodata=-9999, all_touched=True)
        heights = [max(0.0, s.get("percentile_90") or 0) if s.get("percentile_90") is not None else 0.0 for s in stats]
        n_lidar = sum(h > 1 for h in heights)
        print(f"  → LiDAR heights: {n_lidar}/{len(heights)} buildings")
        return heights

    except ImportError as ie:
        print(f"  rasterstats/scipy unavailable ({ie}) — centroid sampling fallback")

    from pyproj import Transformer
    t = Transformer.from_crs("EPSG:4326", "EPSG:32618", always_xy=True)

    def sample(lon, lat, raster_path):
        with rasterio.open(str(raster_path)) as src:
            epsg = src.crs.to_epsg() if src.crs else 4326
            if epsg != 4326:
                tx = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
                x, y = tx.transform(lon, lat)
            else:
                x, y = lon, lat
            r, c = src.index(x, y)
            if 0 <= r < src.height and 0 <= c < src.width:
                v = src.read(1)[r, c]
                if v != src.nodata and v > -9000:
                    return float(v)
        return None

    heights = []
    for geom in footprints_gdf.geometry:
        cx, cy = geom.centroid.x, geom.centroid.y
        dsm_z = sample(cx, cy, dsm_path)
        dtm_z = sample(cx, cy, dtm_path)
        heights.append(max(0.0, dsm_z - dtm_z) if dsm_z and dtm_z else 0.0)
    return heights


# ── Step 5: Parcel spatial join ───────────────────────────────────────────────

def join_parcels(footprints_gdf) -> "gpd.GeoDataFrame":
    parcel_path = ROOT / "data" / "Real_Property_Information.geojson"
    if not parcel_path.exists():
        print("\n[5/5] Parcel file not found — skipping parcel join.")
        for col in ("BLOCKLOT", "ADDRESS", "OWNER"):
            footprints_gdf[col] = ""
        footprints_gdf["ARTAXBAS"] = 0
        return footprints_gdf

    print("\n[5/5] Joining with Baltimore parcel data…")
    import geopandas as gpd

    parcels = gpd.read_file(str(parcel_path))
    parcels = parcels[["BLOCKLOT", "FULLADDR", "OWNER_1", "ARTAXBAS", "geometry"]]
    parcels = parcels.rename(columns={"FULLADDR": "ADDRESS", "OWNER_1": "OWNER"})
    parcels = parcels[parcels.geometry.notna()]
    if parcels.crs != footprints_gdf.crs:
        parcels = parcels.to_crs(footprints_gdf.crs)

    centroids = footprints_gdf.copy()
    centroids.geometry = footprints_gdf.to_crs("EPSG:32618").centroid.to_crs(footprints_gdf.crs)
    joined = gpd.sjoin(centroids, parcels, how="left", predicate="within")
    joined = joined[~joined.index.duplicated(keep="first")]

    for col in ("BLOCKLOT", "ADDRESS", "OWNER"):
        footprints_gdf[col] = joined[col].reindex(footprints_gdf.index).fillna("")
    footprints_gdf["ARTAXBAS"] = joined["ARTAXBAS"].reindex(footprints_gdf.index).fillna(0)

    matched = (footprints_gdf["BLOCKLOT"] != "").sum()
    print(f"  → {matched}/{len(footprints_gdf)} buildings matched to parcels")
    return footprints_gdf


# ── Export ────────────────────────────────────────────────────────────────────

def heuristic_height(row) -> tuple:
    h = float(row.get("osm_height_m", 0) or 0)
    if h > 0:
        return h, "osm_tag"
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


def export_geojson(gdf, out_path: Path):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    features = []
    for _, row in gdf.iterrows():
        if row.geometry is None or row.geometry.is_empty:
            continue
        h = float(row.get("height_m", 0) or 0)
        h = max(2.0, min(h, 170.0)) if h > 0 else 0.0
        features.append({
            "type": "Feature",
            "geometry": row.geometry.__geo_interface__,
            "properties": {
                "height_m":      h,
                "height_source": str(row.get("height_source", "estimate")),
                "BLOCKLOT":      str(row.get("BLOCKLOT", "") or ""),
                "ADDRESS":       str(row.get("ADDRESS", "") or ""),
                "OWNER":         str(row.get("OWNER", "") or ""),
                "ARTAXBAS":      float(row.get("ARTAXBAS", 0) or 0),
                "osm_id":        int(row.get("osm_id", 0) or 0),
                "building":      str(row.get("building", "") or ""),
                "area_m2":       round(float(row.geometry.area * 1e10), 1),
            },
        })

    geojson = {
        "type": "FeatureCollection",
        "metadata": {
            "generated":        __import__("datetime").datetime.utcnow().isoformat() + "Z",
            "bbox":             list(BBOX),
            "height_source":    "NOAA 2008 Baltimore LiDAR (COPC) / MD iMAP DTM / heuristic fallback",
            "footprint_source": "OSM Overpass / Baltimore City Buildings_Footprint.geojson",
            "feature_count":    len(features),
        },
        "features": features,
    }

    with open(out_path, "w") as f:
        json.dump(geojson, f, separators=(",", ":"))

    size_kb = out_path.stat().st_size // 1024
    print(f"\n✓ Exported: {out_path}")
    print(f"  {len(features)} features  |  {size_kb} KB")


# ── Main pipeline ─────────────────────────────────────────────────────────────

def run(footprint_source: str = "osm", force_download: bool = False):
    import geopandas as gpd
    from shapely.geometry import shape

    print("\n" + "=" * 60)
    print("  3Dtimore Building Pipeline")
    print("  NOAA 2008 Baltimore COPC LiDAR + MD iMAP DTM")
    print("=" * 60)

    # 1. Footprints
    if footprint_source == "baltimore":
        fc = fetch_baltimore_footprints(BBOX)
    else:
        fc = fetch_osm_footprints(BBOX)

    if not fc["features"]:
        sys.exit("No footprints found in study area bbox")

    gdf = gpd.GeoDataFrame.from_features(fc["features"], crs="EPSG:4326")

    # 2. DTM (bare earth) — Maryland iMAP, tiled
    dtm_path = fetch_dtm_raster(BBOX)
    if dtm_path is None:
        print("  ⚠ DTM unavailable — will use OSM heuristics only.")

    # 3. DSM (first-return surface) — NOAA COPC
    dsm_path   = LAZ_CACHE / "dsm_noaa_baltimore.tif"
    laz_heights = None

    if force_download and dsm_path.exists():
        dsm_path.unlink()

    if dtm_path is not None:
        if dsm_path.exists():
            print(f"\n[3/5] Using cached DSM: {dsm_path}")
        else:
            print("\n[3/5] Building DSM from NOAA COPC LiDAR…")
            try:
                tile_urls = fetch_noaa_tile_list(BBOX)
                # Try PDAL streaming first (no download), then download+delete fallback
                result = build_dsm_copc_pdal(tile_urls, dsm_path, BBOX)
                if result is None:
                    result = build_dsm_download_delete(tile_urls, dsm_path, BBOX)
                if result is None:
                    print("  ⚠ DSM build failed — will use heuristics.")
            except Exception as e:
                print(f"  ⚠ DSM step failed: {e}")

        if dsm_path.exists() and dtm_path is not None:
            try:
                laz_heights = compute_zonal_heights(gdf, dsm_path, dtm_path)
            except Exception as e:
                print(f"  ⚠ Height computation failed: {e}")

    # 4. Assign heights: LiDAR → OSM tag → type heuristic
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

    n_lidar = sources.count("lidar_ndsm")
    print(f"\n  Heights: {n_lidar} LiDAR-derived, {len(heights) - n_lidar} heuristic")

    gdf["height_m"]      = heights
    gdf["height_source"] = sources

    # 5. Parcel join
    gdf = join_parcels(gdf)

    # 6. Export
    export_geojson(gdf, OUT_FILE)


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="3Dtimore building footprint + NOAA LiDAR height pipeline"
    )
    parser.add_argument(
        "--footprints", choices=["osm", "baltimore"], default="osm",
        help="Building footprint source"
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Re-download DSM even if cached"
    )
    args = parser.parse_args()

    LAZ_CACHE.mkdir(parents=True, exist_ok=True)
    run(footprint_source=args.footprints, force_download=args.force)

    print(f"\n  Next: restart `npm run dev` — app loads {OUT_FILE.name} automatically\n")
