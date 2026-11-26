import JSZip from 'jszip';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Banner } from '@astryxdesign/core/Banner';
import { toCSV, toJSON, toWXR, download } from '../core/exporters.js';
import { slugify } from '../core/site.js';
import { IconDownload } from '../icons.jsx';
import { Brand } from './BrandLogo.jsx';

function Steps({ items }) {
  return <ol className="fx-steps">{items.map((s, i) => <li key={i}>{s}</li>)}</ol>;
}

function Tile({ logo, title, tagline, children, onDownload, note }) {
  return (
    <article className="fx-int-card">
      <header className="fx-int-head">
        {logo}
        <div>
          <h3 className="fx-int-title">{title}</h3>
          <p className="fx-int-tagline">{tagline}</p>
        </div>
      </header>
      <div className="fx-int-body">{children}</div>
      <footer className="fx-int-actions">
        <Button variant="primary" size="sm" icon={<IconDownload size={13} />} label="Download" onClick={onDownload} />
        {note && <span className="fx-int-note">{note}</span>}
      </footer>
    </article>
  );
}

// Every export includes ALL collections — one file when the format allows it,
// otherwise a ZIP with one file per collection.
async function zipOf(files, name) {
  if (files.length === 1) { download(files[0][0], files[0][1], files[0][2]); return; }
  const zip = new JSZip();
  files.forEach(([n, c]) => zip.file(n, c));
  download(name, await zip.generateAsync({ type: 'blob' }));
}

export function Integrations({ state }) {
  const cols = state.collections;
  const site = slugify(state.manifest.siteName || 'site').slice(0, 40) || 'site';
  const siteTitle = state.manifest.siteName || 'Webflow site';
  const items = cols.reduce((n, c) => n + c.items.filter(i => i.status !== 'deleted').length, 0);
  const csvFiles = opts => cols.map(c => [`${slugify(c.name)}.csv`, toCSV(state, c, opts), 'text/csv']);
  const fileNote = cols.length > 1 ? `${cols.length} CSV files (.zip)` : '1 CSV file';

  if (!cols.length) {
    return <div className="fx-page"><div className="fx-page-inner"><Banner status="info" title="No CMS collections" description="This site doesn't use Webflow CMS, so there's no content to export." /></div></div>;
  }

  return (
    <div className="fx-page">
      <div className="fx-page-inner">
        <div className="fx-page-head">
          <div>
            <Heading level={2}>Export your content</Heading>
            <Text color="secondary">All {cols.length} collection{cols.length === 1 ? '' : 's'} · {items} items, including unpublished edits.</Text>
          </div>
        </div>

        <div className="fx-grid">
          <Tile logo={<Brand id="wordpress" />} title="WordPress" tagline="Posts with content, images and categories"
            note="1 .xml file" onDownload={() => download(`${site}-wordpress.xml`, toWXR(state, cols, { siteTitle }), 'application/xml')}>
            <Steps items={['Tools → Import → WordPress', 'Upload the .xml file', 'Tick “Download and import file attachments”']} />
          </Tile>

          <Tile logo={<Brand id="notion" />} title="Notion" tagline="One database per collection"
            note={fileNote} onDownload={() => zipOf(csvFiles({ titleFirst: true, rich: 'text', pageUrl: true }), `${site}-notion.zip`)}>
            <Steps items={['Unzip the download', '⋯ → Import → CSV, once per file', 'First column becomes each page’s title']} />
          </Tile>

          <Tile logo={<Brand id="airtable" />} title="Airtable" tagline="One table per collection"
            note={fileNote} onDownload={() => zipOf(csvFiles({ titleFirst: true, rich: 'text', pageUrl: true }), `${site}-airtable.zip`)}>
            <Steps items={['Unzip the download', 'Add a base → Import → CSV, once per file', 'Set image columns to “Attachment”']} />
          </Tile>

          <Tile logo={<Brand id="webflow" />} title="Webflow" tagline="CMS collections with rich text"
            note={fileNote} onDownload={() => zipOf(csvFiles({ rich: 'html', refs: 'slug' }), `${site}-webflow.zip`)}>
            <Steps items={['Create collections with matching fields', 'Collection → Import → upload each CSV', 'References use slugs, rich text is HTML']} />
          </Tile>

          <Tile logo={<Brand id="sheets" />} title="Google Sheets" tagline="Review or bulk-edit, works in Excel too"
            note={fileNote} onDownload={() => zipOf(csvFiles({ rich: 'text', pageUrl: true }), `${site}-spreadsheets.zip`)}>
            <Steps items={['Unzip the download', 'File → Import → Upload each CSV', 'Excel / Numbers: just open the files']} />
          </Tile>

          <Tile logo={<Brand id="json" />} title="JSON" tagline="For developers: Next.js, Astro, Sanity…"
            note="1 .json file" onDownload={() => {
              const all = Object.fromEntries(cols.map(c => [c.name, JSON.parse(toJSON(state, c))]));
              download(`${site}-content.json`, JSON.stringify({ site: siteTitle, exportedAt: new Date().toISOString(), collections: all }, null, 2), 'application/json');
            }}>
            <Steps items={['Field names match your Webflow fields', 'Rich text is clean HTML', 'References are resolved to titles']} />
          </Tile>
        </div>
      </div>
    </div>
  );
}
