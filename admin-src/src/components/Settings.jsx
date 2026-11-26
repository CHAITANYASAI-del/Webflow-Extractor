import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { Banner } from '@astryxdesign/core/Banner';
import { Badge } from '@astryxdesign/core/Badge';
import { TextInput } from '@astryxdesign/core/TextInput';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { canUseFolder, autoTarget } from '../core/publish.js';
import { IconFolder, IconArchive, IconLock } from '../icons.jsx';
import { Brand } from './BrandLogo.jsx';

const Env = ({ rows }) => (
  <table className="fx-env"><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table>
);

function Row({ icon, title, status, children, hosts }) {
  return (
    <Card padding={4}>
      <VStack gap={3}>
        <HStack gap={3} vAlign="center">
          {icon?.type === Brand ? icon : <span className="fx-icon-tile">{icon}</span>}
          <VStack gap={0.5}>
            <Heading level={4}>{title}</Heading>
            {hosts && <span className="fx-hosts">Works with {hosts.map(h => <Brand key={h} id={h} size={12} />)}</span>}
          </VStack>
          <div style={{ flex: 1 }} />
          {status}
        </HStack>
        {children}
      </VStack>
    </Card>
  );
}

export function Settings({ server, state, setLiveUrl, onDiscardAll, dirtyCount, onLogout }) {
  const ready = <Badge variant="success" label="Ready" />;
  const notSet = <Badge variant="neutral" label="Not set up" />;
  return (
    <div className="fx-page">
      <div className="fx-page-inner">
        <VStack gap={1}>
          <Heading level={2}>Publishing & hosting</Heading>
          <Text color="secondary">Publish picks the best way automatically, based on where this CMS is running and what's connected.</Text>
        </VStack>
        <Card padding={4}>
          <HStack gap={3} vAlign="center">
            <Badge variant="success" label="Active" />
            <Text>{({
              local: 'On your computer — Publish saves straight into your site folder.',
              hybrid: 'Vercel Blob + GitHub — edits go live in seconds and every publish is also a GitHub commit.',
              blob: 'Vercel Blob — edits go live in seconds, no redeploy.',
              github: 'GitHub — every publish is a commit; your host redeploys (about 30 seconds).',
              folder: 'Your site folder — Chrome asks for the folder once, then saves into it.',
              zip: 'Download — Publish gives you a small ZIP of the changed files to upload yourself.',
            })[autoTarget(server)]}</Text>
          </HStack>
        </Card>

        {server.available && !server.configured && server.host !== 'local' && (
          <Banner status="warning" title="Protect your CMS with a password"
            description="Add an FX_ADMIN_PASSWORD environment variable in your host's dashboard and redeploy. Until then nobody (including you) can publish from the live site." />
        )}

        <Row icon={<IconFolder size={20} />} title="This computer" status={canUseFolder() ? ready : <Badge variant="warning" label="Chrome or Edge only" />}>
          <Text type="supporting" color="secondary">
            Double-click <span className="fx-code">preview-mac.command</span> / <span className="fx-code">preview-windows.bat</span> (or run <span className="fx-code">npm start</span>), open <span className="fx-code">/cms</span>, edit, click Publish — it saves into the folder.
            Then upload the folder to your host again (e.g. drag it onto Netlify Drop). No account, no setup.
          </Text>
        </Row>

        <Row icon={<Brand id="github" />} title="GitHub → auto-deploy" hosts={["vercel", "netlify", "cloudflare"]} status={server.adapters?.github ? ready : notSet}>
          {server.adapters?.github
            ? <Text type="supporting">Publishing commits to <span className="fx-code">{server.github?.repo}</span> on <span className="fx-code">{server.github?.branch}</span>. Your host redeploys automatically.</Text>
            : <>
              <ol className="fx-steps">
                <li>Put this site folder in a GitHub repository and deploy it from GitHub on Vercel, Netlify or Cloudflare Pages.</li>
                <li>Create a fine-grained token at github.com/settings/tokens with <b>Contents: Read and write</b> on that repo.</li>
                <li>Add these environment variables in your host's project settings, then redeploy:</li>
              </ol>
              <Env rows={[
                ['FX_ADMIN_PASSWORD', 'Password for the CMS (required)'],
                ['GITHUB_TOKEN', 'The token from step 2'],
                ['GITHUB_REPO', 'owner/repository'],
                ['GITHUB_BRANCH', 'Optional — defaults to main'],
                ['GITHUB_DIR', 'Optional — folder of the site inside the repo'],
              ]} />
            </>}
        </Row>

        <Row icon={<Brand id="vercel" />} title="Vercel Blob → instant" status={server.adapters?.blob ? ready : notSet}>
          {server.adapters?.blob
            ? <Text type="supporting">Edits are stored in your Vercel Blob store and served immediately by the site's middleware — no redeploy needed.</Text>
            : <>
              <ol className="fx-steps">
                <li>Deploy this folder to Vercel (drag & drop at vercel.com/new, or <span className="fx-code">npx vercel</span>).</li>
                <li>In the Vercel project: Storage → Create → Blob → connect it to the project. This adds <span className="fx-code">BLOB_READ_WRITE_TOKEN</span>.</li>
                <li>Add <span className="fx-code">FX_ADMIN_PASSWORD</span> under Settings → Environment Variables, then redeploy.</li>
              </ol>
              <Text type="supporting" color="secondary">Tip: connect GitHub too (above) and every publish is also saved as a commit — instant <i>and</i> versioned.</Text>
            </>}
        </Row>

        <Row icon={<IconArchive size={20} />} title="Download changed files" status={ready}>
          <Text type="supporting" color="secondary">Always available in any browser: get a small ZIP of only the changed files plus instructions.</Text>
        </Row>

        <Card padding={4}>
          <VStack gap={2}>
            <Heading level={4}>Live site address</Heading>
            <Text type="supporting" color="secondary">Used for image links in WordPress/Notion/Airtable exports and the sitemap. Saved with your next publish.</Text>
            <TextInput label="Live site URL" isLabelHidden placeholder="https://www.example.com" value={state.manifest.liveUrl || ''} onChange={setLiveUrl} />
          </VStack>
        </Card>

      </div>
    </div>
  );
}
