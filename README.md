# Webflow Extractor

A Chrome extension (Manifest V3) that exports a published Webflow site as a static folder you can host anywhere. It also builds a CMS editor for the export, served at `/cms`.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Open any published Webflow site and click the extension.

## What an export contains

- Every page, with its images, videos, fonts, CSS and JS downloaded locally. Nothing loads from Webflow's servers.
- An RSS feed and a 404 page.
- Hosting files for Vercel, Netlify or any static host, plus a local preview server.
- A CMS editor at `/cms` when the site uses Webflow CMS. It covers:
  - Collections, with reference and multi-reference fields.
  - Lists that have no page of their own, such as testimonials and FAQs.
  - Paginated lists.

Forms, site search, ecommerce and memberships need Webflow's servers, so they don't work in the export.

## Project layout

| Path | What it is |
|---|---|
| `manifest.json`, `popup.*`, `content.js`, `core.js`, `webflow-cms.js` | The extension: crawl and export engine, and CMS detection |
| `admin-src/` | The CMS editor source (React and Vite). `npm install && npm run build` writes `admin-dist/` |
| `admin-dist/` | The built editor, copied into each export |
| `site-kit/` | The preview server and hosting adapters copied into each export |
| `assets/`, `icons/` | Popup artwork and extension icons |
| `design/` | Original logo and title files |
| `dev/` | Test tools, not part of the extension (see [dev/README.md](dev/README.md)) |

When you zip the extension for the Chrome Web Store, leave out `dev/`, `design/`, `admin-src/` and every `node_modules` folder.
