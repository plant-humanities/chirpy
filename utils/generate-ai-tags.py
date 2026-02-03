#!/usr/bin/env python3
"""
tag_md_to_csv.py

Read markdown files (single file or directory) and generate a CSV containing:
- id (filename without .md)
- up to 10 AI-generated tags (tag1..tag10)

Requirements:
  pip install openai pydantic

Environment:
  export OPENAI_API_KEY="..."

Usage:
  python tag_md_to_csv.py /path/to/md_dir --out tags.csv
  python tag_md_to_csv.py /path/to/file.md --out tags.csv
  python tag_md_to_csv.py /path/to/md_dir --max 25 --out tags.csv
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

import re
from pathlib import Path

_DATE_PREFIX_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-")

from openai import OpenAI
from pydantic import BaseModel, conlist


# ----------------------------
# Cleaning: front matter + Liquid
# ----------------------------

_FRONT_MATTER_RE = re.compile(
    r"(?s)\A---\s*\n.*?\n---\s*\n?",  # YAML front matter at file start
)

# Remove Liquid tags/outputs outside of code parsing (simple but effective):
#   {% ... %}  and  {{ ... }}
# DOTALL so it also catches multi-line blocks.
_LIQUID_TAG_RE = re.compile(r"(?s){%.*?%}")
_LIQUID_OUTPUT_RE = re.compile(r"(?s){{.*?}}")

# Optional: if you want to remove HTML comments too, uncomment:
# _HTML_COMMENT_RE = re.compile(r"(?s)<!--.*?-->")


def clean_markdown(text: str) -> str:
    """Remove YAML front matter and Liquid fragments."""
    text = _FRONT_MATTER_RE.sub("", text)
    text = _LIQUID_TAG_RE.sub("", text)
    text = _LIQUID_OUTPUT_RE.sub("", text)
    # text = _HTML_COMMENT_RE.sub("", text)

    # Normalize excess whitespace a bit (helps tagging quality)
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip()


# ----------------------------
# OpenAI structured output model
# ----------------------------

class TagResult(BaseModel):
    # up to 10 tags, each a short string
    tags: conlist(str, max_length=10)  # type: ignore[valid-type]


SYSTEM_PROMPT = """
You are assigning controlled-vocabulary tags to essays published on the Plant Humanities Lab website.

Use ONLY the following controlled vocabulary:

- colonialism-and-empire
- global-exchange
- plant-migration
- foodways
- medicine-and-health
- indigenous-knowledge
- labor-and-extraction
- environmental-change
- climate-and-ecology
- agriculture-and-domestication
- trade-and-commodities
- knowledge-production
- scientific-practices
- cultural-symbolism
- art-and-visual-culture
- politics-and-power
- race-and-diaspora
- conservation-and-biodiversity
- material-culture
- religion-and-ritual

Instructions:
- Select 3 to 7 tags that best capture the essay’s central themes
- Tags must come exclusively from the controlled list above
- Choose tags that reflect sustained analytical focus, not passing references
- Do not invent new tags
- Do not include plant names or species-level concepts
- Return the selected tags as a list
"""

USER_PROMPT_TEMPLATE = """Generate tags for this markdown content:

