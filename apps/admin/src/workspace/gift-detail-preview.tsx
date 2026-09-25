import type { ReactNode } from "react";
import type {
  GiftDetailDocument,
  GiftDetailTranslationFields,
} from "@fan-support/contracts";
export function GiftDetailPreview({
  document,
  translation,
  renderMedia,
}: {
  document: GiftDetailDocument;
  translation: GiftDetailTranslationFields;
  renderMedia: (assetId: string, metadataRevisionId: string) => ReactNode;
}) {
  return (
    <div className="admin-gift-details">
      {document.blocks.map((block) => {
        const row = translation.blocks.find(
          (entry) => entry.blockId === block.id,
        );
        if (!row || row.kind !== block.kind) return null;
        if (row.kind === "HEADING" && block.kind === "HEADING")
          return block.level === 2 ? (
            <h2 key={block.id}>{row.text}</h2>
          ) : (
            <h3 key={block.id}>{row.text}</h3>
          );
        if (row.kind === "PARAGRAPH")
          return (
            <p className="admin-preview-copy" key={block.id}>
              {row.text}
            </p>
          );
        if (row.kind === "LIST" && block.kind === "LIST") {
          const items = block.itemIds.map((itemId) => (
            <li key={itemId}>
              {row.items.find((item) => item.itemId === itemId)?.text}
            </li>
          ));
          return block.style === "ORDERED" ? (
            <ol key={block.id}>{items}</ol>
          ) : (
            <ul key={block.id}>{items}</ul>
          );
        }
        if (row.kind === "SPECIFICATIONS" && block.kind === "SPECIFICATIONS")
          return (
            <dl key={block.id}>
              {block.itemIds.flatMap((itemId) => {
                const item = row.items.find((entry) => entry.itemId === itemId);
                return item
                  ? [
                      <dt key={`${itemId}-label`}>{item.label}</dt>,
                      <dd key={`${itemId}-value`}>{item.value}</dd>,
                    ]
                  : [];
              })}
            </dl>
          );
        if (row.kind === "MEDIA" && block.kind === "MEDIA")
          return (
            <figure key={block.id}>
              {renderMedia(block.mediaAssetId, block.mediaMetadataRevisionId)}
              {row.caption && <figcaption>{row.caption}</figcaption>}
            </figure>
          );
        return null;
      })}
    </div>
  );
}
