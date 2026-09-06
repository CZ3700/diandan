"use client";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Button } from "@fan-support/ui";
import {
  adminPreviewMediaResponseSchema,
  baseContentPreviewResponseSchema,
  baseContentResponseSchema,
  type BaseContentTarget,
  type BaseContentPreviewResponse,
  type AdminPreviewMediaResponse,
  MEDIA_IMAGE_PROFILE,
} from "@fan-support/contracts";
import { useAdminSession, AdminClientError } from "./client";
import { errorText, translator, type Translate } from "./components";
type Preview = Extract<BaseContentPreviewResponse, { outcome: "SUCCESS" }>;
type Media = Extract<
  AdminPreviewMediaResponse,
  { outcome: "SUCCESS" }
>["images"][number];
type ImageView = { image: Media; url: string | null };
export function PreviewBody({
  content,
  images,
  t,
}: {
  content: Preview["content"];
  images: ImageView[];
  t: Translate;
}) {
  const name =
    "displayName" in content.fields
      ? content.fields.displayName
      : "heroTitle" in content.fields
        ? content.fields.heroTitle
        : "title" in content.fields
          ? content.fields.title
          : undefined;
  return (
    <article className="admin-preview-content">
      <h1>{name ?? t("privatePreview")}</h1>
      <div className="admin-preview-images">
        {images.map(({ image, url }, index) => (
          <figure key={`${image.assetId}-${index}`}>
            {url && image.status === "AVAILABLE" ? (
              <Image
                unoptimized
                src={url}
                alt={image.presentationKind === "DECORATIVE" ? "" : image.alt}
                width={image.width}
                height={image.height}
                style={{
                  objectPosition: `${image.focalPoint.x * 100}% ${image.focalPoint.y * 100}%`,
                }}
              />
            ) : (
              <div className="admin-image-unavailable">
                {t("noMedia")}{" "}
                <small>
                  {image.status === "UNAVAILABLE" ? image.code : t("loading")}
                </small>
              </div>
            )}
          </figure>
        ))}
      </div>
      {Object.entries(content.fields)
        .filter(
          ([key]) =>
            ![
              "displayName",
              "heroTitle",
              "seoTitle",
              "seoDescription",
            ].includes(key),
        )
        .map(([key, value]) =>
          Array.isArray(value) ? (
            <div key={key}>
              {value.map((row: { slotKey: string; label: string }) => (
                <h2 key={row.slotKey}>{row.label}</h2>
              ))}
            </div>
          ) : typeof value === "string" && value ? (
            content.kind === "IDOL" && key === "fullBio" ? (
              <div
                className="admin-preview-copy"
                key={key}
                dangerouslySetInnerHTML={{ __html: value }}
              />
            ) : (
              <p className="admin-preview-copy" key={key}>
                {value}
              </p>
            )
          ) : null,
        )}
    </article>
  );
}
export function AdminPreview({
  target,
  viewport,
}: {
  target: BaseContentTarget;
  viewport: "mobile" | "desktop";
}) {
  const { session, client, loading, reload } = useAdminSession();
  const t = useMemo(() => translator(target.locale), [target.locale]);
  const [content, setContent] = useState<Preview["content"] | null>(null);
  const [images, setImages] = useState<ImageView[]>([]);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [close, setClose] = useState<(() => Promise<void>) | null>(null);
  useEffect(() => {
    if (!session) return;
    let active = true;
    let grantId: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let authorizationTimer: ReturnType<typeof setInterval> | undefined;
    const abort = new AbortController();
    const urls: string[] = [];
    const clear = () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.length = 0;
      setContent(null);
      setImages([]);
    };
    const revoke = async () => {
      clearTimeout(timer);
      clearInterval(authorizationTimer);
      abort.abort();
      if (active) {
        clear();
        setExpired(true);
      }
      if (grantId) {
        const id = grantId;
        grantId = null;
        await client.call(
          "preview-revoke",
          { schemaVersion: 1, grantId: id, reasonCode: "PREVIEW_CLOSED" },
          baseContentResponseSchema,
          true,
        );
      }
    };
    setContent(null);
    setImages([]);
    setError("");
    setExpired(false);
    setClose(() => revoke);
    void (async () => {
      const grant = await client.call(
        "preview-issue",
        {
          schemaVersion: 1,
          target,
          ttlSeconds: 300,
          reasonCode: "CONTENT_PREVIEW",
        },
        baseContentResponseSchema,
      );
      if (grant.kind !== "PREVIEW_GRANT")
        throw new AdminClientError("INVALID_RESPONSE");
      grantId = grant.grantId;
      if (!active) {
        await revoke();
        return;
      }
      const deadline = Date.parse(grant.expiresAt);
      timer = setTimeout(
        () => {
          if (active) {
            clearInterval(authorizationTimer);
            abort.abort();
            clear();
            setExpired(true);
          }
        },
        Math.max(0, deadline - Date.now()),
      );
      const body = { schemaVersion: 1, target, token: grant.token };
      const preview = await client.call(
        "preview-content-read",
        body,
        baseContentPreviewResponseSchema,
      );
      if (!active || abort.signal.aborted) return;
      setContent(preview.content);
      // Re-check the current grant authority while an operator keeps a preview open.
      authorizationTimer = setInterval(() => {
        void client
          .call("preview-content-read", body, baseContentPreviewResponseSchema)
          .catch(() => {
            if (!active) return;
            clearInterval(authorizationTimer);
            abort.abort();
            clear();
            setExpired(true);
          });
      }, 15000);
      const media = await client.call(
        "preview-media-read",
        body,
        adminPreviewMediaResponseSchema,
      );
      const ready = await Promise.all(
        media.images.map(async (image): Promise<ImageView> => {
          if (image.status !== "AVAILABLE") return { image, url: null };
          const response = await fetch(image.download.url, {
            method: image.download.method,
            headers: image.download.headers,
            credentials: "omit",
            redirect: "error",
            referrerPolicy: "no-referrer",
            signal: abort.signal,
          });
          if (!response.ok) throw new AdminClientError("MEDIA_UNAVAILABLE");
          const blob = await response.blob();
          if (blob.size > MEDIA_IMAGE_PROFILE.outputByteLimit)
            throw new AdminClientError("MEDIA_UNAVAILABLE");
          if (!active || abort.signal.aborted) return { image, url: null };
          const url = URL.createObjectURL(blob);
          urls.push(url);
          return { image, url };
        }),
      );
      if (active && !abort.signal.aborted) setImages(ready);
    })().catch((e: unknown) => {
      if (active && !abort.signal.aborted) setError(errorText(e, t));
    });
    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(authorizationTimer);
      abort.abort();
      urls.forEach((url) => URL.revokeObjectURL(url));
      if (grantId)
        void client
          .call(
            "preview-revoke",
            { schemaVersion: 1, grantId, reasonCode: "PREVIEW_CLOSED" },
            baseContentResponseSchema,
            true,
          )
          .catch(() => {});
    };
  }, [session, client, target, refresh, t]);
  if (loading)
    return (
      <main className="admin-auth">
        <p role="status">{t("loading")}</p>
      </main>
    );
  if (!session)
    return (
      <main className="admin-auth">
        <h1>{t("sessionRequired")}</h1>
        <Button onClick={reload}>{t("reload")}</Button>
      </main>
    );
  return (
    <main className="admin-preview" data-viewport={viewport}>
      <header>
        <strong>{t("privatePreview")}</strong>
        <span>{target.locale}</span>
        <Button
          variant="quiet"
          onClick={() => {
            void close?.().catch((e: unknown) => setError(errorText(e, t)));
          }}
        >
          {t("revoke")}
        </Button>
      </header>
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
      {expired ? (
        <div className="admin-notice" role="status">
          <p>{t("previewExpired")}</p>
          <Button onClick={() => setRefresh((value) => value + 1)}>
            {t("reload")}
          </Button>
        </div>
      ) : content ? (
        <PreviewBody content={content} images={images} t={t} />
      ) : (
        <p role="status">{t("loading")}</p>
      )}
    </main>
  );
}
