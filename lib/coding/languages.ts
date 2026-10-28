// Languages of the coding lessons and the playground, and where each one runs. Plain data: the
// course import script, server actions and client components all read it.

export type Runtime = "js" | "python" | "sql" | "web" | "server";

export type LanguageInfo = {
  label: string;
  /** File name used for the single file of a program in this language. */
  file: string;
  /** Where the program runs: a browser runtime, or a code runner on the server (runners/). */
  runtime: Runtime;
  /** Function tests (`call`) are supported. */
  functionTests: boolean;
};

export const CODE_LANGUAGES = {
  javascript: { label: "JavaScript", file: "main.js", runtime: "js", functionTests: true },
  typescript: { label: "TypeScript", file: "main.ts", runtime: "js", functionTests: true },
  python: { label: "Python", file: "main.py", runtime: "python", functionTests: true },
  sql: { label: "SQL", file: "main.sql", runtime: "sql", functionTests: false },
  web: { label: "HTML, CSS and JavaScript", file: "index.html", runtime: "web", functionTests: false },
  csharp: { label: "C#", file: "Program.cs", runtime: "server", functionTests: false },
  java: { label: "Java", file: "Main.java", runtime: "server", functionTests: false },
  kotlin: { label: "Kotlin", file: "Main.kt", runtime: "server", functionTests: false },
  c: { label: "C", file: "main.c", runtime: "server", functionTests: false },
  cpp: { label: "C++", file: "main.cpp", runtime: "server", functionTests: false },
  go: { label: "Go", file: "main.go", runtime: "server", functionTests: false },
  rust: { label: "Rust", file: "main.rs", runtime: "server", functionTests: false },
  ruby: { label: "Ruby", file: "main.rb", runtime: "server", functionTests: false },
  php: { label: "PHP", file: "main.php", runtime: "server", functionTests: false },
  perl: { label: "Perl", file: "main.pl", runtime: "server", functionTests: false },
  lua: { label: "Lua", file: "main.lua", runtime: "server", functionTests: false },
  bash: { label: "Bash", file: "main.sh", runtime: "server", functionTests: false },
} as const satisfies Record<string, LanguageInfo>;

export type CodeLanguage = keyof typeof CODE_LANGUAGES;

export const LANGUAGE_IDS = Object.keys(CODE_LANGUAGES) as CodeLanguage[];

export const isCodeLanguage = (value: unknown): value is CodeLanguage =>
  typeof value === "string" && Object.hasOwn(CODE_LANGUAGES, value);

export const languageInfo = (language: CodeLanguage): LanguageInfo =>
  CODE_LANGUAGES[language];

export const runsInBrowser = (language: CodeLanguage) =>
  CODE_LANGUAGES[language].runtime !== "server";

/** The three files of a web program (WEB_LIVE and web programs in the playground). */
export const WEB_FILES = ["index.html", "style.css", "script.js"] as const;
export type WebFile = (typeof WEB_FILES)[number];

/** Editor modes. A web program is edited as three files with their own modes. */
export type EditorMode = Exclude<CodeLanguage, "web"> | "html" | "css";

export const modeForWebFile = (file: WebFile): EditorMode =>
  file === "index.html" ? "html" : file === "style.css" ? "css" : "javascript";

/** A short starter program for the playground. */
export const STARTERS: Partial<Record<CodeLanguage, string>> = {
  javascript: 'const name = "world";\nconsole.log(`Hello, ${name}!`);\n',
  typescript:
    'function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet("world"));\n',
  python: 'name = "world"\nprint(f"Hello, {name}!")\n',
  sql: "CREATE TABLE pets (name TEXT, kind TEXT);\nINSERT INTO pets VALUES ('Rocket', 'dog'), ('Pebble', 'cat');\n\nSELECT name, kind FROM pets ORDER BY name;\n",
  csharp:
    'using System;\n\nclass Program\n{\n    static void Main()\n    {\n        Console.WriteLine("Hello, world!");\n    }\n}\n',
  java: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, world!");\n    }\n}\n',
  kotlin: 'fun main() {\n    println("Hello, world!")\n}\n',
  c: '#include <stdio.h>\n\nint main(void) {\n    printf("Hello, world!\\n");\n    return 0;\n}\n',
  cpp: '#include <iostream>\n\nint main() {\n    std::cout << "Hello, world!" << std::endl;\n    return 0;\n}\n',
  go: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, world!")\n}\n',
  rust: 'fn main() {\n    println!("Hello, world!");\n}\n',
  ruby: 'puts "Hello, world!"\n',
  php: '<?php\n\necho "Hello, world!\\n";\n',
  perl: 'use strict;\nuse warnings;\n\nprint "Hello, world!\\n";\n',
  lua: 'print("Hello, world!")\n',
  bash: 'echo "Hello, world!"\n',
};

export const WEB_STARTER: Record<WebFile, string> = {
  "index.html":
    '<h1>Hello!</h1>\n<p>Edit the HTML, CSS and JavaScript tabs.</p>\n<button id="go">Click me</button>\n',
  "style.css":
    "body {\n  font-family: sans-serif;\n  padding: 1rem;\n}\n\nh1 {\n  color: rebeccapurple;\n}\n",
  "script.js":
    'document.getElementById("go").addEventListener("click", () => {\n  console.log("clicked");\n});\n',
};
