import {
  policyTranslationFieldsSchema,
  type PublishedGiftDetails,
} from "@fan-support/contracts";
import type { StorefrontCopy } from "./copy";
import { PublishedImage } from "./published-image";

export function GiftDescription({
  details,
  copy,
}: Readonly<{ details: PublishedGiftDetails; copy: StorefrontCopy }>) {
  if (details.format === "LEGACY_TEXT")
    return <p className="gift-description-text">{details.text}</p>;
  return (
    <div className="gift-description-blocks">
      {details.blocks.map((block) => {
        switch (block.kind) {
          case "HEADING": {
            const Heading = block.level === 2 ? "h2" : "h3";
            return <Heading key={block.id}>{block.text}</Heading>;
          }
          case "PARAGRAPH":
            return <p key={block.id}>{block.text}</p>;
          case "LIST": {
            const List = block.style === "ORDERED" ? "ol" : "ul";
            return (
              <List key={block.id}>
                {block.items.map((item) => (
                  <li key={item.id}>{item.text}</li>
                ))}
              </List>
            );
          }
          case "SPECIFICATIONS":
            return (
              <dl key={block.id}>
                {block.items.map((item) => (
                  <div key={item.id}>
                    <dt>{item.label}</dt>
                    <dd>{item.value}</dd>
                  </div>
                ))}
              </dl>
            );
          case "MEDIA":
            return (
              <figure key={block.id}>
                <PublishedImage
                  media={block.media}
                  fallbackLabel={copy.mediaFallback}
                  sizes="(max-width: 48rem) 90vw, 50vw"
                />
                {block.caption && <figcaption>{block.caption}</figcaption>}
              </figure>
            );
        }
      })}
    </div>
  );
}

export function PolicyBody({ body }: Readonly<{ body: string }>) {
  const safe = policyTranslationFieldsSchema.shape.body.parse(body);
  return (
    <div
      className="storefront-biography gift-policy-body"
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
