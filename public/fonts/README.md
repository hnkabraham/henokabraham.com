# Google Sans

Copyright 2025 The Google Sans Project Authors (github.com/googlefonts/googlesans). Distributed under the included SIL Open Font License 1.1.

These WOFF2 fonts were generated from a Google Sans download of my own. They retain the weight (400–700), optical-size and grade axes, with Latin, extended Latin, combining marks, punctuation and symbols. Other scripts fall back to system fonts.

Run `python scripts/prepare-site-fonts.py /path/to/Google_Sans` from the repository with `fonttools[woff]` installed to reproduce the files. Update the content-hashed filenames in the stylesheet and layout preload after regenerating. Only the normal face is preloaded; italics load on demand.

# Watch-face fonts

The live Bezel Auth faces in the On your time section draw with two subsets made by `scripts/prepare-watch-fonts.py`: `watch-labels-*.woff2` is Roboto Condensed Bold, the label font the faces use on the watch (`Roboto-Condensed-OFL.txt`), and `watch-numerals-*.woff2` is Barlow Bold, an open stand-in for the watch's own numeral font, which is Garmin's and stays on the watch (`Barlow-OFL.txt`). Both are distributed under the SIL Open Font License 1.1 and load only when the section nears the screen.
