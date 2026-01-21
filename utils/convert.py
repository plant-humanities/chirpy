#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Juncture Essay Converter
========================
Converts essays (markdown with custom <param> tags) to Jekyll/Chirpy format.

Main conversions:
- Image/map/video viewers → Jekyll includes
"""

import os
import argparse
import pathlib
import json
import re
import shlex
import traceback
import yaml
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, Optional, Tuple, Union


# ============================================================================
# Markdown Conversion Functions
# ============================================================================

class NoDatesSafeLoader(yaml.SafeLoader):
    pass


# Remove implicit resolver for timestamps (dates)
for ch in list(NoDatesSafeLoader.yaml_implicit_resolvers):
    resolvers = NoDatesSafeLoader.yaml_implicit_resolvers[ch]
    NoDatesSafeLoader.yaml_implicit_resolvers[ch] = [
        r for r in resolvers if r[0] != 'tag:yaml.org,2002:timestamp'
    ]


_FRONT_MATTER_RE = re.compile(
    r"""
    \A
    (?:\ufeff)?          # optional UTF-8 BOM
    ---[ \t]*\n
    (?P<yaml>.*?)
    \n---[ \t]*(?:\n|\Z)
    """,
    re.DOTALL | re.VERBOSE,
)


def extract_front_matter(md_text: str) -> Dict[str, Any]:
    m = _FRONT_MATTER_RE.search(md_text)
    if not m:
        return {}

    raw_yaml = m.group("yaml")

    try:
        data = yaml.load(raw_yaml, Loader=NoDatesSafeLoader)
    except yaml.YAMLError as e:
        raise ValueError(f"Invalid YAML front matter: {e}") from e

    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ValueError("Front matter must be a mapping")

    return data


def extract_front_matter_from_file(path: Union[str, Path], encoding: str = "utf-8") -> Dict[str, Any]:
    return extract_front_matter(Path(path).read_text(encoding=encoding))


def split_front_matter(md_text: str) -> Tuple[Dict[str, Any], str]:
    """
    Return (front_matter_dict, body_text).
    If no front matter, returns ({}, original_text).
    """
    m = _FRONT_MATTER_RE.search(md_text)
    if not m:
        return {}, md_text
    fm = extract_front_matter(md_text)
    body = md_text[m.end():]
    return fm, body


def front_matter_to_str(fm: Dict[str, Any], encoding: str = "utf-8"):
    return yaml.safe_dump(
        fm,
        sort_keys=False,          # preserve key order (Python 3.7+)
        default_flow_style=False,
        allow_unicode=True,
    )
    
def to_dict(s: str, *, warn: bool = True) -> Dict[str, Any]:
    """
    Parse a key=value attribute string into a dict.

    - Respects quotes when valid
    - Tolerates missing closing quotes
    - Emits a warning with the offending text on syntax errors
    """
    attrs: Dict[str, Any] = {}

    lexer = shlex.shlex(s, posix=True)
    lexer.whitespace_split = True
    lexer.commenters = ''

    try:
        tokens = list(lexer)
    except ValueError as e:
        # Unterminated quotes or similar
        if warn:
            print("WARNING: attribute parse error")
            print(f"  error: {e}")
            print(f"  text : {s}")

        # Fallback: split on whitespace only
        tokens = s.split()

    for token in tokens:
        if '=' in token:
            key, value = token.split('=', 1)
            attrs[key] = value.strip('"\'')
        else:
            attrs[token] = None

    return attrs

unrecognized_image_attrs = {}
unrecognized_map_attrs = {}

def convert_params(md: str) -> str:
    
    ### Image
    
    def convert_image_tag(attrs_str):
        attrs = to_dict(attrs_str)
        recognized = set('id src manifest seq caption attribution description label license source cover region rotation aspect'.split(' '))
        for attr in attrs:
            if attr not in recognized:
                if attr not in unrecognized_image_attrs:
                    unrecognized_image_attrs[attr] = 0
                unrecognized_image_attrs[attr] = unrecognized_image_attrs[attr] + 1
             
        tag = '{% include embed/image.html '
        for attr in attrs:
            if attr.startswith('#'):
                tag += f'id="{attr[1:]}" '
                
        for attr in 'id src manifest seq caption attribution description label license source cover region rotation aspect'.split(' '):
            if attr in attrs:
                tag += f'{attr}="{attrs[attr]}" '
        tag += 'class="right" %}'
        return tag

    md = re.sub(r'`image\s+\b([^`]*)`', lambda m: convert_image_tag(m.group(1).strip()), md)
    
    
    ### Image Compare
    
    def convert_image_compare_tag(attrs_str):
        attrs = to_dict(attrs_str)
        tag = '{% include embed/image-compare.html '
        for attr in attrs:
            if attr.startswith('#'):
                tag += f'id="{attr[1:]}" '
                
        for attr in 'id before after caption aspect'.split(' '):
            if attr in attrs and attrs[attr]:
                tag += f'{attr}="{attrs[attr]}" '
        tag += 'class="right" %}'
        return tag
    
    md = re.sub(r'`image-compare\b([^`]*)`', lambda m: convert_image_compare_tag(m.group(1).strip()), md)


    ## Map
    
    def convert_map_block(block):
        markers = []
        geojsons = []
        lines = [line.strip()[1:-1] for line in block.split('\n')]
        tag_attrs = to_dict(lines[0])
        
        recognized = set('id center zoom basemap basemaps caption aspect'.split(' '))
        for attr in tag_attrs:
            if attr not in recognized:
                if attr not in unrecognized_map_attrs:
                    unrecognized_map_attrs[attr] = 0
                unrecognized_map_attrs[attr] = unrecognized_map_attrs[attr] + 1

        for line in lines[1:]:
            line_attrs = to_dict(line)
            recognized = set('url layer'.split(' '))
            for attr in line_attrs:
                if attr not in recognized:
                    if attr not in unrecognized_map_attrs:
                        unrecognized_map_attrs[attr] = 0
                    unrecognized_map_attrs[attr] = unrecognized_map_attrs[attr] + 1
            if 'marker' in line_attrs:
                marker = ''
                if 'qid' in line_attrs:
                    marker = line_attrs['qid']
                if 'layer' in line_attrs:
                    marker += f'~{line_attrs["layer"]}'
                markers.append(marker)
            if 'geojson' in line_attrs:
                geojson = ''
                if 'url' in line_attrs:
                    geojson = line_attrs['url']
                if 'layer' in line_attrs:
                    geojson += f'~{line_attrs["layer"]}'
                geojsons.append(geojson)
        
        tag = '{% include embed/map.html '
        for attr in tag_attrs:
            if attr.startswith('#'):
                tag += f'id="{attr[1:]}" '

        for attr in 'id center zoom basemap basemaps caption aspect'.split(' '):
            if attr in tag_attrs:
                tag += f'{attr if not attr == "basemaps" else "basemap"}="{tag_attrs[attr]}" '
        if markers:
            tag += f'markers="{"|".join(markers)}" '
        if geojsons:
            tag += f'geojson="{"|".join(geojsons)}" '
        tag += 'class="right" %}'
        return tag
        
    MAP_BLOCK_RE = re.compile(
        r"""
        ^`map[^\n`]*`             # must start at line beginning
        (?:\n`- [^\n`]*`)*        # continuation lines
        """,
        re.VERBOSE | re.MULTILINE
    )
    
    md = MAP_BLOCK_RE.sub(lambda m: convert_map_block(m.group(0)), md)
    
    ### Iframe
    
    def convert_iframe_tag(attrs_str):
        attrs = to_dict(attrs_str)
        tag = '{% include embed/iframe.html '
        for attr in attrs:
            if attr.startswith('#'):
                tag += f'id="{attr[1:]}" '
                
        for attr in 'id src caption aspect'.split(' '):
            if attr in attrs and attrs[attr]:
                tag += f'{attr}="{attrs[attr]}" '
        tag += 'class="right" %}'
        return tag
    
    md = re.sub(r'`iframe\b([^`]*)`', lambda m: convert_iframe_tag(m.group(1).strip()), md)

    ### YouTube
    
    def convert_youtube_tag(attrs_str):
        attrs = to_dict(attrs_str)
        print(json.dumps(attrs, indent=2))
        tag = '{% include embed/youtube.html '
        for attr in attrs:
            if attr.startswith('#'):
                tag += f'id="{attr[1:]}" '
                
        for attr in 'id vid caption aspect'.split(' '):
            if attr in attrs and attrs[attr]:
                tag += f'{attr if attr != "vid" else "id"}="{attrs[attr]}" '
        tag += 'class="right" %}'
        print(tag)
        return tag
    
    md = re.sub(r'`youtube\b([^`]*)`', lambda m: convert_youtube_tag(m.group(1).strip()), md)

           
    return md


def update_links(text):
    pattern = re.compile(r'\[([^\]]+)\]\(\s*/([^)\s]+)\s*\)')
    replacement = r'[\1]({{ site.baseurl }}/\2)'

    out = pattern.sub(replacement, text)
    return out


HEADER_TAG_RE = re.compile(
    r"""
    `header\b(?P<attrs>[^`]*)`
    """,
    re.VERBOSE,
)

ATTR_RE = re.compile(
    r"""
    (\w+)                          # key
    =
    (?:                            # value
        "([^"]*)"                  #   double-quoted
      | '([^']*)'                  #   single-quoted
      | ([^\s]+)                   #   unquoted
    )
    """,
    re.VERBOSE,
)


def extract_header_tag(md_text: str) -> Tuple[Dict[str, str], str]:
    """
    Extract `header ...` tag attributes and remove the tag from the markdown.

    Returns (attributes_dict, updated_markdown).
    If no header tag is found, returns ({}, original_text).
    """
    m = HEADER_TAG_RE.search(md_text)
    if not m:
        return {}, md_text

    attrs_text = m.group("attrs")

    attrs: Dict[str, str] = {}
    for key, v1, v2, v3 in ATTR_RE.findall(attrs_text):
        attrs[key] = v1 or v2 or v3

    # Remove the tag from the source
    new_text = md_text[:m.start()] + md_text[m.end():]

    return attrs, new_text

RE_COLLAPSE_BLANK_LINES = re.compile(r'\n\s*\n+', re.MULTILINE)
RE_ADD_BLANK_AFTER_HEADING = re.compile(r'^(#{1,6}\s+.+)\n(?!\s*\n)', re.MULTILINE)
RE_EMPTY_HEADINGS = re.compile(r'^\s*#{1,6}\s*$', re.MULTILINE)

def clean(text: str) -> str:
    """
    Clean up converted markdown.
    
    Removes:
    - Button links
    - ve-config params
    - Standalone <br> tags
    - Excessive blank lines
    - Empty headings
    
    Ensures:
    - Blank line after headings
    """
    text = re.sub(r'(?m)^[ \t]*\{\:\s*\.wrap\s*\}[ \t]*\n?', '', text)    
    text = re.sub(r'(?m)^\^[ \t]*#{1,6}[ \t]*\n?', '', text)    
    text = RE_COLLAPSE_BLANK_LINES.sub('\n\n', text)
    text = RE_ADD_BLANK_AFTER_HEADING.sub(r'\1\n\n', text)
    text = RE_EMPTY_HEADINGS.sub('', text)
    return text

# ============================================================================
# Main Conversion Logic
# ============================================================================

def convert(src: str, dest: str, max: Optional[int] = None, **kwargs):
    """
    Convert all essays in a directory tree.
    
    Args:
        src: Source directory containing essays
        dest: Destination directory for converted files
        max: Maximum number of files to convert (for testing)
    """
    ctr = 0
    
    for root, dirs, files in os.walk(src):
        if 'index.md' not in files or dirs:
            continue
            
        src_path = root.split('/')
        
        # Get creation date
        creation_date = datetime.fromtimestamp(
            Path(root).stat().st_birthtime
        ).strftime('%Y-%m-%d')
        
        # Determine  filename
        base_fname = src_path[-1]
        dest_path = f'{dest}/{creation_date}-{base_fname}.md'
        
        # Read and convert markdown
        md = pathlib.Path(f'{root}/index.md').read_text(encoding='utf-8')
        
        fm, body = split_front_matter(md)
        
        header, body = extract_header_tag(body)
                
        fm['media_subpath'] = f'https://raw.githubusercontent.com/plant-humanities/chirpy/main/assets/{base_fname}'
        fm['image'] = {'path': header['img']}

        try:
            body = convert_params(body)
        except Exception as e:
            print(f'Error converting params in {root}: {e}')
            traceback.print_exc()
            continue
        
        body = clean(body)
        #body = update_links(body)
        
        # Write converted file
        ctr += 1
        with open(dest_path, 'w') as fp:
            fp.write('---\n' + front_matter_to_str(fm) + '---\n' + body)
        print(f'{ctr}. {root} -> {dest_path}')
        
        if max and ctr >= max:
            break
    
    print(json.dumps(unrecognized_image_attrs, indent=2))
    print(json.dumps(unrecognized_map_attrs, indent=2))


# ============================================================================
# CLI Entry Point
# ============================================================================

if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='Convert essays to Jekyll/Chirpy format.'
    )
    parser.add_argument(
        '--src',
        default='/Users/ron/projects/plant-humanities/plant-humanities-lab/_articles',
        help='Path to source directory'
    )
    parser.add_argument(
        '--dest',
        default='/Users/ron/projects/plant-humanities/chirpy/_posts',
        help='Path to destination directory'
    )
    parser.add_argument(
        '--max',
        type=int,
        default=None,
        help='Maximum number of files to convert (for testing)'
    )

    args = vars(parser.parse_args())
    convert(**args)