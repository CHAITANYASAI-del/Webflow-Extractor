import { useState } from 'react';
import { Card } from '@astryxdesign/core/Card';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Button } from '@astryxdesign/core/Button';
import { VStack } from '@astryxdesign/core/Stack';
import { login } from '../core/publish.js';
import logoUrl from '../logo.png';

export function Login({ siteName, onDone }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e?.preventDefault?.();
    if (!pw) return;
    setBusy(true); setErr('');
    try { await login(pw); onDone(); }
    catch (x) { setErr(x.message || 'Could not sign in'); }
    finally { setBusy(false); }
  };
  return (
    <div className="fx-gate">
      <div className="fx-gate-card">
        <Card padding={6} elevation="med">
          <form onSubmit={submit}>
            <VStack gap={4}>
              <img className="fx-logo" src={logoUrl} alt="Webflow Extractor" style={{ width: 44, height: 44, borderRadius: 11 }} />
              <VStack gap={1}>
                <Heading level={2}>Sign in to edit</Heading>
                <Text color="secondary">{siteName ? `${siteName} · ` : ''}CMS</Text>
              </VStack>
              <TextInput type="password" label="Admin password" value={pw} onChange={setPw} hasAutoFocus autoComplete="current-password"
                status={err ? { type: 'error', message: err } : undefined} onEnter={submit} />
              <Button type="submit" variant="primary" label="Sign in" isLoading={busy} width="100%" />
              <Text type="supporting" color="secondary">Forgot it? It's the <b>FX_ADMIN_PASSWORD</b> in your host's settings (Vercel: Settings → Environment Variables). Change it there and redeploy to reset.</Text>
            </VStack>
          </form>
        </Card>
      </div>
    </div>
  );
}
