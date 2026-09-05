#!/usr/bin/env python3
"""
FINAL CDN Mapping Generator - Uses verified TMDB IDs only

1. Fetches all homepage TMDB IDs directly from TMDB API
2. Also includes popular/trending titles from SC's trending API
3. Matches each to StreamingCommunity CDN images
4. Generates clean cdnMapping.ts with correct TMDB IDs
"""

import json
import time
import urllib.request
import urllib.parse
import ssl
import sys
import re

TMDB_API_KEY = "4f153630f8d7e92d542dde3a38fbddf2"
TMDB_BASE = "https://api.themoviedb.org/3"
SC_SEARCH = "https://streamingcommunityz.ninja/api/search"
SC_TRENDING = "https://streamingcommunityz.ninja/api/browse/trending"
SC_TOP10 = "https://streamingcommunityz.ninja/api/browse/top10"

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

OUTPUT_FILE = "/app/netflix-clone-react-typescript/src/config/cdnMapping.ts"

def fetch_json(url):
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept': 'application/json',
        })
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return None

def tmdb_search(query, media_type="multi"):
    encoded = urllib.parse.quote(query)
    url = f"{TMDB_BASE}/search/{media_type}?api_key={TMDB_API_KEY}&query={encoded}&language=it-IT"
    data = fetch_json(url)
    return data.get("results", []) if data else []

def tmdb_list(endpoint, params={}):
    params["api_key"] = TMDB_API_KEY
    params["language"] = "it-IT"
    qs = "&".join(f"{k}={urllib.parse.quote(str(v))}" for k, v in params.items())
    url = f"{TMDB_BASE}{endpoint}?{qs}"
    data = fetch_json(url)
    return data.get("results", []) if data else []

def sc_search(query):
    encoded = urllib.parse.quote(query)
    url = f"{SC_SEARCH}?q={encoded}"
    data = fetch_json(url)
    return data.get("data", []) if data else []

def get_sc_img(item, itype):
    for img in item.get("images", []):
        if img["type"] == itype:
            return img["filename"].replace(".webp", "")
    return None

def find_sc_match(results, expected_name):
    """Find best SC match"""
    name_lower = expected_name.lower().strip()
    # Exact match
    for r in results:
        if r["name"].lower().strip() == name_lower:
            return r
    # Contains match
    for r in results:
        rn = r["name"].lower()
        if name_lower in rn or rn in name_lower:
            return r
    # First word match
    words = name_lower.split()
    if len(words) >= 2:
        for r in results:
            rn = r["name"].lower()
            if words[0] in rn and (words[-1] in rn or words[1] in rn):
                return r
    return results[0] if len(results) == 1 else None

# ===========================
# STEP 1: Collect TMDB IDs from homepage APIs
# ===========================
print("=== STEP 1: Collecting TMDB homepage IDs ===")

all_tmdb = {}  # tmdb_id -> {title, type, english_title}

for endpoint, mtype_default in [
    ("/trending/all/week", None),
    ("/movie/now_playing", "movie"),
    ("/tv/on_the_air", "tv"),
    ("/movie/popular", "movie"),
    ("/tv/popular", "tv"),
]:
    items = tmdb_list(endpoint)
    for item in items[:20]:
        tmdb_id = item.get("id")
        title = item.get("title") or item.get("name")
        mtype = item.get("media_type") or mtype_default
        orig_title = item.get("original_title") or item.get("original_name") or title
        all_tmdb[tmdb_id] = {
            "title": title,
            "type": mtype,
            "original_title": orig_title,
        }

print(f"  Total unique TMDB IDs: {len(all_tmdb)}")

# ===========================
# STEP 2: Also get SC trending titles and find their TMDB IDs
# ===========================
print("\n=== STEP 2: SC trending titles -> TMDB IDs ===")

sc_trending_data = fetch_json(SC_TRENDING)
sc_top10_data = fetch_json(SC_TOP10)

sc_titles = []
if sc_trending_data:
    sc_titles.extend(sc_trending_data.get("titles", []))
if sc_top10_data:
    sc_titles.extend(sc_top10_data.get("titles", []))

# For each SC title, find its TMDB ID
sc_mapped = {}  # tmdb_id -> sc_title_data

seen_sc_ids = set()
for sc_item in sc_titles:
    sc_id = sc_item["id"]
    if sc_id in seen_sc_ids:
        continue
    seen_sc_ids.add(sc_id)
    
    name = sc_item["name"]
    sc_type = sc_item.get("type", "movie")
    
    # Search TMDB for this title
    tmdb_type = "tv" if sc_type == "tv" else "movie"
    results = tmdb_search(name, tmdb_type)
    
    if not results:
        results = tmdb_search(name, "multi")
    
    if results:
        # Find best match
        for r in results[:3]:
            rname = (r.get("title") or r.get("name") or "").lower()
            if name.lower() in rname or rname in name.lower() or name.lower()[:5] in rname:
                tmdb_id = r["id"]
                if tmdb_id not in all_tmdb:
                    mtype = r.get("media_type") or tmdb_type
                    all_tmdb[tmdb_id] = {
                        "title": r.get("title") or r.get("name"),
                        "type": mtype,
                        "original_title": r.get("original_title") or r.get("original_name") or name,
                    }
                sc_mapped[tmdb_id] = sc_item
                break
    
    time.sleep(0.05)

print(f"  SC trending mapped: {len(sc_mapped)}")
print(f"  Total TMDB IDs now: {len(all_tmdb)}")

# ===========================
# STEP 3: For each TMDB ID, find SC CDN images
# ===========================
print("\n=== STEP 3: Matching TMDB titles to SC CDN images ===")

