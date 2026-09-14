# #!/usr/bin/env python3
# """
# OMNIA - Complete the Look -> Shopify "Complementary products"

# Reads a Shopify product export CSV and writes a Matrixify-ready CSV that fills
#   shopify--discovery--product_recommendation.complementary_products

# That metafield is what the Search & Discovery app writes, and it is what the
# Upcart cart drawer reads when its Recommendation Algorithm is set to
# "Complementary". Same family/metal/colour logic as the product-page section.

# USAGE
#   1. Shopify admin -> Products -> Export -> All products, "Plain CSV" -> email/download.
#   2. python3 complementary_products.py products_export.csv
#   3. Import complementary_products_import.csv with Matrixify (Products sheet).
#      Review complementary_products_report.csv first - it shows what matched.

# FLAGS
#   --limit 4        how many complementary products per product (default 4)
#   --no-family-only also map products that found no family partner (default: on)
# """

# import csv, sys, re, argparse
# from collections import defaultdict

# META_COL = ("Metafield: shopify--discovery--product_recommendation."
#             "complementary_products [list.product_reference]")

# TYPE_RULES = [                                     # order matters: sets first
#     ("set",      ["set", "sets", "طقم"]),
#     ("earrings", ["earring", "earrings", "earcuff", "hoop", "hoops", "حلقان", "حلق"]),
#     ("necklace", ["necklace", "necklaces", "pendant", "pendants", "choker",
#                   "chokers", "collar", "قلادة", "قلاده", "دلاية"]),
#     ("bangle",   ["bangle", "bangles", "cuff", "cuffs", "اسورة", "اسوارة"]),
#     ("bracelet", ["bracelet", "bracelets", "سوار"]),
#     ("ring",     ["ring", "rings", "خاتم"]),
#     ("brooch",   ["brooch", "brooches", "دبوس"]),
# ]

# TONE_PHRASES = [                                   # checked against the raw title
#     ("rose",  ["rose gold", "ذهب وردي"]),
#     ("white", ["white gold"]),
#     ("gold",  ["gold plated", "gold plating", "vermeil"]),
#     ("white", ["silver", "925", "sterling", "rhodium", "platinum",
#                "فضة", "فضه", "فضي", "روديوم", "بلاتين"]),
#     ("gold",  ["gold", "golden", "ذهب", "ذهبي"]),
# ]

# COLOR_RULES = [
#     ("red",    ["red", "ruby", "rubies", "maroon", "burgundy", "garnet", "crimson", "احمر"]),
#     ("pink",   ["pink", "fuchsia", "blush", "وردي"]),
#     ("blue",   ["blue", "navy", "sapphire", "turquoise", "aqua", "teal", "ازرق", "فيروز"]),
#     ("green",  ["green", "emerald", "mint", "olive", "jade", "اخضر", "زمرد"]),
#     ("purple", ["purple", "violet", "amethyst", "lilac", "lavender", "بنفسج"]),
#     ("black",  ["black", "onyx", "اسود"]),
#     ("yellow", ["yellow", "citrine", "اصفر"]),
#     ("pearl",  ["pearl", "pearls", "لؤلؤ", "لولو"]),
#     ("white",  ["white", "opal", "ابيض"]),
#     ("clear",  ["diamond", "diamonds", "zircon", "zirconia", "cz", "crystal",
#                 "crystals", "moissanite", "clear", "ماس"]),
#     ("multi",  ["multi", "multicolor", "multicolour", "colorful", "colourful",
#                 "rainbow", "ملون"]),
# ]
# NEUTRAL = {"clear", "white", "pearl"}

# STOP = set("""set sets setting settings full bridal luxury premium elegant delicate dainty
# minimal statement fashion trendy exclusive gift earring earrings ear necklace necklaces
# pendant pendants choker chokers collar bracelet bracelets bangle bangles cuff cuffs ring
# rings brooch brooches hoop hoops stud studs drop drops dangle clip clips tennis long chain
# chains charm charms silver sterling gold golden plated plating vermeil rose white yellow
# rhodium platinum omnia jewelry jewellery collection piece pieces design classic new women
# womens woman ladies men mens for the and with in of a an by on طقم حلقان حلق خاتم قلادة
# قلاده دلاية سوار اسورة إسورة اسوارة دبوس فضة فضه فضي ذهب ذهبي وردي روديوم بلاتين من مع""".split())

