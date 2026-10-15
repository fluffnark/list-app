import React, { useEffect, useRef, useState } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { zipSync, strToU8 } from "fflate";
import { saveAttachmentRecord, getAttachment, attachmentIds } from "./db";
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
export function NotePreview({ text }: { text: string }) {
  return (
    <div className="markdown-body">
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url, key) => {
          if (
            url.startsWith("attachment:") ||
            (key === "href" && /^(obsidian|listflow):/.test(url))
          )
            return url;
          return defaultUrlTransform(url);
        }}
        components={{
          img: ({ src, alt }) =>
            src?.startsWith("attachment:") ? (
              <AssetImage id={src.slice(11)} alt={alt || "Attachment"} />
            ) : src ? (
              <img src={src} alt={alt || ""} loading="lazy" />
            ) : (
              <span>{alt}</span>
            ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text || "No content."}
      </Markdown>
    </div>
  );
}
function Drawing({
  noteId,
  onSave,
  onClose,
  onError,
}: {
  noteId: string;
  onSave: (data: string) => Promise<void>;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const history = useRef<string[]>([]);
  const [color, setColor] = useState("#27232e");
  const [width, setWidth] = useState(4);
  const [busy, setBusy] = useState(false);
  const key = "listflow-drawing:" + noteId;
  const remember = () => {
    const data = canvas.current!.toDataURL("image/png");
    history.current = [...history.current.slice(-19), data];
    try {
      localStorage.setItem(key, data);
    } catch {}
  };
  useEffect(() => {
    const surface = canvas.current!;
    const ctx = surface.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, surface.width, surface.height);
    const saved = localStorage.getItem(key);
    if (saved) {
      const image = new Image();
      image.onload = () => {
        ctx.drawImage(image, 0, 0);
        remember();
      };
      image.src = saved;
    } else remember();
  }, []);
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return [
      ((event.clientX - bounds.left) * event.currentTarget.width) /
        bounds.width,
      ((event.clientY - bounds.top) * event.currentTarget.height) /
        bounds.height,
    ];
  };
  return (
    <div className="drawing-panel" role="dialog" aria-label="Draw a note">
      <div className="note-toolbar">
        <strong>Drawing</strong>
        <label>
          Color{" "}
          <input
            aria-label="Pen color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
        <label>
          Pen{" "}
          <input
            aria-label="Pen width"
            type="range"
            min="1"
            max="20"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
        </label>
      </div>
      <canvas
        ref={canvas}
        width={960}
        height={540}
        aria-label="Drawing canvas"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = true;
          const ctx = event.currentTarget.getContext("2d")!;
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          const [x, y] = point(event);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + 0.1, y + 0.1);
          ctx.stroke();
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const [x, y] = point(event);
          const ctx = event.currentTarget.getContext("2d")!;
          ctx.lineTo(x, y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
          remember();
        }}
        onPointerCancel={() => {
          drawing.current = false;
          remember();
        }}
      />
      <div className="note-toolbar">
        <button
          className="secondary-button"
          onClick={() => {
            if (history.current.length < 2) return;
            history.current.pop();
            const image = new Image();
            image.onload = () => {
              const c = canvas.current!;
              c.getContext("2d")!.drawImage(image, 0, 0);
              try {
                localStorage.setItem(key, image.src);
              } catch {}
            };
            image.src = history.current.at(-1)!;
          }}
        >
          Undo stroke
        </button>
        <button
          className="secondary-button"
          onClick={() => {
            const c = canvas.current!;
            const ctx = c.getContext("2d")!;
            ctx.fillStyle = "white";
            ctx.fillRect(0, 0, c.width, c.height);
            remember();
          }}
        >
          Clear drawing
        </button>
        <button
          className="primary-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSave(canvas.current!.toDataURL("image/png"));
              localStorage.removeItem(key);
              onClose();
            } catch (error) {
              onError(String(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          Save drawing
        </button>
        <button className="text-button" onClick={onClose}>
          Close drawing
        </button>
      </div>
    </div>
  );
}
export function NoteEditor({
  noteId,
  value,
  onChange,
  onError,
}: {
  noteId: string;
  value: string;
  onChange: (value: string) => void;
  onError: (message: string) => void;
}) {
  const [preview, setPreview] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const current = useRef({ value, onChange });
  current.current = { value, onChange };
  const append = (text: string) =>
    current.current.onChange(current.current.value + text);
  const attach = async (files: File[]) => {
    setBusy(true);
    try {
      for (const file of files) {
        const id = await importImage(file);
        append(
          `\n\n![${file.name.replace(/[\[\]\\\n\r]/g, "") || "Image"}](attachment:${id})\n`,
        );
      }
    } catch (error) {
      onError(String(error));
    } finally {
      setBusy(false);
    }
  };
  const insert = (before: string, after = "") => {
    const start = textarea.current?.selectionStart ?? value.length,
      end = textarea.current?.selectionEnd ?? value.length;
    onChange(
      value.slice(0, start) +
        before +
        value.slice(start, end) +
        after +
        value.slice(end),
    );
    queueMicrotask(() => textarea.current?.focus());
  };
  return (
    <div className="note-editor">
      <div className="note-toolbar">
        <button
          className={
            !preview ? "secondary-button selected" : "secondary-button"
          }
          aria-pressed={!preview}
          onClick={() => setPreview(false)}
        >
          Edit
        </button>
        <button
          className={preview ? "secondary-button selected" : "secondary-button"}
          aria-pressed={preview}
          onClick={() => setPreview(true)}
        >
          Preview
        </button>
        <label className="secondary-button">
          {busy ? "Adding image…" : "Add image"}
          <input
            aria-label="Attach images"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            disabled={busy}
            onChange={(e) => {
              void attach(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
        </label>
        <button className="secondary-button" onClick={() => setDrawing(true)}>
          Draw
        </button>
      </div>
      {!preview && (
        <div
          className="note-toolbar format-toolbar"
          aria-label="Markdown formatting"
        >
          {[
            ["Bold", "**", "**"],
            ["Italic", "_", "_"],
            ["Heading", "\n## ", ""],
            ["List", "\n- ", ""],
            ["Checklist", "\n- [ ] ", ""],
            ["Code", "\n```\n", "\n```\n"],
            ["Link", "[", "](https://)"],
          ].map(([label, before, after]) => (
            <button
              key={label}
              className="text-button"
              onClick={() => insert(before, after)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {preview ? (
        <NotePreview text={value} />
      ) : (
        <textarea
          ref={textarea}
          className="description-editor note-source"
          aria-label="Description"
          placeholder="Write Markdown…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            const images = Array.from(e.clipboardData.files).filter((file) =>
              file.type.startsWith("image/"),
            );
            if (images.length) {
              e.preventDefault();
              void attach(images);
            }
          }}
        />
      )}
      {drawing && (
        <Drawing
          noteId={noteId}
          onError={onError}
          onClose={() => setDrawing(false)}
          onSave={async (data) => {
            const id = await storeImage(data, "Drawing.png");
            append(`\n\n![Drawing](attachment:${id})\n`);
          }}
        />
      )}
      <button
        className="text-button"
        onClick={async () => {
          try {
            const files: Record<string, Uint8Array> = {};
            let text = current.current.value;
            for (const id of attachmentIds(text)) {
              const image = await getAttachment(id);
              const [, type, data] = image.data_url.match(
                /^data:image\/(\w+);base64,(.*)$/,
              )!;
              const path = `images/${id}.${type === "jpeg" ? "jpg" : type}`;
              files[path] = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
              text = text.replaceAll("attachment:" + id, path);
            }
            files["note.md"] = strToU8(text);
            const packed = zipSync(files);
            const url = URL.createObjectURL(
              new Blob([packed as BlobPart], { type: "application/zip" }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = "listflow-note.zip";
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
          } catch (error) {
            onError(String(error));
          }
        }}
      >
        Export Markdown with images
      </button>
    </div>
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