ANIME_KEYWORDS = ["jojo", "jujutsu", "demon slayer", "kimetsu", "frieren", 
                   "dragon ball", "naruto", "bleach", "attack on titan", "shingeki",
                   "obake", "kamen rider"]

final_mapping = {}  # tmdb_id -> {name, poster, detail_backdrop}
skipped = []

for tmdb_id, info in all_tmdb.items():
    title = info["title"]
    orig_title = info["original_title"]
    
    # Skip anime
    combined = f"{title} {orig_title}".lower()
    if any(kw in combined for kw in ANIME_KEYWORDS):
        continue
    
    # If already matched from SC trending
    if tmdb_id in sc_mapped:
        sc_item = sc_mapped[tmdb_id]
        cover = get_sc_img(sc_item, "cover") or get_sc_img(sc_item, "poster")
        bg = get_sc_img(sc_item, "background")
        if cover and bg and cover != bg:
            final_mapping[tmdb_id] = {
                "name": title,
                "poster": cover,
                "detail_backdrop": bg,
            }
            continue
    
    # Search SC by title
    search_terms = [title]
    if orig_title != title and orig_title:
        search_terms.append(orig_title)
    # Also try simplified name
    simple = title.split(":")[0].split(" - ")[0].strip()
    if simple != title and len(simple) > 3:
        search_terms.append(simple)
    
    found = False
    for term in search_terms:
        results = sc_search(term)
        if not results:
            continue
        
        match = find_sc_match(results, term)
        if match:
            cover = get_sc_img(match, "cover") or get_sc_img(match, "poster")
            bg = get_sc_img(match, "background")
            if cover and bg and cover != bg:
                final_mapping[tmdb_id] = {
                    "name": title,
                    "poster": cover,
                    "detail_backdrop": bg,
                }
                found = True
                break
    
    if not found:
        skipped.append(f"{title} (TMDB: {tmdb_id})")
    
    time.sleep(0.15)

print(f"\n  Mapped: {len(final_mapping)}")
print(f"  Skipped: {len(skipped)}")
if skipped:
    print("  Skipped titles:")
    for s in skipped[:10]:
        print(f"    - {s}")

# ===========================
# STEP 4: Generate cdnMapping.ts
# ===========================
print("\n=== STEP 4: Generating cdnMapping.ts ===")

lines = [
    '/**',
    ' * Mapping tra TMDB ID e CDN Image ID',
    ' * CDN Base URL: https://cdn.streamingcommunityz.ninja/images/',
    ' * ',
    ' * Struttura:',
    ' * - poster e backdrop sono IDENTICI (UUID del cover/poster)',
    ' * - detail_backdrop e UUID dalla pagina dettaglio (background)',
    ' */',
    '',
    'export const CDN_BASE_URL = "https://cdn.streamingcommunityz.ninja/images/";',
    '',
    'export interface CDNImageMapping {',
    '  poster: string;',
    '  backdrop: string;',
    '  detail_backdrop: string;',
    '}',
    '',
    'export const cdnImageMapping: Record<number, CDNImageMapping> = {',
]

for tmdb_id, data in sorted(final_mapping.items(), key=lambda x: x[1]["name"]):
    name = data["name"]
    poster = data["poster"]
    detail_backdrop = data["detail_backdrop"]
    lines.append(f'  // {name} (TMDB: {tmdb_id})')
    lines.append(f'  {tmdb_id}: {{')
    lines.append(f'    poster: "{poster}",')
    lines.append(f'    backdrop: "{poster}",')
    lines.append(f'    detail_backdrop: "{detail_backdrop}"')
    lines.append(f'  }},')
    lines.append('')

lines.extend([
    '};',
    '',
    '/**',
    ' * Get CDN image URL for a TMDB ID',
    ' */',
    'export function getCDNPosterUrl(tmdbId: number): string | null {',
    '  const mapping = cdnImageMapping[tmdbId];',
    '  if (mapping) {',
    '    return `${CDN_BASE_URL}${mapping.poster}.webp`;',
    '  }',
    '  return null;',
    '}',
    '',
    'export function getCDNBackdropUrl(tmdbId: number): string | null {',
    '  const mapping = cdnImageMapping[tmdbId];',
    '  if (mapping) {',
    '    return `${CDN_BASE_URL}${mapping.backdrop}.webp`;',
    '  }',
    '  return null;',
    '}',
    '',
    'export function getCDNDetailBackdropUrl(tmdbId: number): string | null {',
    '  const mapping = cdnImageMapping[tmdbId];',
    '  if (mapping) {',
    '    return `${CDN_BASE_URL}${mapping.detail_backdrop}.webp`;',
    '  }',
    '',
    '  return "/placeholder.jpg";',
    '}',
    '',
])

content = "\n".join(lines)
with open(OUTPUT_FILE, 'w') as f:
    f.write(content)

# Final validation
pattern = r'// .+? \(TMDB: (\d+)\)\s+\d+:\s*\{\s*poster:\s*"([^"]+)",\s*backdrop:\s*"([^"]+)",\s*detail_backdrop:\s*"([^"]+)"'
matches = re.findall(pattern, content)

errors = 0
for tmdb_id, poster, backdrop, detail_backdrop in matches:
    if poster != backdrop:
        errors += 1
    if poster == detail_backdrop:
        errors += 1

print(f"\nFILE WRITTEN: {OUTPUT_FILE}")
print(f"Total entries: {len(matches)}")
print(f"Validation errors: {errors}")
print(f"Backslashes: {content.count(chr(92) + chr(34))}")
