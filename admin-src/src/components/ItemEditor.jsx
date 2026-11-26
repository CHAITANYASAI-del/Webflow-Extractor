import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Banner } from '@astryxdesign/core/Banner';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { FieldEditor } from './Fields.jsx';
import { fieldsOf, itemTitle } from '../core/site.js';
import { IconCopy, IconTrash, IconUndo, IconExternal, IconArrowUp, IconArrowDown, IconDatabase } from '../icons.jsx';

const STATUS = {
  clean: null,
  edited: <Badge variant="warning" label="Unpublished changes" />,
  new: <Badge variant="success" label="New · not published" />,
  deleted: <Badge variant="error" label="Will be deleted" />,
};

export function ItemEditor({ state, col, item, ctx, actions, usage, onOpenUsage }) {
  if (!col || !item) {
    return (
      <div className="fx-empty-center">
        <EmptyState icon={<IconDatabase size={28} />} title="Pick something to edit"
          description="Choose an item on the left, or click a CMS item in the preview." isCompact />
      </div>
    );
  }
  const fields = fieldsOf(col);
  const idx = col.items.findIndex(i => i.key === item.key);
  const title = itemTitle(col, item);
  const fctx = { ...ctx, col, item, state };

  return (
    <>
      <div className="fx-editor-head">
        <HStack gap={1} vAlign="center">
          <Text type="supporting" color="secondary">{col.name}</Text>
          <div style={{ flex: 1 }} />
          <IconButton size="sm" variant="ghost" label="Move up" tooltip="Move up in list" icon={<IconArrowUp size={14} />} isDisabled={idx <= 0} onClick={() => actions.move(col.id, item.key, -1)} />
          <IconButton size="sm" variant="ghost" label="Move down" tooltip="Move down in list" icon={<IconArrowDown size={14} />} isDisabled={idx >= col.items.length - 1} onClick={() => actions.move(col.id, item.key, 1)} />
          <IconButton size="sm" variant="ghost" label="Duplicate" tooltip="Duplicate" icon={<IconCopy size={14} />} isDisabled={item.status === 'deleted'} onClick={() => actions.duplicate(col.id, item.key)} />
          {item.status === 'deleted'
            ? <IconButton size="sm" variant="ghost" label="Restore" tooltip="Restore" icon={<IconUndo size={14} />} onClick={() => actions.restore(col.id, item.key)} />
            : <IconButton size="sm" variant="ghost" label="Delete" tooltip="Delete" icon={<IconTrash size={14} />} onClick={() => actions.remove(col.id, item.key)} />}
        </HStack>
        <Heading level={4}>{title}</Heading>
        <HStack gap={1} vAlign="center" wrap="wrap">
          {STATUS[item.status]}
          {item.status === 'edited' && <Button size="sm" variant="ghost" icon={<IconUndo size={14} />} label="Discard changes" onClick={() => actions.revert(col.id, item.key)} />}
        </HStack>
      </div>
      {usage && usage.length > 0 && (
        <div className="fx-usage">
          <span className="fx-usage-label">Appears on</span>
          {usage.slice(0, 6).map(u => (
            <button key={u.page} type="button" className="fx-usage-chip" onClick={() => onOpenUsage(u.page)} title={'/' + u.page}>{u.label}</button>
          ))}
          {usage.length > 6 && <span className="fx-usage-more">+{usage.length - 6}</span>}
        </div>
      )}
      <div className="fx-editor-scroll">
        {item.status === 'deleted' ? (
          <Banner status="warning" title="This item will be deleted when you publish"
            description={item.page ? `Its page /${item.page} will be removed too.` : undefined}
            endContent={<Button size="sm" label="Restore" onClick={() => actions.restore(col.id, item.key)} />} />
        ) : (
          <div className="fx-fields">
            {item.status === 'new' && col.pagePrefix && (
              <Banner status="info" title="New item" description={`It gets its own page at /${col.pagePrefix}/<slug> when you publish. Fill in the fields, then publish.`} />
            )}
            {fields.map(f => (
              // Focusing a field outlines where it appears in the preview
              <div key={f.id} className="fx-field" data-field-id={f.id}
                onFocusCapture={() => actions.focusField(col.id, item.key, f.id)}
                onMouseEnter={() => actions.hoverField?.(col.id, item.key, f.id)}>
                <FieldEditor field={f} value={item.data[f.id]} ctx={fctx}
                  onChange={v => actions.setField(col.id, item.key, f.id, v)} />
              </div>
            ))}
            {!fields.length && <Text color="secondary">This collection has no editable fields.</Text>}
          </div>
        )}
      </div>
    </>
  );
}
