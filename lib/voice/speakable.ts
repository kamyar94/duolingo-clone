// Turns the text shown on screen into text a voice can read: LaTeX between dollar signs is
// spoken as words ("x squared", "a over b"), Markdown marks are dropped and white space is
// collapsed. The result is also the cache key of a clip, so the same wording always gives the
// same audio file.

const GREEK: Record<string, string> = {
  alpha: "alpha", beta: "beta", gamma: "gamma", delta: "delta", epsilon: "epsilon", varepsilon: "epsilon",
  zeta: "zeta", eta: "eta", theta: "theta", vartheta: "theta", iota: "iota", kappa: "kappa", lambda: "lambda",
  mu: "mu", nu: "nu", xi: "xi", pi: "pi", rho: "rho", sigma: "sigma", tau: "tau", upsilon: "upsilon",
  phi: "phi", varphi: "phi", chi: "chi", psi: "psi", omega: "omega", Delta: "delta", Gamma: "gamma",
  Theta: "theta", Lambda: "lambda", Pi: "pi", Sigma: "sigma", Phi: "phi", Psi: "psi", Omega: "omega",
};

const WORDS: Record<string, string> = {
  cdot: "times", times: "times", div: "divided by", pm: "plus or minus", mp: "minus or plus",
  le: "less than or equal to", leq: "less than or equal to", ge: "greater than or equal to",
  geq: "greater than or equal to", ne: "not equal to", neq: "not equal to", approx: "approximately",
  equiv: "is equivalent to", to: "approaches", rightarrow: "gives", Rightarrow: "implies",
  infty: "infinity", int: "the integral of", sum: "the sum of", prod: "the product of",
  lim: "the limit of", sin: "sine", cos: "cosine", tan: "tangent", log: "log", ln: "natural log",
  exp: "e to the", angle: "angle", circ: "degrees", degree: "degrees", perp: "is perpendicular to",
  parallel: "is parallel to", triangle: "triangle", partial: "partial", nabla: "nabla", in: "in",
  cup: "union", cap: "intersection", subset: "is a subset of", forall: "for all", exists: "there exists",
  ldots: "and so on", dots: "and so on", cdots: "and so on", sqrt: "square root of",
};

const SPACING = /\\(?:left|right|big|Big|bigg|Bigg|displaystyle|textstyle|limits|,|;|:|!|quad|qquad| )/g;

/** Spoken form of one LaTeX formula. Best effort: unknown commands are read by name. */
export const speakLatex = (tex: string): string => {
  let s = ` ${tex} `.replace(SPACING, " ");

  // Commands with arguments, innermost first; a few passes cover nesting.
  for (let pass = 0; pass < 8; pass++) {
    const before = s;
    s = s
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, " $1 over $2 ")
      .replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, " root $1 of $2 ")
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, " square root of $1 ")
      .replace(
        /\\(?:text|mathrm|operatorname|mathbf|mathit|textbf|mathbb|mathcal|boldsymbol|vec|overline|bar|hat)\s*\{([^{}]*)\}/g,
        (_, inner: string) => ` ${inner.replace(/\//g, " per ")} `
      )
      .replace(/\^\s*\{\s*2\s*\}|\^\s*2(?![0-9])/g, " squared ")
      .replace(/\^\s*\{\s*3\s*\}|\^\s*3(?![0-9])/g, " cubed ")
      .replace(/\^\s*\{\s*-\s*1\s*\}/g, " to the minus one ")
      .replace(/\^\s*\{([^{}]*)\}/g, " to the power $1 ")
      .replace(/\^\s*([A-Za-z0-9])/g, " to the power $1 ")
      .replace(/_\s*\{([^{}]*)\}/g, " sub $1 ")
      .replace(/_\s*([A-Za-z0-9])/g, " sub $1 ");
    if (s === before) break;
  }

  s = s
    .replace(/\\%/g, " percent ")
    .replace(/\\([A-Za-z]+)/g, (_, name: string) => ` ${GREEK[name] ?? WORDS[name] ?? name} `)
    .replace(/\\\\/g, " ")
    .replace(/\\(.)/g, " $1 ")
    .replace(/[{}]/g, " ")
    .replace(/\s*=\s*/g, " equals ")
    .replace(/\+/g, " plus ")
    .replace(/(?<=[A-Za-z0-9)}\s])-(?=\s*[A-Za-z0-9(\\])/g, " minus ")
    .replace(/</g, " is less than ")
    .replace(/>/g, " is greater than ")
    .replace(/\//g, " over ")
    .replace(/\*/g, " times ")
    .replace(/~/g, " ");

  return s.replace(/\s+/g, " ").trim();
};

/** Text as it is shown on screen to text as it is spoken. */
export const speakable = (text: string): string => {
  let s = text
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => ` ${speakLatex(tex)} `)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex: string) => ` ${speakLatex(tex)} `)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, tex: string) => ` ${speakLatex(tex)} `)
    .replace(/\$([^$\n]+?)\$/g, (_, tex: string) => ` ${speakLatex(tex)} `);

  s = s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$|[.,;:!?])/g, "$1$2")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "");

  // A formula leaves a space before the punctuation that followed it.
  return s.replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
};
