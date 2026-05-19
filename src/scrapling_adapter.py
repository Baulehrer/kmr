import sys
import json
import re
import html
import math
from urllib.parse import quote, quote_plus
from scrapling.fetchers import Fetcher


def fetch_url(url: str) -> dict:
    try:
        page = Fetcher.get(url, stealthy_headers=True)
        body = page.body if isinstance(page.body, str) else page.body.decode("utf-8", errors="replace")
        return {"status": page.status, "body": body, "error": None}
    except Exception as e:
        return {"status": 0, "body": "", "error": str(e)}


def search_artist(name: str) -> dict:
    encoded = quote(name)
    url = (
        f"https://www.metal-archives.com/search/ajax-advanced/searching/bands/"
        f"?bandName={encoded}&exactBandLogoName=1"
        f"&sEcho=1&iColumns=5&sColumns=&iDisplayStart=0&iDisplayLength=10"
        f"&mDataProp_0=0&mDataProp_1=1&mDataProp_2=2&mDataProp_3=3&mDataProp_4=4"
    )
    result = fetch_url(url)
    if result["error"] or result["status"] != 200:
        return result

    try:
        data = json.loads(result["body"])
        records = data.get("aaData", [])
        if not records:
            result["parsed"] = None
            return result

        row = records[0]
        html_name = row[0]
        match = re.search(r'href="[^"]*/bands/[^/]+/(\d+)"', html_name)
        name_match = re.search(r'>([^<]+)<', html_name)

        result["parsed"] = {
            "maId": int(match.group(1)) if match else None,
            "name": html.unescape(name_match.group(1)) if name_match else name,
            "genre": html.unescape(row[1]) if len(row) > 1 else "",
            "country": html.unescape(row[2]) if len(row) > 2 else "",
        }
    except Exception as e:
        result["parsed"] = None
        result["parse_error"] = str(e)

    return result


def get_artist_detail(ma_id: int, name: str) -> dict:
    encoded = quote(name.replace(" ", "_"), safe="_-")
    url = f"https://www.metal-archives.com/bands/{encoded}/{ma_id}"
    return fetch_url(url)


def get_similar_artists(ma_id: int) -> dict:
    url = f"https://www.metal-archives.com/band/ajax-recommendations/id/{ma_id}"
    result = fetch_url(url)
    if result["error"] or result["status"] != 200:
        return result

    try:
        body = result["body"]
        pattern = (
            r'<tr[^>]*>[\s\S]*?'
            r'<a[^>]*href="[^"]*/bands/[^/]+/(\d+)"[^>]*>([^<]+)</a>'
            r'</td>\s*<td>([^<]*)</td>\s*<td>([^<]*)</td>'
            r'[\s\S]*?id="score_\1">(\d+)'
        )
        similar = []
        for m in re.finditer(pattern, body):
            similar.append({
                "maId": int(m.group(1)),
                "name": html.unescape(m.group(2).strip()),
                "country": html.unescape(m.group(3).strip()),
                "genre": html.unescape(m.group(4).strip()),
                "score": int(m.group(5)),
            })
        result["parsed"] = similar
    except Exception as e:
        result["parsed"] = []
        result["parse_error"] = str(e)

    return result


