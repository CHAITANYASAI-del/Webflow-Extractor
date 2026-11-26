import re, sys
from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path

orig = open("/Users/chey/Downloads/Chey's Migration/Framer Plugin/framer-extractor/assets/title.svg").read()
paths = re.findall(r'<path d="([^"]+)"', orig)
print("paths", len(paths))
def bbox(d):
    bp = BoundsPen(None); parse_path(d, bp); return bp.bounds
for p in paths: print(bbox(p))

font = TTFont("dmserif.ttf"); gs = font.getGlyphSet(); cmap = font.getBestCmap(); upm = font['head'].unitsPerEm
hmtx = font['hmtx']
# kerning via GPOS is skipped; fine for these words
def text_path(text, size, x0, baseline):
    s = size/upm; x = x0; pen = SVGPathPen(gs)
    for ch in text:
        g = cmap[ord(ch)]
        tp = TransformPen(pen, (s,0,0,-s,x,baseline))
        gs[g].draw(tp); x += hmtx[g][0]*s
    return pen.getCommands(), x
def width(text, size):
    return sum(hmtx[cmap[ord(c)]][0] for c in text)*size/upm
for t in ("Framer","Extractor","Webflow"):
    print(t, width(t,100))

size=51; w=width("Webflow",size); x0=(325-w)/2
d,_=text_path("Webflow", size, x0, 52.0)
d=re.sub(r'(\d+\.\d{3})\d+', r'\1', d)
ext=paths[0]
svg=f'<svg width="325" height="142" viewBox="0 0 325 142" fill="none" xmlns="http://www.w3.org/2000/svg">\n<path d="{ext}" fill="white"/>\n<path d="{d}" fill="white"/>\n</svg>\n'
open("/Users/chey/Downloads/Webflow Extractor/assets/title.svg","w").write(svg)
print(bbox(d))
