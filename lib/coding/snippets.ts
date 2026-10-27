// Rules for programs saved in the playground (code_snippets): which files a program of each
// language has, and the limits on names, sizes and counts. Shared by the server actions and the
// playground page.
import { CODE_LANGUAGES, isCodeLanguage, WEB_FILES, type CodeLanguage } from "./languages";

export const MAX_SNIPPETS = 200;
export const MAX_SNIPPET_BYTES = 256 * 1024;
export const MAX_NAME_LENGTH = 80;

export type SnippetFiles = Record<string, string>;

/** The file names a program of this language consists of. */
export const snippetFileNames = (language: CodeLanguage): readonly string[] =>
  language === "web" ? WEB_FILES : [CODE_LANGUAGES[language].file];

export const snippetName = (name: string) =>
  (name ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH) || "Untitled";

/** A problem with a program to save, or null when it is fine. */
export const checkSnippet = (language: unknown, files: unknown): string | null => {
  if (!isCodeLanguage(language)) return "Unknown language.";
  if (typeof files !== "object" || files === null || Array.isArray(files))
    return "The program must be a set of files.";
  const allowed = snippetFileNames(language);
  const entries = Object.entries(files);
  if (!entries.length) return "The program has no files.";
  for (const [name, text] of entries) {
    if (!allowed.includes(name)) return `A ${CODE_LANGUAGES[language].label} program has no file ${name}.`;
    if (typeof text !== "string") return `${name} must be text.`;
  }
  const size = new TextEncoder().encode(JSON.stringify(files)).length;
  if (size > MAX_SNIPPET_BYTES)
    return `The program is ${Math.ceil(size / 1024)} KB; the limit is ${MAX_SNIPPET_BYTES / 1024} KB.`;
  return null;
};
