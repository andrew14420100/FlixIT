#!/usr/bin/env python3
"""
Script to fix cdnMapping.ts entries by fetching the correct detail_backdrop
from the StreamingCommunity API.

For each entry where detail_backdrop == poster (meaning it was never properly scraped),
this script:
1. Searches for the title on the API
2. Finds the matching result
3. Extracts the 'background' type image UUID as the detail_backdrop
"""

import re
import json
import time
import urllib.request
import urllib.parse
import ssl

CDN_MAPPING_FILE = "/app/netflix-clone-react-typescript/src/config/cdnMapping.ts"
API_BASE = "https://streamingcommunityz.ninja/api/search"

# Create SSL context that doesn't verify (for compatibility)
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def search_title(query):
    """Search for a title on the StreamingCommunity API"""
    encoded = urllib.parse.quote(query)
    url = f"{API_BASE}?q={encoded}"
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
        })
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return data.get('data', [])
    except Exception as e:
        print(f"  ERROR searching '{query}': {e}")
        return []

def find_best_match(results, title_name):
    """Find the best matching result from the search results"""
    title_lower = title_name.lower().strip()
    
    # First try exact match
    for r in results:
        if r['name'].lower().strip() == title_lower:
            return r
    
    # Try partial match - title contained in result or vice versa
    for r in results:
        rname = r['name'].lower().strip()
        if title_lower in rname or rname in title_lower:
            return r
    
    # Try first word match
    first_word = title_lower.split()[0] if title_lower.split() else ''
    for r in results:
        if r['name'].lower().startswith(first_word):
            return r
    
    # Return first result if any
    return results[0] if results else None

def get_background_uuid(title_data):
    """Extract the background UUID from the title data"""
    images = title_data.get('images', [])
    for img in images:
        if img.get('type') == 'background':
            filename = img.get('filename', '')
            # Remove .webp extension to get UUID
            return filename.replace('.webp', '')
    return None

def get_poster_uuid(title_data):
    """Extract the poster UUID from the title data"""
    images = title_data.get('images', [])
    for img in images:
        if img.get('type') == 'poster':
            filename = img.get('filename', '')
            return filename.replace('.webp', '')
    return None

def get_cover_uuid(title_data):
    """Extract the cover UUID from the title data"""
    images = title_data.get('images', [])
    for img in images:
        if img.get('type') == 'cover':
            filename = img.get('filename', '')
            return filename.replace('.webp', '')
    return None

def parse_cdn_mapping():
    """Parse the cdnMapping.ts file and extract all entries"""
    with open(CDN_MAPPING_FILE, 'r') as f:
        content = f.read()
    
    pattern = r'// (.+?) \(TMDB: (\d+)\)\s+(\d+):\s*\{\s*poster:\s*"([^"]+)",\s*backdrop:\s*"([^"]+)",\s*detail_backdrop:\s*"([^"]+)"\s*\}'
    matches = re.findall(pattern, content)
    
    entries = []
    for name, tmdb_id, key, poster, backdrop, detail_backdrop in matches:
        entries.append({
            'name': name,
            'tmdb_id': int(tmdb_id),
            'key': int(key),
            'poster': poster,
            'backdrop': backdrop,
            'detail_backdrop': detail_backdrop,
            'needs_fix': poster == detail_backdrop
        })
    
    return entries

def main():
    entries = parse_cdn_mapping()
    needs_fix = [e for e in entries if e['needs_fix']]
    
    print(f"Total entries: {len(entries)}")
    print(f"Entries needing fix: {len(needs_fix)}")
    print("=" * 80)
    
    fixes = {}  # tmdb_id -> new_detail_backdrop
    
    for i, entry in enumerate(needs_fix):
        name = entry['name']
        tmdb_id = entry['tmdb_id']
        print(f"\n[{i+1}/{len(needs_fix)}] Searching: {name} (TMDB: {tmdb_id})")
        
        results = search_title(name)
        if not results:
            print(f"  No results found for '{name}'")
            # Try shorter search
            short_name = name.split(':')[0].split('(')[0].strip()
            if short_name != name:
                print(f"  Trying shorter name: '{short_name}'")
                results = search_title(short_name)
        
        if not results:
            print(f"  STILL NO RESULTS for '{name}'")
            continue
        
        match = find_best_match(results, name)
        if not match:
            print(f"  No matching title found in results for '{name}'")
            continue
        
        bg_uuid = get_background_uuid(match)
        if bg_uuid:
            fixes[tmdb_id] = bg_uuid
            print(f"  FOUND: {match['name']} (site id: {match['id']})")
            print(f"  detail_backdrop: {bg_uuid}")
        else:
            print(f"  WARNING: No background image for '{match['name']}'")
            # Try cover as fallback
            cover = get_cover_uuid(match)
            if cover:
                fixes[tmdb_id] = cover
                print(f"  Using cover as fallback: {cover}")
        
        time.sleep(0.3)  # Small delay to be polite
    
    print("\n" + "=" * 80)
    print(f"Total fixes found: {len(fixes)}")
    
    # Now update the file
    with open(CDN_MAPPING_FILE, 'r') as f:
        content = f.read()
    
    changes_made = 0
    for tmdb_id, new_detail_backdrop in fixes.items():
        # Find the entry and replace detail_backdrop
        old_entry = [e for e in entries if e['tmdb_id'] == tmdb_id]
        if old_entry:
            old_detail = old_entry[0]['detail_backdrop']
            old_str = f'detail_backdrop: "{old_detail}"'
            new_str = f'detail_backdrop: "{new_detail_backdrop}"'
            
            # We need to be careful to only replace within the right entry
            # Find the pattern: TMDB_ID: { ... detail_backdrop: "OLD" }
            pattern = f'  {tmdb_id}: {{\n    poster: "[^"]+",\n    backdrop: "[^"]+",\n    detail_backdrop: "{old_detail}"'
            replacement_pattern = lambda m: m.group(0).replace(f'detail_backdrop: "{old_detail}"', f'detail_backdrop: "{new_detail_backdrop}"')
            
            new_content = re.sub(pattern, replacement_pattern, content)
            if new_content != content:
                content = new_content
                changes_made += 1
                print(f"  Updated TMDB {tmdb_id}: {old_detail} -> {new_detail_backdrop}")
    
    with open(CDN_MAPPING_FILE, 'w') as f:
        f.write(content)
    
    print(f"\nDone! Made {changes_made} changes to {CDN_MAPPING_FILE}")
    
    # Print summary of unfixed entries
    fixed_ids = set(fixes.keys())
    still_broken = [e for e in needs_fix if e['tmdb_id'] not in fixed_ids]
    if still_broken:
        print(f"\nWARNING: {len(still_broken)} entries still need manual fixing:")
        for e in still_broken:
            print(f"  - {e['name']} (TMDB: {e['tmdb_id']})")

if __name__ == '__main__':
    main()
