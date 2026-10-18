// Image attachments and category icons: kept apart from notes.tsx so the
// Markdown editor can load lazily without pulling these into startup.
import React, { useEffect, useState } from "react";
import { saveAttachmentRecord, getAttachment } from "./db";
import { uuid, type Category } from "../shared/model";
export async function storeImage(
  data_url: string,
  name: string,
): Promise<string> {
  if (data_url.length > 1_400_000)
    throw new Error("Image is too large. Choose a smaller image.");
  const id = uuid();
  await saveAttachmentRecord({
    id,
    name: name.slice(0, 200),
    data_url,
    uploaded: false,
  });
  return id;
}
export async function importImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml")
    throw new Error("Choose a PNG, JPEG, WebP or GIF image");
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Choose an image smaller than 20 MB");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (
      file.size <= 1024 * 1024 &&
      ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)
    ) {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Cannot read image"));
        reader.readAsDataURL(file);
      });
      return await storeImage(data, file.name);
    }

    const scale = Math.min(
      1,
      1600 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas
      .getContext("2d")!
      .drawImage(image, 0, 0, canvas.width, canvas.height);
    return await storeImage(canvas.toDataURL("image/webp", 0.82), file.name);
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function AssetImage({
  id,
  alt = "Image",
  className,
}: {
  id: string;
  alt?: string;
  className?: string;
}) {
  const [value, setValue] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setValue(undefined);
    setFailed(false);
    getAttachment(id)
      .then((asset) => {
        if (active) setValue(asset.data_url);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    const online = () => setRetry((n) => n + 1);
    window.addEventListener("online", online);
    return () => {
      active = false;
      window.removeEventListener("online", online);
    };
  }, [id, retry]);
  if (!value)
    return (
      <span className="image-placeholder">
        {failed ? (
          <button onClick={() => setRetry((n) => n + 1)}>Retry image</button>
        ) : (
          "Loading image…"
        )}
      </span>
    );
  return <img className={className} src={value} alt={alt} loading="lazy" />;
}
export function CategoryIcon({ category }: { category: Category }) {
  if (!category.icon) return null;
  return category.icon.startsWith("attachment:") ? (
    <AssetImage
      id={category.icon.slice(11)}
      alt={`${category.name} icon`}
      className="category-icon-image"
    />
  ) : (
    <span className="category-icon-emoji" aria-hidden="true">
      {category.icon}
    </span>
  );
}
export function CategoryIconPicker({
  category,
  onError,
}: {
  category: Category;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="category-icon-picker">
      <CategoryIcon category={category} />
      <input
        aria-label={`Icon for ${category.name}`}
        placeholder="Emoji"
        maxLength={16}
        defaultValue={
          category.icon?.startsWith("attachment:") ? "" : category.icon || ""
        }
        key={category.icon}
        onBlur={async (e) => {
          const next = e.target.value.trim();
          if (
            next !== (category.icon || "") &&
            (!category.icon?.startsWith("attachment:") || next)
          ) {
            try {
              const { mutate } = await import("./db");
              await mutate(category.id, "patch", { icon: next || null });
            } catch (error) {
              onError(String(error));
            }
          }
        }}
      />
      <label className="secondary-button">
        {busy ? "Saving…" : "Upload icon"}
        <input
          aria-label={`Upload icon for ${category.name}`}
          type="file"
          hidden
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setBusy(true);
            try {
              const id = await importImage(file);
              const { mutate } = await import("./db");
              await mutate(category.id, "patch", { icon: "attachment:" + id });
            } catch (error) {
              onError(String(error));
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {category.icon && (
        <button
          className="text-button"
          onClick={async () => {
            try {
              const { mutate } = await import("./db");
              await mutate(category.id, "patch", { icon: null });
            } catch (error) {
              onError(String(error));
            }
          }}
        >
          Remove icon
        </button>
      )}
    </div>
  );
}
