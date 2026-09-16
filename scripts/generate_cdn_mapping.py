#!/usr/bin/env python3
"""
Complete CDN Mapping Generator for Netflix Clone Homepage

Fetches ALL TMDB IDs that appear on the homepage (trending, now_playing, on_the_air, popular, top_rated)
and matches them to StreamingCommunity CDN image UUIDs.

Structure:
- poster = cover UUID from StreamingCommunity (or poster UUID as fallback)
- backdrop = same as poster
- detail_backdrop = background UUID from StreamingCommunity
"""

import json
import time
import urllib.request
import urllib.parse
import ssl
import sys

TMDB_API_KEY = "4f153630f8d7e92d542dde3a38fbddf2"
TMDB_BASE = "https://api.themoviedb.org/3"
SC_SEARCH_API = "https://streamingcommunityz.ninja/api/search"

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def fetch_json(url):
    """Fetch JSON from a URL"""
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
        })
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        print(f"  ERROR fetching {url[:80]}...: {e}", file=sys.stderr)
        return None

def fetch_tmdb_list(endpoint, params={}):
    """Fetch a list from TMDB API"""
    params["api_key"] = TMDB_API_KEY
    params["language"] = "it-IT"
    qs = "&".join(f"{k}={urllib.parse.quote(str(v))}" for k, v in params.items())
    url = f"{TMDB_BASE}{endpoint}?{qs}"
    data = fetch_json(url)
    if data and "results" in data:
        return data["results"]
    return []

def search_sc(query):
    """Search StreamingCommunity for a title"""
    encoded = urllib.parse.quote(query)
    url = f"{SC_SEARCH_API}?q={encoded}"
    data = fetch_json(url)
    if data and "data" in data:
        return data["data"]
    return []

def find_best_match(results, title_name, year=None):
    """Find best match from SC search results"""
    title_lower = title_name.lower().strip()
    
    # First: exact name match
    for r in results:
        if r['name'].lower().strip() == title_lower:
            return r
    
    # Second: try with common translations
    translations = {
        "the vampire diaries": "the vampire diaries",
        "grey's anatomy": "grey's anatomy", 
        "chicago p.d.": "chicago p.d.",
    }
    for r in results:
        rname = r['name'].lower().strip()
        if title_lower in rname or rname in title_lower:
            return r
    
    # Third: first word match for multi-word titles
    words = title_lower.split()
    if len(words) > 1:
        for r in results:
            rname = r['name'].lower()
            if words[0] in rname and words[-1] in rname:
                return r
    
    # Fourth: return first result if only 1 result
    if len(results) == 1:
        return results[0]
    
    # Fifth: try matching by year if available
    if year and results:
        for r in results:
            last_air = r.get('last_air_date', '')
            if last_air and str(year) in last_air[:4]:
                return r
    
    # Last resort: first result
    return results[0] if results else None

def get_image_uuid(title_data, img_type):
    """Get UUID for a specific image type"""
    images = title_data.get('images', [])
    for img in images:
        if img.get('type') == img_type:
            return img.get('filename', '').replace('.webp', '')
    return None

