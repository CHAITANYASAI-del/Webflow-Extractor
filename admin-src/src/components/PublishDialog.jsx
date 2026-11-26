import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Banner } from '@astryxdesign/core/Banner';
import { SelectableCard } from '@astryxdesign/core/SelectableCard';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { canUseFolder } from '../core/publish.js';
import { IconFolder, IconArchive } from '../icons.jsx';
import { Brand } from './BrandLogo.jsx';

export function publishTargets(server) {
  const t = [];
  if (server.adapters?.blob) t.push({ id: 'blob', icon: <Brand id="vercel" />, title: 'Publish live (Vercel Blob)', desc: 'Changes go live in about 10 seconds. No redeploy.', ready: true });
  if (server.adapters?.github) t.push({ id: 'github', icon: <Brand id="github" />, title: `Commit to GitHub`, desc: `${server.github?.repo} · ${server.github?.branch}. Your host redeploys automatically (~1 min).`, ready: true });
  if (canUseFolder() && server.local) t.push({ id: 'folder', icon: <IconFolder size={20} />, title: 'Save to site folder', desc: 'Writes the changes straight into your exported site folder on this computer.', ready: true });
  if (canUseFolder() && !server.local) t.push({ id: 'folder', icon: <IconFolder size={20} />, title: 'Save to a folder on this computer', desc: 'Pick your local copy of the site; the changes are written into it.', ready: true });
  t.push({ id: 'zip', icon: <IconArchive size={20} />, title: 'Download changed files', desc: 'A small ZIP with only the changed files and instructions. Works anywhere.', ready: true });
  return t;
}

export function PublishDialog({ isOpen, onOpenChange, server, summary, onPublish }) {
  const targets = useMemo(() => publishTargets(server), [server]);
  const [target, setTarget] = useState(targets[0]?.id);
  const [message, setMessage] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | working | done | error
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { if (isOpen) { setPhase('idle'); setProgress(0); setError(''); setResult(null); setTarget(targets[0]?.id); } }, [isOpen, targets]);

  const go = async () => {
    setPhase('working'); setError('');
    try {
      const r = await onPublish(target, { message: message || undefined, onProgress: p => setProgress(Math.round(p * 100)) });
      setResult(r); setPhase('done');
    } catch (e) {
      if (e?.name === 'AbortError') { setPhase('idle'); return; }
      setError(e.message || String(e)); setPhase('error');
    }
  };

  const doneText = {
    blob: 'Published. Your live site shows the changes within about 10 seconds.',
    github: 'Committed to GitHub. Your host is redeploying — the live site updates in about a minute.',
    folder: 'Saved into your site folder. Redeploy the folder (e.g. drag it onto Netlify Drop) to update the live site.',
    zip: 'Downloaded. Copy the files into your site folder and redeploy.',
  }[target];

  return (
    <Dialog isOpen={isOpen} onOpenChange={o => phase !== 'working' && onOpenChange(o)} width={560} purpose="form">
      <DialogHeader title="Publish changes" subtitle={`${summary} · Your edits are already saved — publishing pushes them to your site.`} onOpenChange={o => phase !== 'working' && onOpenChange(o)} />
      <div style={{ padding: '0 24px 24px' }}>
        {phase === 'done' ? (
          <VStack gap={3}>
            <Banner status="success" title="Done" description={doneText} />
            {result?.url && <Button variant="secondary" label="View commit on GitHub" href={result.url} target="_blank" />}
            <HStack justify="end"><Button variant="primary" label="Close" onClick={() => onOpenChange(false)} /></HStack>
          </VStack>
        ) : (
          <VStack gap={3}>
            <VStack gap={2} role="radiogroup" aria-label="Where to publish">
              {targets.map(t => (
                <SelectableCard key={t.id} label={t.title} isSelected={target === t.id} onChange={() => setTarget(t.id)} isDisabled={phase === 'working'} padding={3}>
                  <HStack gap={3} vAlign="start">
                    {t.icon?.type === Brand ? t.icon : <span className="fx-icon-tile">{t.icon}</span>}
                    <VStack gap={0.5}>
                      <Text weight="semibold">{t.title}</Text>
                      <Text type="supporting" color="secondary">{t.desc}</Text>
                    </VStack>
                  </HStack>
                </SelectableCard>
              ))}
            </VStack>
            {target === 'github' && <TextInput label="Commit message" isOptional placeholder="Update CMS content" value={message} onChange={setMessage} />}
            {!server.adapters?.github && !server.adapters?.blob && (
              <Text type="supporting" color="secondary">Want one-click publishing from your live site? Open the menu (top-left) → Publishing & hosting to connect GitHub or Vercel Blob.</Text>
            )}
            {phase === 'working' && <ProgressBar label="Publishing" value={progress} max={100} hasValueLabel />}
            {phase === 'error' && <Banner status="error" title="Publishing failed" description={error} />}
            <HStack justify="end" gap={2}>
              <Button variant="ghost" label="Cancel" isDisabled={phase === 'working'} onClick={() => onOpenChange(false)} />
              <Button variant="primary" label={phase === 'error' ? 'Try again' : 'Publish'} isLoading={phase === 'working'} onClick={go} />
            </HStack>
          </VStack>
        )}
      </div>
    </Dialog>
  );
}
