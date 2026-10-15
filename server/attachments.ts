import type { Router, RequestHandler } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Store } from "./store";
const attachment = z.object({
  id: z.string().uuid(),
  name: z.string().max(200),
  data_url: z.string().max(1_450_000),
});
export function attachmentRoutes(
  router: Router,
  store: Store,
  writer: RequestHandler,
) {
  router.put("/api/attachments/:id", writer, (req, res) => {
    try {
      const value = attachment.parse(req.body);
      if (req.params.id !== value.id) throw new Error("Attachment ID mismatch");
      const match = value.data_url.match(
        /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/,
      );
      if (!match) throw new Error("Use a PNG, JPEG, WebP or GIF image");
      const bytes = Buffer.from(match[2], "base64");
      if (!bytes.length || bytes.length > 1024 * 1024)
        throw new Error("Images must be no larger than 1 MB after resizing");
      const valid =
        match[1] === "image/png"
          ? bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
          : match[1] === "image/jpeg"
            ? bytes.subarray(0, 3).toString("hex") === "ffd8ff"
            : match[1] === "image/gif"
              ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())
              : bytes.subarray(0, 4).toString() === "RIFF" &&
                bytes.subarray(8, 12).toString() === "WEBP";
      if (!valid)
        throw new Error("The image content does not match its format");
      const digest = createHash("sha256").update(bytes).digest("hex");
      const prior = store.db
        .prepare("SELECT value FROM attachments WHERE id=?")
        .get(value.id) as { value: string } | undefined;
      if (prior && JSON.parse(prior.value).sha256 !== digest) {
        res
          .status(409)
          .json({ error: "An attachment ID cannot be overwritten" });
        return;
      }
      if (!prior)
        store.db.prepare("INSERT INTO attachments VALUES (?,?)").run(
          value.id,
          JSON.stringify({
            ...value,
            mime: match[1],
            sha256: digest,
            created_at: new Date().toISOString(),
          }),
        );
      res.json({ id: value.id, sha256: digest });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Invalid image",
      });
    }
  });
  router.get("/api/attachments/:id", (req, res) => {
    const row = store.db
      .prepare("SELECT value FROM attachments WHERE id=?")
      .get(String(req.params.id)) as { value: string } | undefined;
    if (!row) {
      res.status(404).json({ error: "Image not found" });
      return;
    }
    res
      .set("Cache-Control", "private, max-age=3600")
      .json(JSON.parse(row.value));
  });
}