def main():
    print("=== Fetching TMDB homepage content ===")
    
    # Collect all unique TMDB IDs + titles from homepage endpoints
    all_content = {}  # tmdb_id -> {title, type, year}
    
    # 1. Trending all/week (I titoli del momento) - 20 items
    print("\n[1/5] Fetching TMDB trending/all/week...")
    for item in fetch_tmdb_list("/trending/all/week"):
        tmdb_id = item.get("id")
        title = item.get("title") or item.get("name")
        media_type = item.get("media_type", "movie")
        year = (item.get("release_date") or item.get("first_air_date") or "")[:4]
        all_content[tmdb_id] = {"title": title, "type": media_type, "year": year}
    print(f"  Found {len(all_content)} items")
    
    # 2. Movie now_playing (Aggiunti di recente - movies)
    print("\n[2/5] Fetching TMDB movie/now_playing...")
    before = len(all_content)
    for item in fetch_tmdb_list("/movie/now_playing"):
        tmdb_id = item.get("id")
        if tmdb_id not in all_content:
            title = item.get("title")
            year = (item.get("release_date") or "")[:4]
            all_content[tmdb_id] = {"title": title, "type": "movie", "year": year}
    print(f"  Added {len(all_content) - before} new items (total: {len(all_content)})")
    
    # 3. TV on_the_air (Aggiunti di recente - TV)
    print("\n[3/5] Fetching TMDB tv/on_the_air...")
    before = len(all_content)
    for item in fetch_tmdb_list("/tv/on_the_air"):
        tmdb_id = item.get("id")
        if tmdb_id not in all_content:
            title = item.get("name")
            year = (item.get("first_air_date") or "")[:4]
            all_content[tmdb_id] = {"title": title, "type": "tv", "year": year}
    print(f"  Added {len(all_content) - before} new items (total: {len(all_content)})")
    
    # 4. Movie popular
    print("\n[4/5] Fetching TMDB movie/popular...")
    before = len(all_content)
    for item in fetch_tmdb_list("/movie/popular"):
        tmdb_id = item.get("id")
        if tmdb_id not in all_content:
            title = item.get("title")
            year = (item.get("release_date") or "")[:4]
            all_content[tmdb_id] = {"title": title, "type": "movie", "year": year}
    print(f"  Added {len(all_content) - before} new items (total: {len(all_content)})")
    
    # 5. TV popular
    print("\n[5/5] Fetching TMDB tv/popular...")
    before = len(all_content)
    for item in fetch_tmdb_list("/tv/popular"):
        tmdb_id = item.get("id")
        if tmdb_id not in all_content:
            title = item.get("name")
            year = (item.get("first_air_date") or "")[:4]
            all_content[tmdb_id] = {"title": title, "type": "tv", "year": year}
    print(f"  Added {len(all_content) - before} new items (total: {len(all_content)})")
    
    print(f"\n=== Total unique TMDB IDs: {len(all_content)} ===")
    
    # Now search each title on StreamingCommunity
    print("\n=== Searching StreamingCommunity for each title ===")
    
    mapped = {}  # tmdb_id -> {name, poster, backdrop, detail_backdrop}
    not_found = []
    
    for i, (tmdb_id, info) in enumerate(all_content.items()):
        title = info["title"]
        year = info["year"]
        
        if not title:
            continue
        
        print(f"\n[{i+1}/{len(all_content)}] {title} (TMDB: {tmdb_id}, {info['type']}, {year})")
        
        results = search_sc(title)
        
        if not results:
            # Try simplified search
            simple = title.split(":")[0].split("(")[0].strip()
            if simple != title:
                print(f"  Retrying with: '{simple}'")
                results = search_sc(simple)
        
        if not results:
            print(f"  NOT FOUND on StreamingCommunity")
            not_found.append(f"{title} (TMDB: {tmdb_id})")
            continue
        
        match = find_best_match(results, title, year)
        if not match:
            print(f"  No suitable match found")
            not_found.append(f"{title} (TMDB: {tmdb_id})")
            continue
        
        # Get image UUIDs - prefer cover for poster, background for detail_backdrop
        poster_uuid = get_image_uuid(match, "cover") or get_image_uuid(match, "poster")
        bg_uuid = get_image_uuid(match, "background")
        
        if poster_uuid and bg_uuid and poster_uuid != bg_uuid:
            mapped[tmdb_id] = {
                "name": title,
                "poster": poster_uuid,
                "detail_backdrop": bg_uuid,
            }
            print(f"  MATCHED: {match['name']} (SC id: {match['id']})")
            print(f"  poster: {poster_uuid}")
            print(f"  detail_backdrop: {bg_uuid}")
        elif poster_uuid and bg_uuid:
            # poster == bg_uuid, try alternative
            alt_bg = get_image_uuid(match, "cover_mobile")
            if alt_bg and alt_bg != poster_uuid:
                mapped[tmdb_id] = {
                    "name": title,
                    "poster": poster_uuid,
                    "detail_backdrop": alt_bg,
                }
                print(f"  MATCHED (alt bg): {match['name']}")
            else:
                mapped[tmdb_id] = {
                    "name": title,
                    "poster": poster_uuid,
                    "detail_backdrop": bg_uuid,
                }
                print(f"  MATCHED (same bg): {match['name']}")
        elif poster_uuid:
            # No background, try poster as both
            mapped[tmdb_id] = {
                "name": title,
                "poster": poster_uuid,
                "detail_backdrop": get_image_uuid(match, "poster") or poster_uuid,
            }
            print(f"  MATCHED (no bg): {match['name']}")
        else:
            print(f"  No usable images for: {match['name']}")
            not_found.append(f"{title} (TMDB: {tmdb_id}) - no images")
        
        time.sleep(0.2)  # Rate limit
    
    print(f"\n=== Results ===")
    print(f"Total TMDB IDs: {len(all_content)}")
    print(f"Mapped: {len(mapped)}")
    print(f"Not found: {len(not_found)}")
    
    if not_found:
        print("\n--- Not Found ---")
        for nf in not_found:
            print(f"  - {nf}")
    
    # Generate the cdnMapping.ts file
    print(f"\n=== Generating cdnMapping.ts ===")
    
    output_file = "/app/netflix-clone-react-typescript/src/config/cdnMapping.ts"
    
    lines = []
    lines.append('/**')
    lines.append(' * Mapping tra TMDB ID e CDN Image ID')
    lines.append(' * CDN Base URL: https://cdn.streamingcommunityz.ninja/images/')
    lines.append(' * ')
    lines.append(' * Struttura:')
    lines.append(' * - poster e backdrop sono IDENTICI (UUID del poster/cover)')
    lines.append(' * - detail_backdrop e UUID dalla pagina dettaglio (background)')
    lines.append(' */')
    lines.append('')
    lines.append('export const CDN_BASE_URL = "https://cdn.streamingcommunityz.ninja/images/";')
    lines.append('')
    lines.append('export interface CDNImageMapping {')
    lines.append('  poster: string;')
    lines.append('  backdrop: string;')
    lines.append('  detail_backdrop: string;')
    lines.append('}')
    lines.append('')
    lines.append('export const cdnImageMapping: Record<number, CDNImageMapping> = {')
    
    for tmdb_id, data in sorted(mapped.items(), key=lambda x: x[1]["name"]):
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
    
    lines.append('};')
    lines.append('')
    
    # Add the helper functions from the original file
    lines.append('/**')
    lines.append(' * Get CDN image URL for a TMDB ID')
    lines.append(' */')
    lines.append('export function getCDNPosterUrl(tmdbId: number): string | null {')
    lines.append('  const mapping = cdnImageMapping[tmdbId];')
    lines.append('  if (mapping) {')
    lines.append('    return `${CDN_BASE_URL}${mapping.poster}.webp`;')
    lines.append('  }')
    lines.append('  return null;')
    lines.append('}')
    lines.append('')
    lines.append('export function getCDNBackdropUrl(tmdbId: number): string | null {')
    lines.append('  const mapping = cdnImageMapping[tmdbId];')
    lines.append('  if (mapping) {')
    lines.append('    return `${CDN_BASE_URL}${mapping.backdrop}.webp`;')
    lines.append('  }')
    lines.append('  return null;')
    lines.append('}')
    lines.append('')
    lines.append('export function getCDNDetailBackdropUrl(tmdbId: number): string | null {')
    lines.append('  const mapping = cdnImageMapping[tmdbId];')
    lines.append('  if (mapping) {')
    lines.append('    return `${CDN_BASE_URL}${mapping.detail_backdrop}.webp`;')
    lines.append('  }')
    lines.append('')
    lines.append('  return "/placeholder.jpg";')
    lines.append('}')
    lines.append('')
    
    content = "\n".join(lines)
    
    with open(output_file, 'w') as f:
        f.write(content)
    
    print(f"\nFile written: {output_file}")
    print(f"Total entries: {len(mapped)}")
    
    # Save mapping as JSON for reference
    with open("/app/scripts/cdn_mapping_data.json", 'w') as f:
        json.dump({"mapped": mapped, "not_found": not_found, "total_tmdb": len(all_content)}, f, indent=2)
    print("JSON data saved: /app/scripts/cdn_mapping_data.json")

if __name__ == '__main__':
    main()