# MOTIFS = set("""red blue green pink black purple maroon burgundy crimson fuchsia blush orange
# navy aqua teal mint olive jade violet lilac lavender citrine clear rainbow multicolor
# multicolour multi colorful colourful ruby rubies emerald emeralds sapphire sapphires pearl
# pearls diamond diamonds moissanite zircon zirconia crystal crystals opal onyx turquoise
# amethyst topaz garnet flower flowers floral leaf leaves butterfly heart hearts star stars
# moon bird tiger dragon snake bow infinity knot cross halo solitaire""".split())

# TYPE_BONUS = {"earrings": 300, "necklace": 280, "bracelet": 240,
#               "ring": 200, "bangle": 160, "brooch": 60}


# def norm_ar(w):
#     w = re.sub(r"[\u064B-\u0652\u0670\u0640]", "", w)
#     w = re.sub(r"[\u0622\u0623\u0625]", "\u0627", w)
#     w = w.replace("\u0649", "\u064A").replace("\u0629", "\u0647")
#     if w.startswith("\u0627\u0644") and len(w) > 4:
#         w = w[2:]
#     return w


# def parse(title):
#     t = (title or "").lower().replace("92.5", "925")
#     t = re.sub(r"[^\w\u0600-\u06FF]+", " ", t, flags=re.UNICODE)
#     t = " " + " ".join(t.split()) + " "

#     ptype = ""
#     for name, words in TYPE_RULES:
#         if any(f" {w} " in t for w in words):
#             ptype = name
#             break

#     tone = ""
#     for name, phrases in TONE_PHRASES:
#         if any(p in t for p in phrases):
#             tone = name
#             break

#     tc = t.replace("white gold", " ").replace("yellow gold", " ").replace("ذهب وردي", " ")
#     colors = {n for n, words in COLOR_RULES if any(f" {w} " in tc or w in tc for w in words)}

#     family, core, motifs = "", [], set()
#     for w in t.split():
#         if not re.match(r"^[a-z0-9]+$", w):
#             w = norm_ar(w)
#         if len(w) < 2 or w[0].isdigit() or w in STOP:
#             continue
#         core.append(w)
#         if w in MOTIFS:
#             motifs.add(w)
#         elif not family:
#             family = w

#     return {"type": ptype, "tone": tone, "family": family,
#             "core": " ".join(core), "motifs": motifs, "colors": colors}


# def score(cur, cand):
#     if not cand["type"] or cand["type"] == "set":
#         return None
#     if cur["type"] and cur["type"] != "set" and cand["type"] == cur["type"]:
#         return None

#     s, fam = 0, False
#     if cur["family"] and cand["family"] == cur["family"]:
#         s += 8000; fam = True
#     if cur["core"] and cand["core"] == cur["core"]:
#         s += 4000; fam = True

#     if cur["tone"] and cand["tone"]:
#         if cur["tone"] == cand["tone"]:
#             s += 2000
#         elif not fam:
#             return None

#     hits = cur["colors"] & cand["colors"]
#     if hits:
#         s += 1000 + 200 * (len(hits) - 1)
#     elif cur["colors"] - NEUTRAL and cand["colors"] - NEUTRAL:
#         s -= 700

#     s += 60 * len(cur["motifs"] & cand["motifs"])
#     s += TYPE_BONUS.get(cand["type"], 60)
#     return s, fam


# def main():
#     ap = argparse.ArgumentParser()
#     ap.add_argument("csv_file")
#     ap.add_argument("--limit", type=int, default=4)
#     ap.add_argument("--no-family-only", action="store_true",
#                     help="also map products that found no family partner")
#     a = ap.parse_args()

#     rows = {}
#     with open(a.csv_file, newline="", encoding="utf-8-sig") as f:
#         for r in csv.DictReader(f):
#             h, t = (r.get("Handle") or "").strip(), (r.get("Title") or "").strip()
#             if not h or not t or h in rows:
#                 continue            # Shopify repeats the handle on every variant row
#             if (r.get("Status") or "active").lower() not in ("", "active"):
#                 continue
#             rows[h] = {"handle": h, "title": t, **parse(t)}

#     prods = list(rows.values())
#     print(f"{len(prods)} active products")
#     no_type = [p for p in prods if not p["type"]]
#     no_tone = [p for p in prods if not p["tone"]]

#     fams = defaultdict(list)
#     for p in prods:
#         if p["family"]:
#             fams[p["family"]].append(p)

#     out, report = [], []
#     for cur in prods:
#         cands = []
#         for c in prods:
#             if c["handle"] == cur["handle"]:
#                 continue
#             r = score(cur, c)
#             if r:
#                 cands.append((r[0], r[1], c))
#         cands.sort(key=lambda x: (-x[0], x[2]["handle"]))

