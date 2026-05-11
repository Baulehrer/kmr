import sys
import json
import re
from scrapling.fetchers import Fetcher

def fetch_url(url: str) -> dict:
    try:
        page = Fetcher.get(url, stealthy_headers=True)
        return {
            "status": page.status,
            "body": page.body if isinstance(page.body, str) else page.body.decode("utf-8", errors="replace"),
            "error": None
        }
    except Exception as e:
        return {
            "status": 0,
            "body": "",
            "error": str(e)
        }

def search_artist(name: str) -> dict:
    encoded = name.replace(" ", "%20")
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
            "name": name_match.group(1) if name_match else name,
            "genre": row[1] if len(row) > 1 else "",
            "country": row[2] if len(row) > 2 else "",
        }
    except Exception as e:
        result["parsed"] = None
        result["parse_error"] = str(e)

    return result

def get_artist_detail(ma_id: int, name: str) -> dict:
    encoded = name.replace(" ", "_")
    url = f"https://www.metal-archives.com/bands/{encoded}/{ma_id}"
    return fetch_url(url)

def get_similar_artists(ma_id: int) -> dict:
    url = f"https://www.metal-archives.com/band/ajax-recommendations/id/{ma_id}"
    result = fetch_url(url)
    if result["error"] or result["status"] != 200:
        return result

    try:
        html = result["body"]
        pattern = (
            r'<tr[^>]*>[\s\S]*?'
            r'<a[^>]*href="[^"]*/bands/[^/]+/(\d+)"[^>]*>([^<]+)</a>'
            r'</td>\s*<td>([^<]*)</td>\s*<td>([^<]*)</td>'
            r'[\s\S]*?id="score_\1">(\d+)'
        )
        similar = []
        for m in re.finditer(pattern, html):
            similar.append({
                "maId": int(m.group(1)),
                "name": m.group(2).strip(),
                "country": m.group(3).strip(),
                "genre": m.group(4).strip(),
                "score": int(m.group(5)),
            })
        result["parsed"] = similar
    except Exception as e:
        result["parsed"] = []
        result["parse_error"] = str(e)

    return result

if __name__ == "__main__":
    command = sys.argv[1]

    if command == "search":
        name = sys.argv[2]
        out = search_artist(name)
    elif command == "detail":
        ma_id = int(sys.argv[2])
        name = sys.argv[3]
        out = get_artist_detail(ma_id, name)
    elif command == "similar":
        ma_id = int(sys.argv[2])
        out = get_similar_artists(ma_id)
    elif command == "fetch":
        url = sys.argv[2]
        out = fetch_url(url)
    else:
        out = {"error": f"Unknown command: {command}"}

    print(json.dumps(out))
