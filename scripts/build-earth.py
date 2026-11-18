"""Build self-hosted globe meshes from Natural Earth 5.1.1 and the original DataV cities.

Build-time dependencies: numpy, pyshp, shapely >= 2, mapbox-earcut. First run
npm run data:fetch for the Chinese source polygons. No GIS tools run on the phone.
"""
from collections import defaultdict
from pathlib import Path
from urllib.request import urlretrieve
import gzip
import hashlib
import json
import math
import re
import struct
import subprocess

import mapbox_earcut
import numpy as np
import shapefile
from shapely import make_valid, union_all
from shapely.geometry import Polygon, box, shape
from shapely.geometry.polygon import orient

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache/world"
OUT = ROOT / "public/data/earth"
CACHE.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)
SCALE = 100000
sources = {}
regions, countries, provinces = [], [], []


def polygons(g):
    if g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    if hasattr(g, "geoms"):
        return [p for item in g.geoms for p in polygons(item)]
    return []


def clean(g):
    return g if g.is_valid else make_valid(g)


def outer_boundary(parts, national=False):
    # Independent Chinese municipal files can leave hairline gaps between
    # neighbours. Those are not country borders. Keep real provincial enclaves.
    joined = clean(union_all(parts))
    if len(parts)>1:
        joined = joined.buffer(.0025,quad_segs=2).buffer(-.0025,quad_segs=2)
    shells = [Polygon(p.exterior, [] if national else [r for r in p.interiors if Polygon(r).area>.012])
              for p in polygons(joined)]
    return clean(union_all(shells))


def metadata(g):
    main = max(polygons(g), key=lambda p: p.area)
    inside = main.representative_point()
    w, s, e, n = main.bounds
    span = max((e-w)*math.cos(math.radians(inside.y)), n-s, .003)
    return [round(inside.x, 5), round(inside.y, 5), round(span, 5)]


def focus_bounds(g):
    parts = sorted(polygons(g), key=lambda p:-p.area)
    anchor = parts[0].representative_point()
    width = metadata(parts[0])[2]
    cos = max(.05, math.cos(math.radians(anchor.y)))
    boxes = []
    for p in parts:
        w,s,e,n = p.bounds
        mid = (e+w)/2
        shift = 360*round((anchor.x-mid)/360)
        if p is not parts[0] and (p.area < parts[0].area*.001 or math.hypot((mid+shift-anchor.x)*cos,(s+n)/2-anchor.y) > max(2.5*width,1)):
            continue
        boxes.append((w+shift,s,e+shift,n))
    w,s,e,n = min(b[0] for b in boxes),min(b[1] for b in boxes),max(b[2] for b in boxes),max(b[3] for b in boxes)
    return [round(((w+e)/2+180)%360-180,5),round((s+n)/2,5),round(max((e-w)*cos,n-s,.003),5)]


def cn_file(code):
    return json.loads((ROOT / f".cache/geo/{code}_full.json").read_text(encoding="utf8"))["features"]


def read_ne(short, layer):
    archive = CACHE / (short + ".zip")
    if not archive.exists():
        urlretrieve("https://naturalearth.s3.amazonaws.com/5.1.1/10m_cultural/ne_10m_" + layer + ".zip", archive)
    return shapefile.Reader(str(archive), encoding="utf8")


