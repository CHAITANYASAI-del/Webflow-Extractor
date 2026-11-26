#!/bin/bash
# fresh copy of each export, then the scenario QA
cd "$(dirname "$0")"
for s in "$@"; do rm -rf qa2/$s-x && mkdir qa2/$s-x && unzip -q qa2/$s/site.zip -d qa2/$s-x; echo "== $s"; node qa.mjs qa2/$s-x/* 2>&1 | grep -vE "^  ✓"; done