MA_GENRES = [
    "Black Metal", "Death Metal", "Doom Metal", "Heavy Metal", "Power Metal",
    "Progressive Metal", "Speed Metal", "Thrash Metal", "Alternative Metal",
    "Avant-garde Metal", "Blackened Death Metal", "Blackened Crust",
    "Blackened Doom Metal", "Blackened Sludge Metal", "Blackened Thrash Metal",
    "Brutal Death Metal", "Chamber Music", "Christian Metal", "Classic Heavy Metal",
    "Crossover Thrash", "Crust Punk", "Dark Metal", "Darkwave", "Death-doom Metal",
    "Death 'n' Roll", "Depressive Black Metal", "Djent", "Drone Metal", "Dungeon Synth",
    "Epic Doom Metal", "Epic Heavy Metal", "Experimental Metal", "Folk Metal",
    "Funeral Doom Metal", "Glam Metal", "Goregrind", "Grindcore", "Groove Metal",
    "Hard Rock", "Hardcore Punk", "Heavy Metal/Rock", "Industrial Metal", "Industrial",
    "Math Metal", "Mathcore", "Melodic Black Metal", "Melodic Death Metal",
    "Melodic Doom Metal", "Melodic Heavy Metal", "Melodic Metal", "Melodic Power Metal",
    "Melodic Speed Metal", "Melodic Thrash Metal", "Metalcore", "Minccore",
    "Neoclassical Metal", "Noisecore", "NS Black Metal", "Nu Metal", "Pirate Metal",
    "Post-metal", "Post-punk", "Post-sludge Metal", "Power/Thrash Metal",
    "Progressive Death Metal", "Progressive Doom Metal", "Progressive Rock",
    "Psychedelic Rock", "Raw Black Metal", "Riff-based Death Metal",
    "Riff-based Doom Metal", "Riff-based Heavy Metal", "Riff-based Thrash Metal",
    "Rock", "Sludge Metal", "Speed/Thrash Metal", "Stoner Metal", "Stoner Rock",
    "Suicidal Black Metal", "Symphonic Black Metal", "Symphonic Metal",
    "Technical Death Metal", "Technical Thrash Metal", "Thrash/Speed Metal",
    "Traditional Doom Metal", "Traditional Heavy Metal", "Viking Metal",
    "War Metal", "Atmospheric Black Metal", "Atmospheric Doom Metal",
    "Atmospheric Sludge Metal", "Bay Area Thrash Metal", "Bestial Black Metal",
    "Brutal Technical Death Metal", "Cascadian Black Metal", "Cavernous Death Metal",
    "Chiptune Metal", "Cosmic Death Metal", "Cosmic Doom Metal", "Cosmic Horror Metal",
    "Cosmic Sludge Metal", "Dissonant Black Metal", "Dissonant Death Metal",
    "D-beat", "Eastern European Folk Metal", "Epic Black Metal", "Epic Death Metal",
    "Epic Metal", "Folk Black Metal", "Folk Death Metal", "Folk Doom Metal",
    "Folk Progressive Metal", "Folk Thrash Metal", "Gothic Doom Metal",
    "Gothic Metal", "Gothic Rock", "Grindcore/Death Metal", "Groove Thrash Metal",
    "Hellenic Black Metal", "Horror Metal", "Hyper Technical Death Metal",
    "Indie Rock", "Jazz-influenced Metal", "Krautrock", "Latin Folk Metal",
    "Left-Hand Path Black Metal", "Melodeath", "Melodic Blackened Death Metal",
    "Melodic Metalcore", "Melodic Technical Death Metal", "Mixture Metal",
    "Necro Black Metal", "Occult Black Metal", "Occult Doom Metal",
    "Occult Rock", "Old-school Death Metal", "Old-school Doom Metal",
    "Oriental Metal", "Pagan Black Metal", "Pagan Metal", "Pinoy Metal",
    "Post-black Metal", "Post-Death Metal", "Post-hardcore", "Post-punk/Coldwave",
    "Psychedelic Doom Metal", "Psychobilly", "RAC", "Redneck Metal",
    "Riff-based Sludge Metal", "Ritual Black Metal", "Ritual Doom Metal",
    "Screamo", "Shoegaze", "Sludge/Doom Metal", "Sludge/Post-metal",
    "Sleaze Metal", "Space Rock", "Speed Metal/Rock", "Symphonic Death Metal",
    "Symphonic Doom Metal", "Technical Black Metal", "Technical Doom Metal",
    "Technical Groove Metal", "Technical Thrash/Death Metal",
    "Teutonic Thrash Metal", "Trad Doom Metal/Rock", "Troll Metal",
    "Unblack Metal", "US Black Metal", "USPM", "Visual Kei",
    "War Black Metal", "War Grind", "Western Metal",
]