admin0_records = list(read_ne("admin0", "admin_0_countries").iterShapeRecords())
macao_land = next(clean(shape(r.shape.__geo_interface__)) for r in admin0_records if r.record.as_dict()["ADM0_A3"]=="MAC")
macao_patch = box(*macao_land.bounds).buffer(.015).envelope
mainland_coast = next(clean(shape(r.shape.__geo_interface__)).intersection(macao_patch) for r in admin0_records if r.record.as_dict()["ADM0_A3"]=="CHN")
china = []
for feature in cn_file("100000"):
    prop = feature["properties"]
    code = str(prop.get("adcode", ""))
    if not code.isdigit() or len(code) != 6:
        continue
    aggregate = code in {"110000", "120000", "310000", "500000", "710000", "810000", "820000"}
    if aggregate:
        local = ROOT / f".cache/geo/{code}.json"
        if not local.exists():
            urlretrieve(f"https://geo.datav.aliyun.com/areas_v3/bound/{code}.json",local)
        features_in_province = json.loads(local.read_text(encoding="utf8"))["features"]
    else:
        features_in_province = cn_file(code)
    parts = []
    for city in features_in_province:
        p = city["properties"]
        if not p.get("adcode"):
            continue
        rid = str(p["adcode"])
        # The admin polygon for Macao includes water. Use the coastal geometry
        # to show its peninsula and islands, retaining the original city code.
        geom = macao_land if rid=="820000" else clean(shape(city["geometry"]))
        if rid=="440400":
            # Give the adjoining estuary one coastline, otherwise the older
            # Zhuhai polygon can paint over the peninsula and Taipa.
            geom = clean(geom.difference(macao_patch).union(geom.intersection(mainland_coast)).difference(macao_land))
        regions.append([rid, p["name"], "", "CHN", code, *metadata(geom)])
        sources[rid] = geom
        parts.append(geom)
    g = outer_boundary(parts)
    china.append(g)
    provinces.append([code, prop["name"], *metadata(g)])
    sources["p"+code] = g
countries.append(["CHN", "中国", "China", 104, 35, 60])
sources["cCHN"] = outer_boundary(china, national=True)
skip = {"CHN", "MAC", "HKG", "TWN"}
for rec in admin0_records:
    p = rec.record.as_dict()
    code = p["ADM0_A3"]
    if code in skip:
        continue
    geom = clean(shape(rec.shape.__geo_interface__))
    countries.append([code, p["NAME_ZH"] or p["ADMIN"], p["ADMIN"], *metadata(geom)])
    sources["c"+code] = geom
known = {c[0] for c in countries}
for rec in read_ne("admin1", "admin_1_states_provinces").iterShapeRecords():
    p = rec.record.as_dict()
    code = p["adm0_a3"]
    if code in skip or code not in known:
        continue
    rid = "ne-" + p["adm1_code"].replace("+", "-p").replace("?", "-q")
    geom = clean(shape(rec.shape.__geo_interface__))
    name = p["name_zh"] or p["name_en"] or p["name"] or p["admin"]
    aliases = " ".join(dict.fromkeys(filter(None, [p["name_en"], p["name"], p["iso_3166_2"]])))
    regions.append([rid, name, aliases, code, "", *metadata(geom)])
    sources[rid] = geom
covered = {r[3] for r in regions}
for code, name, en, *anchor in countries:
    if code not in covered:
        rid = "ne0-"+code
        regions.append([rid, name, en, code, "", *anchor])
        sources[rid] = sources["c"+code]
assert sum(r[3] == "CHN" for r in regions) == 370
assert len({r[0] for r in regions}) == len(regions)
assert all(re.fullmatch(r"[A-Za-z0-9-]+", r[0]) for r in regions)
for region in regions:
    region.extend(focus_bounds(sources[region[0]]))