--- BEGIN CONTENT ---
{content}
--- END CONTENT ---
"""


# ----------------------------
# Retry / backoff
# ----------------------------

@dataclass
class RetryConfig:
    max_retries: int = 6
    initial_sleep_s: float = 1.0
    max_sleep_s: float = 20.0
    backoff_factor: float = 1.8


def with_retries(fn, retry: RetryConfig):
    sleep_s = retry.initial_sleep_s
    last_err = None
    for attempt in range(1, retry.max_retries + 1):
        try:
            return fn()
        except Exception as e:
            last_err = e
            if attempt == retry.max_retries:
                break
            time.sleep(min(sleep_s, retry.max_sleep_s))
            sleep_s *= retry.backoff_factor
    raise last_err  # type: ignore[misc]


# ----------------------------
# File enumeration
# ----------------------------

def iter_markdown_files(path: Path) -> List[Path]:
    if path.is_file():
        if path.suffix.lower() != ".md":
            raise ValueError(f"Input file is not a .md file: {path}")
        return [path]

    if path.is_dir():
        files = sorted(path.glob("*.md"))
        return files

    raise FileNotFoundError(f"Path not found: {path}")


def file_id(md_path: Path) -> str:
    """
    Return filename-based ID with leading yyyy-mm-dd- removed if present.
    """
    name = md_path.stem
    return _DATE_PREFIX_RE.sub("", name)

# ----------------------------
# Tagging
# ----------------------------

def generate_tags(client: OpenAI, model: str, content: str) -> List[str]:
    # Keep prompts reasonable for long docs:
    # If your docs can be huge, consider truncating or chunking.
    # Here we truncate to a conservative size to avoid overlong inputs.
    MAX_CHARS = 60_000
    if len(content) > MAX_CHARS:
        content = content[:MAX_CHARS]

    def _call():
        resp = client.responses.parse(
            model=model,
            input=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": USER_PROMPT_TEMPLATE.format(content=content)},
            ],
            text_format=TagResult,
        )
        # resp.output_parsed is the Pydantic model instance when parse succeeds.
        parsed: Optional[TagResult] = getattr(resp, "output_parsed", None)
        if parsed is None:
            # Some refusals or edge cases may not parse; be explicit.
            refusal = getattr(resp, "refusal", None)
            if refusal:
                raise RuntimeError(f"Model refused to tag content: {refusal}")
            raise RuntimeError("Failed to parse structured tags output.")
        tags = [t.strip() for t in parsed.tags if t and t.strip()]
        # De-dupe while preserving order
        seen = set()
        uniq = []
        for t in tags:
            if t not in seen:
                uniq.append(t)
                seen.add(t)
        return uniq[:10]

    return with_retries(_call, RetryConfig())


# ----------------------------
# CSV output
# ----------------------------

def write_csv(rows: List[Tuple[str, List[str]]], out_path: Path) -> None:
    header = ["id"] + [f"tag{i}" for i in range(1, 11)]
    with out_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        for doc_id, tags in rows:
            padded = tags[:10] + [""] * (10 - len(tags))
            w.writerow([doc_id] + padded)


# ----------------------------
# Main
# ----------------------------

def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Generate AI tags for markdown files and write CSV.")
    p.add_argument("path", help="Path to a markdown file or a directory containing *.md files.")
    p.add_argument("--out", default="tags.csv", help="Output CSV path (default: tags.csv).")
    p.add_argument("--max", type=int, default=0, help="Max number of files to process (0 = no limit).")
    p.add_argument("--model", default="gpt-5.2", help="OpenAI model (default: gpt-5.2).")
    args = p.parse_args(argv)

    in_path = Path(args.path).expanduser().resolve()
    out_path = Path(args.out).expanduser().resolve()

    if not os.getenv("OPENAI_API_KEY"):
        print("ERROR: OPENAI_API_KEY environment variable is not set.", file=sys.stderr)
        return 2

    md_files = iter_markdown_files(in_path)
    if args.max and args.max > 0:
        md_files = md_files[: args.max]

    client = OpenAI()

    rows: List[Tuple[str, List[str]]] = []
    for i, md in enumerate(md_files, start=1):
        try:
            raw = md.read_text(encoding="utf-8", errors="replace")
            cleaned = clean_markdown(raw)
            if not cleaned:
                tags = []
            else:
                tags = generate_tags(client, args.model, cleaned)

            rows.append((file_id(md), tags))
            print(f"[{i}/{len(md_files)}] {md.name} -> {len(tags)} tags")
        except Exception as e:
            # Write empty tags on error but keep going
            print(f"[{i}/{len(md_files)}] ERROR {md.name}: {e}", file=sys.stderr)
            rows.append((file_id(md), []))

    write_csv(rows, out_path)
    print(f"\nWrote: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())