def musicmap_similar(query: str) -> dict:
    slug = quote_plus(query.strip().lower().replace(" ", "+"), safe="+")
    url = f"https://www.music-map.com/{slug}"
    result = fetch_url(url)
    if result["error"] or result["status"] != 200:
        result["parsed"] = []
        return result

    body = result["body"]

    # 1. Extract artists in id order. Format: <a ... class=S id=s0>NAME</a>
    name_pattern = re.compile(
        r'<a[^>]*\bclass=S\s+id=s(\d+)[^>]*>([^<]+)</a>',
        re.IGNORECASE,
    )
    by_id: dict[int, str] = {}
    for m in name_pattern.finditer(body):
        idx = int(m.group(1))
        by_id[idx] = html.unescape(m.group(2)).strip()

    if not by_id:
        result["parsed"] = []
        return result

    # 2. Extract Aid[0]=new Array(-1, x1, x2, ...) — row 0 = similarity FROM query
    row0 = re.search(r'Aid\[0\]\s*=\s*new\s+Array\(([^)]+)\)', body)
    similar: list[dict] = []
    if row0:
        try:
            raw_scores = [float(s.strip()) for s in row0.group(1).split(',')]
            # raw_scores[i] is similarity of artist i to query (i=0 is -1 self)
            valid = [(i, s) for i, s in enumerate(raw_scores) if i > 0 and s > 0 and i in by_id]
            max_s = max(s for _, s in valid) if valid else 1.0
            for i, s in valid:
                score = max(1, min(100, int(round(100 * s / max_s))))
                similar.append({"name": by_id[i], "score": score})
        except (ValueError, IndexError):
            pass

    # 3. Fallback: rank-based scoring when no similarity matrix is found
    if not similar:
        ordered = [n for i, n in sorted(by_id.items()) if i > 0]
        total = len(ordered) or 1
        for rank, name in enumerate(ordered):
            score = max(1, int(round(100 * (1 - rank / total))))
            similar.append({"name": name, "score": score})

    similar.sort(key=lambda x: x["score"], reverse=True)
    result["parsed"] = similar
    return result


def browse_genres() -> dict:
    """Fetch live genre list from MA's browse/genre page."""
    url = "https://www.metal-archives.com/browse/genre"
    result = fetch_url(url)
    if result["error"] or result["status"] != 200:
        return {"genres": MA_GENRES}
    try:
        body = result["body"]
        # Parse <a href="/browse/genre/...">Genre Name</a>
        genre_links = re.findall(
            r'<a[^>]*href="/browse/genre/[^"]*"[^>]*>([^<]+)</a>', body
        )
        genres = sorted(set(html.unescape(g.strip()) for g in genre_links if g.strip()))
        return {"genres": genres if genres else MA_GENRES}
    except Exception as e:
        return {"genres": MA_GENRES, "error": str(e)}


def get_genres_countries() -> dict:
    result = fetch_url("https://www.metal-archives.com/search/advanced/")
    if result["error"] or result["status"] != 200:
        return {"genres": MA_GENRES, "countries": []}
    try:
        body = result["body"]
        country_section = re.search(r'name="country"[^>]*>(.*?)</select>', body, re.DOTALL)
        countries: list[str] = []
        if country_section:
            countries = [
                html.unescape(m.strip())
                for m in re.findall(r'<option[^>]*>([^<]+)</option>', country_section.group(1))
                if m.strip() and m.strip() != "(Any)"
            ]
        return {"genres": MA_GENRES, "countries": countries}
    except Exception as e:
        return {"genres": MA_GENRES, "countries": [], "error": str(e)}


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing command"}))
        return

    command = sys.argv[1]
    try:
        if command == "search":
            out = search_artist(sys.argv[2])
        elif command == "detail":
            out = get_artist_detail(int(sys.argv[2]), sys.argv[3])
        elif command == "similar":
            out = get_similar_artists(int(sys.argv[2]))
        elif command == "genres":
            out = get_genres_countries()
        elif command == "browse-genres":
            out = browse_genres()
        elif command == "musicmap-similar":
            out = musicmap_similar(sys.argv[2])
        elif command == "fetch":
            out = fetch_url(sys.argv[2])
        else:
            out = {"error": f"Unknown command: {command}"}
    except (IndexError, ValueError) as e:
        out = {"error": f"Invalid args for '{command}': {e}"}

    print(json.dumps(out))


if __name__ == "__main__":
    main()
