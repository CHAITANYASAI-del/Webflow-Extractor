# Dev tools (not part of the extension)

Test tools for the Webflow Extractor. Everything here runs with Node from this folder.

```bash
npm install          # once, installs linkedom
node harness.cjs https://two26.studio/ out/two26        # export a site -> out/two26/site.zip
mkdir -p out/two26-x && unzip -q out/two26/site.zip -d out/two26-x
node qa.mjs out/two26-x/*                               # CMS edit scenarios + link check
node linkcheck.cjs out/two26-x/*                        # broken links only
```

- `qa.mjs` edits the folder it is given, so always run it on a fresh unzip. `QA_COL=Blog` picks the collection to test.
- `runqa.sh <name>...` re-runs the QA on `qa2/<name>/site.zip` exports.
- `reannotate.cjs <site-folder> [out]` re-runs CMS detection on an exported folder.
- Editor build: `cd ../admin-src && npm install && npm run build` (writes `../admin-dist`).

Leave `dev/` and `admin-src/node_modules` out when you zip the extension for the Chrome Web Store.

- `browser-test/`: `node browser-test/mk.cjs <export-folder> <name>` writes page data, then open `browser-test/index.html?<name>` over a local server from the project root to compare Chrome's parser with linkedom.
- `gen_title.py`: old title-image generator (the title is now `design/WebFlow Extractor Title.svg`).