#         picks, seen_types = [], set()
#         for s, fam, c in cands:                      # one of each type first
#             if len(picks) >= a.limit:
#                 break
#             if c["type"] not in seen_types:
#                 seen_types.add(c["type"]); picks.append((s, fam, c))
#         for s, fam, c in cands:                      # then fill by score
#             if len(picks) >= a.limit:
#                 break
#             if all(c["handle"] != p[2]["handle"] for p in picks):
#                 picks.append((s, fam, c))

#         has_fam = any(p[1] for p in picks)
#         if picks and (has_fam or a.no_family_only):
#             out.append({"Handle": cur["handle"],
#                         META_COL: ",".join(p[2]["handle"] for p in picks)})
#         report.append({
#             "Handle": cur["handle"], "Title": cur["title"],
#             "Family": cur["family"] or "-", "Type": cur["type"] or "!! NONE",
#             "Metal": cur["tone"] or "!! NONE",
#             "Colors": " ".join(sorted(cur["colors"])) or "-",
#             "Family partner?": "yes" if has_fam else "no",
#             "Picks": " | ".join(f"{p[2]['title']} ({p[0]}{'*' if p[1] else ''})" for p in picks),
#         })

#     with open("complementary_products_import.csv", "w", newline="", encoding="utf-8-sig") as f:
#         w = csv.DictWriter(f, fieldnames=["Handle", META_COL]); w.writeheader(); w.writerows(out)
#     with open("complementary_products_report.csv", "w", newline="", encoding="utf-8-sig") as f:
#         w = csv.DictWriter(f, fieldnames=list(report[0].keys())); w.writeheader(); w.writerows(report)

#     fam_ok = sum(1 for r in report if r["Family partner?"] == "yes")
#     print(f"  families found      : {len(fams)}  "
#           f"({sum(1 for v in fams.values() if len(v) > 1)} have 2+ pieces)")
#     print(f"  got a family partner: {fam_ok}  ({fam_ok*100//max(len(prods),1)}%)")
#     print(f"  no type in title    : {len(no_type)}  <- these get NO recommendations anywhere")
#     print(f"  no metal in title   : {len(no_tone)}  <- weak matching, fix the titles")
#     print(f"\nwrote complementary_products_import.csv  ({len(out)} products)")
#     print("wrote complementary_products_report.csv  <- READ THIS FIRST")
#     if no_type[:5]:
#         print("\nexamples with no detectable type:")
#         for p in no_type[:5]:
#             print("  -", p["title"])


# if __name__ == "__main__":
#     main()





#!/usr/bin/env python3
"""
OMNIA - Complete the Look -> Shopify "Complementary products"

Reads a Shopify product export CSV and writes a Matrixify-ready CSV that fills
  shopify--discovery--product_recommendation.complementary_products

Set products (Luxury Set / Full Set) are filled with standalone rings in the
same colour, same family first - the Shopify port of the Woo 3.1.0 rule.

That metafield is what the Search & Discovery app writes, and it is what the
Upcart cart drawer reads when its Recommendation Algorithm is set to
"Complementary". Same family/metal/colour logic as the product-page section.

USAGE
  1. Shopify admin -> Products -> Export -> All products, "Plain CSV" -> email/download.
  2. python3 complementary_products.py products_export.csv
  3. Import complementary_products_import.csv with Matrixify (Products sheet).
     Review complementary_products_report.csv first - it shows what matched.

FLAGS
  --limit 4        how many complementary products per product (default 4)
  --no-family-only also map products that found no family partner (default: on)
"""

import csv, sys, re, argparse
from collections import defaultdict

META_COL = ("Metafield: shopify--discovery--product_recommendation."
            "complementary_products [list.product_reference]")

TYPE_RULES = [                                     # order matters: sets first
    ("set",      ["set", "sets", "طقم"]),
    ("earrings", ["earring", "earrings", "earcuff", "hoop", "hoops", "حلقان", "حلق"]),
    ("necklace", ["necklace", "necklaces", "pendant", "pendants", "choker",
                  "chokers", "collar", "قلادة", "قلاده", "دلاية"]),
    ("bangle",   ["bangle", "bangles", "cuff", "cuffs", "اسورة", "اسوارة"]),
    ("bracelet", ["bracelet", "bracelets", "سوار"]),
    ("ring",     ["ring", "rings", "خاتم"]),
    ("brooch",   ["brooch", "brooches", "دبوس"]),
]

