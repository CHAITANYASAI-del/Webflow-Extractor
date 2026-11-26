import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { VStack, HStack } from '@astryxdesign/core/Stack';
import logoUrl from '../logo.png';

// Shown on a LIVE site whose CMS can't save yet: no password set, or a host
// that only serves files. Says exactly what to do, for people doing it
// themselves and for people using an AI coding tool.
export function Setup({ server, onContinue }) {
  const canServe = server.available; // our /api/fx-cms function runs here
  const host = server.host === 'netlify' ? 'netlify' : server.host === 'vercel' ? 'vercel' : 'other';
  const code = t => <span className="fx-code">{t}</span>;

  let title, intro, steps;
  if (canServe && host === 'vercel') {
    title = 'Turn on editing for your live site';
    intro = 'Your site is live. Add a password so only you can edit it — takes about a minute.';
    steps = [
      <>Open your project on <b>vercel.com</b> → <b>Settings</b> → <b>Environment Variables</b>.</>,
      <>Add {code('FX_ADMIN_PASSWORD')} with a password you choose. That's your CMS password.</>,
      <>For instant publishing: <b>Storage</b> → <b>Create</b> → <b>Blob</b> → connect it to this project. <i>(Recommended — edits go live in seconds.)</i></>,
      <><b>Deployments</b> → <b>⋯</b> on the latest one → <b>Redeploy</b>. Then reload this page.</>,
    ];
  } else if (canServe && host === 'netlify') {
    title = 'Turn on editing for your live site';
    intro = 'On Netlify, the CMS publishes by committing to your site\'s GitHub repository.';
    steps = [
      <>Make sure this Netlify site deploys from a <b>GitHub</b> repository.</>,
      <>Create a token at <b>github.com/settings/tokens</b> (fine-grained) with <b>Contents: Read and write</b> on that repo.</>,
      <>In Netlify → <b>Site configuration</b> → <b>Environment variables</b>, add {code('FX_ADMIN_PASSWORD')} (your CMS password), {code('GITHUB_TOKEN')} and {code('GITHUB_REPO')} ({code('owner/name')}).</>,
      <><b>Deploys</b> → <b>Trigger deploy</b>. Then reload this page.</>,
    ];
  } else {
    title = 'Edit on your computer';
    intro = 'This host only serves files, so edits can\'t be saved online. Edit on your computer, then upload the folder again — no accounts or setup.';
    steps = [
      <>Open your exported site folder and double-click {code('preview-mac.command')} (Mac) or {code('preview-windows.bat')} (Windows).</>,
      <>Open {code('http://localhost:8080/cms/')}, make your edits and click <b>Publish</b> — it saves into the folder.</>,
      <>Upload the folder to your host again (Netlify Drop: your site → <b>Deploys</b> → drag the folder in).</>,
    ];
  }

  return (
    <div className="fx-gate">
      <div className="fx-gate-card fx-setup">
        <Card padding={6} elevation="med">
          <VStack gap={4}>
            <img className="fx-logo" src={logoUrl} alt="Webflow Extractor" style={{ width: 44, height: 44, borderRadius: 11 }} />
            <VStack gap={1}>
              <Heading level={2}>{title}</Heading>
              <Text color="secondary">{intro}</Text>
            </VStack>
            <ol className="fx-steps">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            <div className="fx-setup-agent">
              <Text type="supporting">
                <b>Using Claude Code, Cursor or another AI tool?</b> Open the site folder in it and say
                {' '}<i>“Set up the CMS on my live site.”</i> It follows {code('AGENTS.md')} and asks you for the password.
              </Text>
            </div>
            <HStack gap={2}>
              {canServe && <Button variant="primary" label="I've done it — reload" onClick={() => location.reload()} />}
              <Button variant="secondary" label="Open the editor anyway" onClick={onContinue} />
            </HStack>
            {canServe && <Text type="supporting" color="secondary">Without a password, the editor opens but can only download your changes as files.</Text>}
          </VStack>
        </Card>
      </div>
    </div>
  );
}
