#!/usr/bin/env python3
"""
Generate font subsets for BirdTab extension
Supports: Arabic, German, English, Spanish, French, Japanese, Portuguese, Russian, Chinese
Includes: tnum OpenType feature for tabular numbers
"""

import subprocess
import sys
import os

# Font source and destination
FONT_DIR = "scripts/fonts-temp/extras/ttf"
OUTPUT_DIR = "src/fonts"

# Fonts to process
FONTS = [
    ("Inter-Regular.ttf", "Inter-Regular.woff2"),
    ("Inter-Bold.ttf", "Inter-Bold.woff2")
]

# Unicode ranges for all supported languages
# This includes:
# - Basic Latin, Latin Extended (English, German, Spanish, French, Portuguese)
# - Cyrillic (Russian)
# - Arabic
# - CJK Unified Ideographs (Chinese, Japanese Kanji)
# - Hiragana, Katakana (Japanese)
# - Common punctuation and symbols
UNICODE_RANGES = [
    # Basic Latin + Latin-1 Supplement
    "U+0020-007F",  # Basic Latin
    "U+00A0-00FF",  # Latin-1 Supplement
    # Latin Extended (for European languages)
    "U+0100-017F",  # Latin Extended-A
    "U+0180-024F",  # Latin Extended-B
    # Cyrillic (Russian)
    "U+0400-04FF",  # Cyrillic
    "U+0500-052F",  # Cyrillic Supplement
    # Arabic
    "U+0600-06FF",  # Arabic
    "U+0750-077F",  # Arabic Supplement
    "U+FB50-FDFF",  # Arabic Presentation Forms-A
    "U+FE70-FEFF",  # Arabic Presentation Forms-B
    # CJK (Chinese, Japanese Kanji)
    "U+3000-303F",  # CJK Symbols and Punctuation
    "U+3040-309F",  # Hiragana
    "U+30A0-30FF",  # Katakana
    "U+3400-4DBF",  # CJK Unified Ideographs Extension A
    "U+4E00-9FFF",  # CJK Unified Ideographs (common)
    "U+F900-FAFF",  # CJK Compatibility Ideographs
    "U+FF00-FFEF",  # Halfwidth and Fullwidth Forms
    # Additional ranges for numbers and common symbols
    "U+2000-206F",  # General Punctuation
    "U+2070-209F",  # Superscripts and Subscripts
    "U+20A0-20CF",  # Currency Symbols
    "U+2100-214F",  # Letterlike Symbols
]

def generate_subset(input_font, output_font):
    """Generate font subset with specified Unicode ranges and features"""
    input_path = os.path.join(FONT_DIR, input_font)
    output_path = os.path.join(OUTPUT_DIR, output_font)

    print(f"Processing {input_font}...")

    # Build pyftsubset command
    cmd = [
        "pyftsubset",
        input_path,
        f"--output-file={output_path}",
        f"--unicodes={','.join(UNICODE_RANGES)}",
        # Keep OpenType features including tnum (tabular numbers)
        "--layout-features=*",  # Keep all layout features including tnum
        "--flavor=woff2",  # Output as woff2
        "--desubroutinize",  # Optimize for web
        "--no-hinting",  # Remove hinting for smaller file size
    ]

    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        print(f"✓ Generated {output_font}")

        # Get file size
        size = os.path.getsize(output_path)
        print(f"  Size: {size / 1024:.1f} KB")

        return True
    except subprocess.CalledProcessError as e:
        print(f"✗ Error generating {output_font}")
        print(f"  Error: {e.stderr}")
        return False

def main():
    """Generate all font subsets"""
    print("Generating font subsets for BirdTab...")
    print("=" * 60)

    # Create output directory if it doesn't exist
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    success_count = 0
    for input_font, output_font in FONTS:
        if generate_subset(input_font, output_font):
            success_count += 1
        print()

    print("=" * 60)
    print(f"Completed: {success_count}/{len(FONTS)} fonts generated successfully")

    if success_count == len(FONTS):
        print("\n✓ All fonts generated successfully!")
        print("\nNext steps:")
        print("1. Update CSS to use local @font-face declarations")
        print("2. Remove Google Fonts import")
        print("3. Test the fonts in the extension")
        return 0
    else:
        print("\n✗ Some fonts failed to generate")
        return 1

if __name__ == "__main__":
    sys.exit(main())