TONE_PHRASES = [                                   # checked against the raw title
    ("rose",  ["rose gold", "ذهب وردي"]),
    ("white", ["white gold"]),
    ("gold",  ["gold plated", "gold plating", "vermeil"]),
    ("white", ["silver", "925", "sterling", "rhodium", "platinum",
               "فضة", "فضه", "فضي", "روديوم", "بلاتين"]),
    ("gold",  ["gold", "golden", "ذهب", "ذهبي"]),
]

COLOR_RULES = [
    ("red",    ["red", "ruby", "rubies", "maroon", "burgundy", "garnet", "crimson", "احمر"]),
    ("pink",   ["pink", "fuchsia", "blush", "وردي"]),
    ("blue",   ["blue", "navy", "sapphire", "turquoise", "aqua", "teal", "ازرق", "فيروز"]),
    ("green",  ["green", "emerald", "mint", "olive", "jade", "اخضر", "زمرد"]),
    ("purple", ["purple", "violet", "amethyst", "lilac", "lavender", "بنفسج"]),
    ("black",  ["black", "onyx", "اسود"]),
    ("yellow", ["yellow", "citrine", "اصفر"]),
    ("pearl",  ["pearl", "pearls", "لؤلؤ", "لولو"]),
    ("white",  ["white", "opal", "ابيض"]),
    ("clear",  ["diamond", "diamonds", "zircon", "zirconia", "cz", "crystal",
                "crystals", "moissanite", "clear", "ماس"]),
    ("multi",  ["multi", "multicolor", "multicolour", "colorful", "colourful",
                "rainbow", "ملون"]),
]
NEUTRAL = {"clear", "white", "pearl"}

STOP = set("""set sets setting settings full bridal luxury premium elegant delicate dainty
minimal statement fashion trendy exclusive gift earring earrings ear necklace necklaces
pendant pendants choker chokers collar bracelet bracelets bangle bangles cuff cuffs ring
rings brooch brooches hoop hoops stud studs drop drops dangle clip clips tennis long chain
chains charm charms silver sterling gold golden plated plating vermeil rose white yellow
rhodium platinum omnia jewelry jewellery collection piece pieces design classic new women
womens woman ladies men mens for the and with in of a an by on طقم حلقان حلق خاتم قلادة
قلاده دلاية سوار اسورة إسورة اسوارة دبوس فضة فضه فضي ذهب ذهبي وردي روديوم بلاتين من مع""".split())

MOTIFS = set("""red blue green pink black purple maroon burgundy crimson fuchsia blush orange
navy aqua teal mint olive jade violet lilac lavender citrine clear rainbow multicolor
multicolour multi colorful colourful ruby rubies emerald emeralds sapphire sapphires pearl
pearls diamond diamonds moissanite zircon zirconia crystal crystals opal onyx turquoise
amethyst topaz garnet flower flowers floral leaf leaves butterfly heart hearts star stars
moon bird tiger dragon snake bow infinity knot cross halo solitaire""".split())

TYPE_BONUS = {"earrings": 300, "necklace": 280, "bracelet": 240,
              "ring": 200, "bangle": 160, "brooch": 60}


def norm_ar(w):
    w = re.sub(r"[\u064B-\u0652\u0670\u0640]", "", w)
    w = re.sub(r"[\u0622\u0623\u0625]", "\u0627", w)
    w = w.replace("\u0649", "\u064A").replace("\u0629", "\u0647")
    if w.startswith("\u0627\u0644") and len(w) > 4:
        w = w[2:]
    return w


def parse(title):
    t = (title or "").lower().replace("92.5", "925")
    t = re.sub(r"[^\w\u0600-\u06FF]+", " ", t, flags=re.UNICODE)
    t = " " + " ".join(t.split()) + " "

    ptype = ""
    for name, words in TYPE_RULES:
        if any(f" {w} " in t for w in words):
            ptype = name
            break

    tone = ""
    for name, phrases in TONE_PHRASES:
        if any(p in t for p in phrases):
            tone = name
            break

    tc = t.replace("white gold", " ").replace("yellow gold", " ").replace("ذهب وردي", " ")
    colors = {n for n, words in COLOR_RULES if any(f" {w} " in tc or w in tc for w in words)}

    family, core, motifs = "", [], set()
    for w in t.split():
        if not re.match(r"^[a-z0-9]+$", w):
            w = norm_ar(w)
        if len(w) < 2 or w[0].isdigit() or w in STOP:
            continue
        core.append(w)
        if w in MOTIFS:
            motifs.add(w)
        elif not family:
            family = w

    return {"type": ptype, "tone": tone, "family": family,
            "core": " ".join(core), "motifs": motifs, "colors": colors}


