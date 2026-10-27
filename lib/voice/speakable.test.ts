import { describe, expect, it } from "vitest";

import { speakable, speakLatex } from "./speakable";

describe("speakLatex", () => {
  it("reads fractions, powers and roots", () => {
    expect(speakLatex("t = \\frac{d}{v}")).toBe("t equals d over v");
    expect(speakLatex("x^2 + y^3")).toBe("x squared plus y cubed");
    expect(speakLatex("\\sqrt{a^2 + b^2}")).toBe("square root of a squared plus b squared");
    expect(speakLatex("a_{n+1}")).toBe("a sub n plus 1");
  });

  it("reads units, symbols and subtraction", () => {
    expect(speakLatex("120\\,\\mathrm{m} \\cdot 3")).toBe("120 m times 3");
    expect(speakLatex("12\\,\\mathrm{m/s}")).toBe("12 m per s");
    expect(speakLatex("\\theta \\le \\pi")).toBe("theta less than or equal to pi");
    expect(speakLatex("5 - 3")).toBe("5 minus 3");
    expect(speakLatex("t = \\frac{120\\ \\text{m}}{12\\ \\text{m/s}} = 10\\ \\text{s}")).toContain(
      "120 m over 12 m per s"
    );
  });
});

describe("speakable", () => {
  it("speaks the formulas inside a sentence", () => {
    const spoken = speakable("$120/12$ is $10$, not $12$.");
    expect(spoken).toContain("120 over 12");
    expect(spoken).not.toContain("$");
    expect(speakable("Use $$v = \\frac{d}{t}$$ here.")).toBe("Use v equals d over t here.");
  });

  it("drops Markdown marks and code fences", () => {
    expect(speakable("**Careful:** check the *sign*.\n\n- first\n- second")).toBe(
      "Careful: check the sign. first second"
    );
    expect(speakable("Run `npm test` now.")).toBe("Run npm test now.");
    expect(speakable("```js\nconst a = 1;\n```\nDone.")).toBe("Done.");
    expect(speakable("See [the guide](https://example.com/guide).")).toBe("See the guide.");
  });

  it("returns an empty string for text with nothing to say", () => {
    expect(speakable("  \n ")).toBe("");
    expect(speakable("```\ncode only\n```")).toBe("");
  });

  it("gives the same words for the same wording, which keeps cache keys stable", () => {
    expect(speakable("a  b\n c")).toBe(speakable("a b c"));
  });
});
