import React, { useEffect, useRef, useState } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { zipSync, strToU8 } from "fflate";
import { attachmentIds, getAttachment } from "./db";
import { AssetImage, importImage, storeImage } from "./assets";

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
