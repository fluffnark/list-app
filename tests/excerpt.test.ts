import { expect, it } from "vitest";
import { markdownExcerpt } from "../shared/model";
it("strips Markdown syntax from note excerpts", () => {
  expect(
    markdownExcerpt(
      "# Heading\n\nSome **markdown** text, _emphasis_ and a [link](https://x.y).",
    ),
  ).toBe("Heading Some markdown text, emphasis and a link.");
  expect(
    markdownExcerpt("- [ ] buy milk\n- [x] eggs\n> quote\n1. `code`"),
  ).toBe("buy milk eggs quote code");
  expect(markdownExcerpt("![doodle](attachment:abc) snake_case_name")).toBe(
    "doodle snake_case_name",
  );
  expect(markdownExcerpt("a".repeat(50), 10)).toBe("aaaaaaaaa…");
});
