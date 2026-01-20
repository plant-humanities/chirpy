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
from pathlib import Path
from datetime import datetime
from typing import Dict, Optional


# ============================================================================
# Markdown Conversion Functions
# ============================================================================


def to_dict(s):
    # Parse attributes using shlex (respects quotes)
    lexer = shlex.shlex(s, posix=True)
    lexer.whitespace_split = True
    lexer.commenters = ''
    tokens = list(lexer)

    attrs = {}
    for token in tokens:
        if '=' in token:
            key, value = token.split('=', 1)
            attrs[key] = value.strip('"\'')
        else:
            attrs[token] = None
    return attrs

unrecognized_image_attrs = {}

def convert_params(md: str) -> str:
    
    def convert_image_tag(attrs_str):
        attrs = to_dict(attrs_str)
        recognized = set('id src manifest seq caption attribution description label license source cover region rotation aspect'.split(' '))
        for attr in attrs:
            if attr not in recognized:
                if attr not in unrecognized_image_attrs:
                    unrecognized_image_attrs[attr] = 0
                unrecognized_image_attrs[attr] = unrecognized_image_attrs[attr] + 1
             
        tag = '{% include embed/image.html '
        for attr in 'id src manifest seq caption attribution description label license source cover region rotation aspect'.split(' '):
            if attr in attrs:
                tag += f'{attr}="{attrs[attr]}" '
        tag += 'class="right" %}'
        return tag

    md = re.sub(r'`image\s+\b([^`]*)`', lambda m: convert_image_tag(m.group(1).strip()), md)
    
    def convert_map_block(block):
        markers = []
        lines = [line.strip()[1:-1] for line in block.split('\n')]
        tag_attrs = to_dict(lines[0])
        for line in lines[1:]:
            line_attrs = to_dict(line)
            print(json.dumps(line_attrs, indent=2))
            if 'marker' in line_attrs:
                if 'qid' in line_attrs:
                    markers.append(line_attrs['qid'])
        
        tag = '{% include embed/map.html '
        for attr in 'id center zoom basemap caption aspect'.split(' '):
            if attr in tag_attrs:
                tag += f'{attr}="{tag_attrs[attr]}" '
        if markers:
            tag += f'markers="{"|".join(markers)}" '
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
                    
    return md

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
    text = RE_REMOVE.sub('', text)
    text = RE_COLLAPSE_BLANK_LINES.sub('\n\n', text)
    text = RE_ADD_BLANK_AFTER_HEADING.sub(r'\1\n\n', text)
    text = RE_EMPTY_HEADINGS.sub('', text)
    return text


def update_links(text):
    pattern = re.compile(r'\[([^\]]+)\]\(\s*/([^)\s]+)\s*\)')
    replacement = r'[\1]({{ site.baseurl }}/\2)'

    out = pattern.sub(replacement, text)
    return out

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
        
        try:
            md = convert_params(md)
        except Exception as e:
            print(f'Error converting params in {root}: {e}')
            traceback.print_exc()
            continue
                
        # Clean markdown
        #md = clean(md)
        
        #md = update_links(md)
        
        # Write converted file
        ctr += 1
        with open(dest_path, 'w') as fp:
            fp.write(md)
        print(f'{ctr}. {root} -> {dest_path}')
        
        if max and ctr >= max:
            break
    
    # print(json.dumps(unrecognized_image_attrs, indent=2))


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