from services.netflix_artwork import ArtworkResolver, normalize_title


def resolver_without_db():
    return ArtworkResolver.__new__(ArtworkResolver)


def test_title_normalization_is_strict_but_accent_insensitive():
    assert normalize_title("La città & il mare") == "la citta e il mare"


def test_exact_title_and_year_is_safe_auto_match():
    resolver = resolver_without_db()
    identity = {"title": "Dark", "original_title": "Dark", "year": 2017}
    candidate = {"title": "Dark", "year": 2017}
    assert resolver._score_match(identity, candidate) >= 0.95


def test_same_title_wrong_year_is_not_safe_auto_match():
    resolver = resolver_without_db()
    identity = {"title": "Suspiria", "original_title": "Suspiria", "year": 1977}
    candidate = {"title": "Suspiria", "year": 2018}
    assert resolver._score_match(identity, candidate) < 0.95


def test_title_only_is_not_enough_for_automatic_assignment():
    resolver = resolver_without_db()
    identity = {"title": "Crash", "original_title": "Crash", "year": 2004}
    candidate = {"title": "Crash", "year": None}
    assert resolver._score_match(identity, candidate) < 0.95


def test_unrelated_title_never_matches():
    resolver = resolver_without_db()
    identity = {"title": "Dark", "original_title": "Dark", "year": 2017}
    candidate = {"title": "1899", "year": 2022}
    assert resolver._score_match(identity, candidate) == 0


def test_hero_rejects_thumbnail_resolution():
    resolver = resolver_without_db()
    tiny = {"type": "storyArt", "url": "https://example/tiny.webp", "width": 640, "height": 360}
    large = {"type": "storyArt", "url": "https://example/large.webp", "width": 1920, "height": 1080}
    assert resolver._asset_score(tiny, "hero", "desktop") < 0
    assert resolver._asset_score(large, "hero", "desktop") > 0


def test_top10_prefers_vertical_high_res_boxart():
    resolver = resolver_without_db()
    vertical = {"type": "boxartHighRes", "url": "https://example/v.webp", "width": 1000, "height": 1428}
    horizontal = {"type": "storyArt", "url": "https://example/h.webp", "width": 1920, "height": 1080}
    assert resolver._asset_score(vertical, "top10", "desktop") > resolver._asset_score(horizontal, "top10", "desktop")
