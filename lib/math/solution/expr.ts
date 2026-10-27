// A small, safe parser for the functions of graph items: y as a function of x, written like
// "0.5*x^2 - 3", "2x + 1", "sin(x)/x" or "sqrt(9 - x^2)". It knows numbers, x, pi and e, the
// operators + - * / ^, implicit multiplication ("2x", "3(x+1)") and a fixed list of functions.
// Nothing is evaluated with eval or Function, so a script can never run code.

type Node = (x: number) => number;

const FUNCTIONS: Record<string, (value: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  floor: Math.floor,
  ceil: Math.ceil,
  sign: Math.sign,
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

export const MAX_EXPRESSION = 200;

type Token =
  | { kind: "num"; value: number }
  | { kind: "name"; value: string }
  | { kind: "op"; value: string };

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    const number = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(source.slice(i));
    if (number) {
      tokens.push({ kind: "num", value: Number(number[0]) });
      i += number[0].length;
      continue;
    }
    const name = /^[A-Za-z]+/.exec(source.slice(i));
    if (name) {
      tokens.push({ kind: "name", value: name[0].toLowerCase() });
      i += name[0].length;
      continue;
    }
    if ("+-*/^()".includes(char)) {
      tokens.push({ kind: "op", value: char });
      i += 1;
      continue;
    }
    throw new Error(`Unexpected "${char}" in the function.`);
  }
  return tokens;
};

/** Compiles an expression in x. Throws an Error with a readable sentence when it is not valid. */
export const compileExpression = (source: string): Node => {
  if (typeof source !== "string" || !source.trim()) throw new Error("The function is empty.");
  if (source.length > MAX_EXPRESSION)
    throw new Error(`A function may have at most ${MAX_EXPRESSION} characters.`);
  const tokens = tokenize(source);
  let at = 0;
  let depth = 0;
  const peek = () => tokens[at];
  const isOp = (value: string) => peek()?.kind === "op" && peek()?.value === value;

  const expression = (): Node => {
    let left = term();
    while (isOp("+") || isOp("-")) {
      const op = tokens[at++].value;
      const right = term();
      const l = left;
      left = op === "+" ? (x) => l(x) + right(x) : (x) => l(x) - right(x);
    }
    return left;
  };

  // A token that can start a factor directly after another one: implicit multiplication.
  const startsFactor = () => {
    const token = peek();
    if (!token) return false;
    return token.kind === "num" || token.kind === "name" || (token.kind === "op" && token.value === "(");
  };

  const term = (): Node => {
    let left = unary();
    for (;;) {
      if (isOp("*") || isOp("/")) {
        const op = tokens[at++].value;
        const right = unary();
        const l = left;
        left = op === "*" ? (x) => l(x) * right(x) : (x) => l(x) / right(x);
      } else if (startsFactor()) {
        const right = power();
        const l = left;
        left = (x) => l(x) * right(x);
      } else return left;
    }
  };

  const unary = (): Node => {
    if (isOp("-")) {
      at++;
      const inner = unary();
      return (x) => -inner(x);
    }
    if (isOp("+")) {
      at++;
      return unary();
    }
    return power();
  };

  const power = (): Node => {
    const base = primary();
    if (isOp("^")) {
      at++;
      const exponent = unary();
      return (x) => Math.pow(base(x), exponent(x));
    }
    return base;
  };

  const primary = (): Node => {
    const token = tokens[at++];
    if (!token) throw new Error("The function ends too early.");
    if (token.kind === "num") {
      const value = token.value;
      return () => value;
    }
    if (token.kind === "name") {
      if (token.value === "x") return (x) => x;
      if (Object.hasOwn(CONSTANTS, token.value)) {
        const value = CONSTANTS[token.value];
        return () => value;
      }
      const fn = Object.hasOwn(FUNCTIONS, token.value) ? FUNCTIONS[token.value] : undefined;
      if (!fn) throw new Error(`Unknown name "${token.value}" in the function; use x.`);
      if (!isOp("(")) throw new Error(`Write ${token.value}(...) with brackets.`);
      const argument = primary();
      return (x) => fn(argument(x));
    }
    if (token.value === "(") {
      depth += 1;
      if (depth > 50) throw new Error("The function is nested too deeply.");
      const inner = expression();
      if (!isOp(")")) throw new Error("A bracket is not closed.");
      at++;
      depth -= 1;
      return inner;
    }
    throw new Error(`Unexpected "${token.value}" in the function.`);
  };

  const node = expression();
  if (at < tokens.length) throw new Error(`Unexpected "${String(tokens[at].value)}" in the function.`);
  return node;
};

/** The problem with an expression as a sentence, or null when it compiles. */
export const expressionProblem = (source: string): string | null => {
  try {
    compileExpression(source);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "The function is not valid.";
  }
};

/** Evaluates safely: a compiled function, or one that always returns NaN. */
export const safeFunction = (source: string): Node => {
  try {
    return compileExpression(source);
  } catch {
    return () => Number.NaN;
  }
};
