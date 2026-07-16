import sys
import json
import re
import html
from urllib.parse import quote
from scrapling.fetchers import Fetcher


def fetch_url(url: str) -> dict:
    try:
        page = Fetcher.get(url, stealthy_headers=True)
        body = page.body if isinstance(page.body, str) else page.body.decode("utf-8", errors="replace")
        return {"status": page.status, "body": body, "error": None}
    except Exception as e:
        return {"status": 0, "body": "", "error": str(e)}


def search_artists(name: str) -> dict:
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
        parsed = []
        for row in records:
            html_name = row[0]
            match = re.search(r'href="[^"]*/bands/[^/]+/(\d+)"', html_name)
            name_match = re.search(r'>([^<]+)<', html_name)
            if not match:
                continue
            parsed.append({
                "maId": int(match.group(1)),
                "name": html.unescape(name_match.group(1)) if name_match else name,
                "genre": html.unescape(row[1]) if len(row) > 1 else "",
                "country": html.unescape(row[2]) if len(row) > 2 else "",
                "formedIn": html.unescape(row[3]) if len(row) > 3 and row[3] != "N/A" else None,
            })
        result["parsed"] = parsed
    except Exception as e:
        result["parsed"] = None
        result["parse_error"] = str(e)

    return result


def get_discography(ma_id: int) -> dict:
    result = fetch_url(f"https://www.metal-archives.com/band/discography/id/{ma_id}/tab/all")
    if result["error"] or result["status"] != 200:
        return result
    releases = []
    pattern = re.compile(
        r'<tr>\s*<td><a href="[^"]*/albums/[^/]+/[^/]+/(\d+)"[^>]*>(.*?)</a></td>'
        r'\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>',
        re.IGNORECASE | re.DOTALL,
    )
    for match in pattern.finditer(result["body"]):
        clean = lambda value: html.unescape(re.sub(r"<[^>]+>", "", value)).strip()
        releases.append({
            "maId": ma_id,
            "albumId": int(match.group(1)),
            "title": clean(match.group(2)),
            "type": clean(match.group(3)),
            "year": clean(match.group(4)),
        })
    result["parsed"] = releases
    return result


def get_release_tracks(ma_id: int, album_id: int) -> dict:
    result = fetch_url(f"https://www.metal-archives.com/release/view/id/{album_id}")
    if result["error"] or result["status"] != 200:
        return result
    body = result["body"]
    linked_band = re.search(r'/bands/[^/]+/(\d+)"[^>]*>[^<]+</a>\s*</h2>', body)
    if linked_band and int(linked_band.group(1)) != ma_id:
        result["error"] = f"Release {album_id} does not belong to band {ma_id}"
        result["parsed"] = []
        return result
    album_match = re.search(r'<h1 class="album_name">.*?<a[^>]*>(.*?)</a>', body, re.DOTALL)
    album = html.unescape(re.sub(r"<[^>]+>", "", album_match.group(1))).strip() if album_match else ""
    tracks = []
    pattern = re.compile(
        r'<tr class="(?:even|odd)">\s*<td[^>]*>.*?</td>\s*'
        r'<td class="wrapWords">\s*(.*?)\s*</td>\s*'
        r'<td align="right">\s*(\d+):(\d{2})\s*</td>',
        re.IGNORECASE | re.DOTALL,
    )
    for match in pattern.finditer(body):
        title = html.unescape(re.sub(r"<[^>]+>", "", match.group(1))).strip()
        if not title:
            continue
        tracks.append({
            "maId": ma_id,
            "albumId": album_id,
            "album": album,
            "title": title,
            "duration": int(match.group(2)) * 60 + int(match.group(3)),
        })
    result["parsed"] = tracks
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
            out = search_artists(sys.argv[2])
        elif command == "detail":
            out = get_artist_detail(int(sys.argv[2]), sys.argv[3])
        elif command == "similar":
            out = get_similar_artists(int(sys.argv[2]))
        elif command == "discography":
            out = get_discography(int(sys.argv[2]))
        elif command == "release-tracks":
            out = get_release_tracks(int(sys.argv[2]), int(sys.argv[3]))
        elif command == "genres":
            out = get_genres_countries()
        elif command == "browse-genres":
            out = browse_genres()
        elif command == "fetch":
            out = fetch_url(sys.argv[2])
        else:
            out = {"error": f"Unknown command: {command}"}
    except (IndexError, ValueError) as e:
        out = {"error": f"Invalid args for '{command}': {e}"}

    print(json.dumps(out))


if __name__ == "__main__":
    main()
