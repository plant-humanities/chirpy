#!/usr/bin/env python3
"""
summarize_tags.py

Input:  a CSV like:
  id,tag1,tag2,...,tag10
Output: a CSV like:
  tag,count,id1,id2,id3,...

Usage:
  python summarize_tags.py tags.csv --out tag_summary.csv
  python summarize_tags.py tags.csv --out tag_summary.csv --min-count 2
  python summarize_tags.py tags.csv --out tag_summary.csv --sort count_desc
"""

from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Set, Tuple


def read_tags_csv(path: Path) -> List[Tuple[str, Set[str]]]:
    """
    Returns list of (essay_id, set_of_tags).
    Expects columns: id, tag1..tag10 (or any columns starting with 'tag')
    """
    rows: List[Tuple[str, Set[str]]] = []
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise ValueError("Input CSV has no header row.")

        if "id" not in reader.fieldnames:
            raise ValueError("Input CSV must contain an 'id' column.")

        tag_cols = [c for c in reader.fieldnames if c != "id" and c.lower().startswith("tag")]
        if not tag_cols:
            raise ValueError("Input CSV must contain tag columns named like tag1, tag2, ...")

        for r in reader:
            essay_id = (r.get("id") or "").strip()
            if not essay_id:
                continue

            tags = set()
            for c in tag_cols:
                v = (r.get(c) or "").strip()
                if v:
                    tags.add(v)
            rows.append((essay_id, tags))
    return rows


def summarize(rows: List[Tuple[str, Set[str]]]) -> Dict[str, List[str]]:
    """
    Build mapping tag -> sorted list of essay_ids that include that tag.
    """
    tag_to_ids: Dict[str, Set[str]] = defaultdict(set)
    for essay_id, tags in rows:
        for t in tags:
            tag_to_ids[t].add(essay_id)

    # Convert sets to sorted lists for stable output
    return {t: sorted(list(ids)) for t, ids in tag_to_ids.items()}


def write_summary_csv(tag_map: Dict[str, List[str]], out_path: Path, min_count: int, sort_mode: str) -> None:
    """
    Writes:
      tag,count,id1,id2,... (variable length per row)
    """
    items = list(tag_map.items())

    if sort_mode == "count_desc":
        items.sort(key=lambda kv: (-len(kv[1]), kv[0]))
    elif sort_mode == "tag_asc":
        items.sort(key=lambda kv: kv[0])
    else:
        raise ValueError("sort_mode must be one of: count_desc, tag_asc")

    # Filter
    items = [(t, ids) for t, ids in items if len(ids) >= min_count]

    # Figure out max number of ids across rows so we can make a consistent header
    max_ids = max((len(ids) for _, ids in items), default=0)

    header = ["tag", "count"] + [f"id{i}" for i in range(1, max_ids + 1)]

    with out_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        for tag, ids in items:
            row = [tag, str(len(ids))] + ids + [""] * (max_ids - len(ids))
            w.writerow(row)


def main() -> int:
    ap = argparse.ArgumentParser(description="Summarize tags CSV into tag -> count + essay ids.")
    ap.add_argument("in_csv", help="Input tags.csv (id, tag1..tagN).")
    ap.add_argument("--out", default="tag_summary.csv", help="Output summary CSV path.")
    ap.add_argument("--min-count", type=int, default=1, help="Only include tags used in at least this many essays.")
    ap.add_argument("--sort", default="count_desc", choices=["count_desc", "tag_asc"],
                    help="Sort rows by descending count (default) or by tag name.")
    args = ap.parse_args()

    in_path = Path(args.in_csv).expanduser().resolve()
    out_path = Path(args.out).expanduser().resolve()

    rows = read_tags_csv(in_path)
    tag_map = summarize(rows)
    write_summary_csv(tag_map, out_path, min_count=args.min_count, sort_mode=args.sort)

    print(f"Wrote: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())