# Mesh indices 0..N-1 are writable regions. Province/country indices are outlines.
features = [r[0] for r in regions] + ["p"+p[0] for p in provinces] + ["c"+c[0] for c in countries]
packets = defaultdict(list)
for index, fid in enumerate(features):
    parts = sorted(polygons(sources[fid]), key=lambda g: -g.area)
    for j, poly in enumerate(parts):
        if j and poly.area < .000003:
            continue
        w,s,e,n = poly.bounds
        cx,cy = (w+e)/2, (s+n)/2
        key = int(min(11,(cx+180)//30)) + 12*int(min(8,(cy+90)//20))
        if e-w > 55 or n-s > 40:
            key = 200+index
        packets[key].append((index, poly, j == 0 or poly.area>=parts[0].area*.025))


def ints(values):
    return np.asarray(values, dtype="<i4").tobytes()


def rings(poly):
    result = []
    for ring in [poly.exterior, *poly.interiors]:
        points = [(int(round(x*SCALE)), int(round(y*SCALE))) for x,y in ring.coords]
        seq = [p for i,p in enumerate(points[:-1]) if i == 0 or p != points[i-1]]
        if len(set(seq)) >= 3:
            result.append(seq)
        elif ring == poly.exterior:
            return []
    return result


def pack_poly(idx, poly, fine, main):
    w,s,e,n = poly.bounds
    span = max(e-w, n-s)
    if not main and poly.area < (.000003 if fine else .018):
        return b""
    is_chinese = features[idx].lstrip("p").isdigit() or features[idx]=="cCHN"
    tol = min((.0013 if is_chinese else .004) if fine else .16, span/(160 if fine else 9))
    poly = orient(poly.simplify(tol, preserve_topology=True), sign=-1)
    outlines = rings(poly)
    if not outlines:
        return b""
    points = [p for ring in outlines for p in ring]
    ends = np.cumsum([len(a) for a in outlines]).tolist()
    triangles = []
    if idx < len(regions) or idx >= len(regions)+len(provinces):
        # Bound long chords on a sphere. Cuts only affect fill triangles; the
        # original exterior/hole rings separately supply borders, picking and SVG.
        step = 4 if fine else 7
        if span <= step:
            triangles = mapbox_earcut.triangulate_float64(np.asarray(points, dtype="d"), np.asarray(ends,dtype="uint32")).tolist()
        else:
            lookup = {p:i for i,p in enumerate(points)}
            for x in range(math.floor(w/step)*step, math.ceil(e/step)*step, step):
                for y in range(math.floor(s/step)*step, math.ceil(n/step)*step, step):
                    for piece in polygons(poly.intersection(box(x,y,x+step,y+step))):
                        parts = rings(piece)
                        if not parts:
                            continue
                        q = [p for seq in parts for p in seq]
                        ids = []
                        for p in q:
                            if p not in lookup:
                                lookup[p] = len(points)
                                points.append(p)
                            ids.append(lookup[p])
                        local = mapbox_earcut.triangulate_float64(np.asarray(q,dtype="d"), np.cumsum([len(r) for r in parts],dtype="uint32"))
                        triangles.extend(ids[i] for i in local)
    # Delta coding both the coordinate stream and local triangle indices makes
    # the gzipped packets compact. Decoder reconstructs signed int32 values.
    coords = np.asarray(points,dtype="<i4")
    coords[1:] = np.diff(coords, axis=0)
    tri = np.asarray(triangles,dtype="<i4")
    if len(tri)>1:
        tri[1:] = np.diff(tri)
    return struct.pack("<4I",idx,len(ends),len(points),len(tri)) + ints(ends) + coords.tobytes() + tri.tobytes()


def packet(key, items, fine):
    chunks = [data for idx,p,main in items if (data := pack_poly(idx,p,fine,main))]
    return struct.pack("<2I",key,len(chunks)) + b"".join(chunks)


def save(name, chunks):
    buf = gzip.compress(b"ORB1" + struct.pack("<I",len(chunks)) + b"".join(chunks), compresslevel=6,mtime=0)
    filename = f"{name}-{hashlib.sha256(buf).hexdigest()[:10]}.orb"
    (OUT/filename).write_bytes(buf)
    return filename


print(f"{len(regions)} regions, {len(countries)} country/territory entries, {len(packets)} mesh groups",flush=True)
low, files = [], {}
for key, items in sorted(packets.items()):
    low.append(packet(key, items, False))
    files[key] = save(str(key), [packet(key, items, True)])
base = save("world", low)
bounds = {}
for key, items in packets.items():
    boxes = np.array([p.bounds for _,p,_ in items])
    bounds[key] = [float(boxes[:,0].min()),float(boxes[:,1].min()),float(boxes[:,2].max()),float(boxes[:,3].max())]
catalog = dict(version=1, regions=regions, countries=countries, provinces=provinces, base=base, detail=files, bounds=bounds)
(OUT/"atlas.json").write_text(json.dumps(catalog, ensure_ascii=False,separators=(",",":")), encoding="utf8")
subprocess.run(["node", str(ROOT / "scripts/build-print.mjs")], check=True)
print("Overview bytes:",(OUT/base).stat().st_size,"Fine bytes:",sum((OUT/p).stat().st_size for p in files.values()), flush=True)
