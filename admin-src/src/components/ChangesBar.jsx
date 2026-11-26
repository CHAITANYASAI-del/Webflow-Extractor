import { Spinner } from '@astryxdesign/core/Spinner';
import { IconCheck } from '../icons.jsx';

// Floating publish bar. Idle: count + Discard + Publish. While publishing it
// shows progress, then a short confirmation — no dialogs, no choices.
export function ChangesBar({ count, status, onDiscard, onPublish, onPickFolder, onDismiss }) {
  if (status?.phase === 'needs-server') {
    return (
      <div className="fx-changes-bar is-info" role="alert">
        <span className="fx-changes-text">To publish, run your site with <b className="fx-kbd">npm start</b> or <b className="fx-kbd">preview-mac.command</b></span>
        <button type="button" className="fx-changes-ghost" onClick={onPickFolder}>Choose folder instead</button>
        <button type="button" className="fx-changes-cta" onClick={onDismiss}>Got it</button>
      </div>
    );
  }
  if (status?.phase === 'working') {
    return (
      <div className="fx-changes-bar" role="status">
        <span className="fx-changes-text"><Spinner size="sm" /> {status.text || 'Publishing…'}</span>
      </div>
    );
  }
  if (status?.phase === 'live-wait') {
    return (
      <div className="fx-changes-bar" role="status">
        <span className="fx-changes-text"><Spinner size="sm" /> {status.text}</span>
      </div>
    );
  }
  if (status?.phase === 'done') {
    return (
      <div className="fx-changes-bar is-done" role="status">
        <span className="fx-changes-text"><IconCheck size={14} /> {status.text}</span>
      </div>
    );
  }
  if (status?.phase === 'error') {
    return (
      <div className="fx-changes-bar is-error" role="alert">
        <span className="fx-changes-text" title={status.text}>Couldn't publish: {status.text}</span>
        <button type="button" className="fx-changes-cta" onClick={onPublish}>Try again</button>
      </div>
    );
  }
  return (
    <div className="fx-changes-bar" role="region" aria-label="Unpublished changes">
      <span className="fx-changes-text"><span className="fx-changes-dot" aria-hidden="true" />{count} unpublished change{count === 1 ? '' : 's'}</span>
      <button type="button" className="fx-changes-ghost" onClick={onDiscard}>Discard</button>
      <button type="button" className="fx-changes-cta" onClick={onPublish}>Publish</button>
    </div>
  );
}