def score(cur, cand, set_rings=True):
    if not cand["type"] or cand["type"] == "set":
        return None
    if cur["type"] and cur["type"] != "set" and cand["type"] == cur["type"]:
        return None

    s, fam = 0, False
    if cur["family"] and cand["family"] == cur["family"]:
        s += 8000; fam = True
    if cur["core"] and cand["core"] == cur["core"]:
        s += 4000; fam = True

    if cur["tone"] and cand["tone"]:
        if cur["tone"] == cand["tone"]:
            s += 2000
        elif not fam:
            return None

    hits = cur["colors"] & cand["colors"]
    if hits:
        s += 1000 + 200 * (len(hits) - 1)
    elif cur["colors"] - NEUTRAL and cand["colors"] - NEUTRAL:
        s -= 700

    s += 60 * len(cur["motifs"] & cand["motifs"])
    s += TYPE_BONUS.get(cand["type"], 60)

    # Set page -> standalone rings in the same colour first
    if set_rings and cur["type"] == "set" and cand["type"] == "ring":
        s += 6000 if (hits or not cur["colors"]) else 1500
    return s, fam


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_file")
    ap.add_argument("--limit", type=int, default=4)
    ap.add_argument("--no-family-only", action="store_true",
                    help="also map products that found no family partner")
    ap.add_argument("--no-set-rings", action="store_true",
                    help="do not special-case Set products into matching rings")
    a = ap.parse_args()

    rows = {}
    with open(a.csv_file, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            h, t = (r.get("Handle") or "").strip(), (r.get("Title") or "").strip()
            if not h or not t or h in rows:
                continue            # Shopify repeats the handle on every variant row
            if (r.get("Status") or "active").lower() not in ("", "active"):
                continue
            rows[h] = {"handle": h, "title": t, **parse(t)}

    prods = list(rows.values())
    print(f"{len(prods)} active products")
    no_type = [p for p in prods if not p["type"]]
    no_tone = [p for p in prods if not p["tone"]]

    fams = defaultdict(list)
    for p in prods:
        if p["family"]:
            fams[p["family"]].append(p)

    out, report = [], []
    for cur in prods:
        cands = []
        for c in prods:
            if c["handle"] == cur["handle"]:
                continue
            r = score(cur, c, set_rings=not a.no_set_rings)
            if r:
                cands.append((r[0], r[1], c))
        cands.sort(key=lambda x: (-x[0], x[2]["handle"]))

        picks, seen_types = [], set()
        set_page = cur["type"] == "set" and not a.no_set_rings
        for s, fam, c in cands:                      # one of each type first
            if set_page or len(picks) >= a.limit:    # ...but a Set wants several rings
                break
            if c["type"] not in seen_types:
                seen_types.add(c["type"]); picks.append((s, fam, c))
        for s, fam, c in cands:                      # then fill by score
            if len(picks) >= a.limit:
                break
            if all(c["handle"] != p[2]["handle"] for p in picks):
                picks.append((s, fam, c))

        has_fam = any(p[1] for p in picks)
        if picks and (has_fam or a.no_family_only):
            out.append({"Handle": cur["handle"],
                        META_COL: ",".join(p[2]["handle"] for p in picks)})
        report.append({
            "Handle": cur["handle"], "Title": cur["title"],
            "Family": cur["family"] or "-", "Type": cur["type"] or "!! NONE",
            "Metal": cur["tone"] or "!! NONE",
            "Colors": " ".join(sorted(cur["colors"])) or "-",
            "Family partner?": "yes" if has_fam else "no",
            "Picks": " | ".join(f"{p[2]['title']} ({p[0]}{'*' if p[1] else ''})" for p in picks),
        })

    with open("complementary_products_import.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["Handle", META_COL]); w.writeheader(); w.writerows(out)
    with open("complementary_products_report.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(report[0].keys())); w.writeheader(); w.writerows(report)

    fam_ok = sum(1 for r in report if r["Family partner?"] == "yes")
    print(f"  families found      : {len(fams)}  "
          f"({sum(1 for v in fams.values() if len(v) > 1)} have 2+ pieces)")
    print(f"  got a family partner: {fam_ok}  ({fam_ok*100//max(len(prods),1)}%)")
    print(f"  no type in title    : {len(no_type)}  <- these get NO recommendations anywhere")
    print(f"  no metal in title   : {len(no_tone)}  <- weak matching, fix the titles")
    print(f"\nwrote complementary_products_import.csv  ({len(out)} products)")
    print("wrote complementary_products_report.csv  <- READ THIS FIRST")
    if no_type[:5]:
        print("\nexamples with no detectable type:")
        for p in no_type[:5]:
            print("  -", p["title"])


if __name__ == "__main__":
    main()