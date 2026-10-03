import type { InformationPagePreviewDocument } from "@fan-support/contracts";
import "./information-page.css";

type Document = Pick<
  InformationPagePreviewDocument,
  "pageKey" | "locale" | "revisionId" | "structure" | "fields"
>;

function Paragraphs({ text }: { text: string }) {
  return text
    .split(/\n\s*\n/u)
    .filter((part) => part.trim())
    .map((part, index) => <p key={index}>{part}</p>);
}

/** The saved draft preview and published page deliberately share this renderer. */
export function InformationPageBody({
  document,
  expandedQuestions = false,
}: {
  document: Document;
  expandedQuestions?: boolean;
}) {
  const { fields, pageKey } = document;
  return (
    <article
      className="information-page"
      lang={document.locale}
      data-information-page={pageKey}
      data-revision-id={document.revisionId}
    >
      <header className="information-page-heading">
        <h1>{fields.title}</h1>
        {fields.summary && <p>{fields.summary}</p>}
      </header>
      <div className="information-page-sections">
        {fields.sections.map((section) =>
          pageKey === "FAQ" ? (
            <details
              className="information-page-question"
              key={section.id}
              open={expandedQuestions || undefined}
            >
              <summary>{section.heading}</summary>
              <div>
                <Paragraphs text={section.body} />
              </div>
            </details>
          ) : (
            <section className="information-page-section" key={section.id}>
              {section.heading && <h2>{section.heading}</h2>}
              <Paragraphs text={section.body} />
            </section>
          ),
        )}
      </div>
      {pageKey === "SUPPORT" && document.structure.contactEmail && (
        <p className="information-page-contact">
          <a href={`mailto:${document.structure.contactEmail}`}>
            {document.structure.contactEmail}
          </a>
        </p>
      )}
    </article>
  );
}
