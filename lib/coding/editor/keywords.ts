// Completion tier 1 for the languages highlighted through legacy modes (section 4.3): keywords
// and a few snippets. JavaScript, TypeScript, Python, SQL, HTML and CSS bring their own from
// their CodeMirror language packages.
import type { EditorMode } from "../languages";

const words = (text: string) => text.split(/\s+/).filter(Boolean);

export const KEYWORDS: Partial<Record<EditorMode, string[]>> = {
  csharp: words(`abstract as base bool break byte case catch char checked class const continue
    decimal default delegate do double else enum event explicit extern false finally fixed float
    for foreach goto if implicit in int interface internal is lock long namespace new null object
    operator out override params private protected public readonly ref return sbyte sealed short
    sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked
    unsafe ushort using var virtual void volatile while async await record init required
    Console WriteLine ReadLine List Dictionary Math`),
  java: words(`abstract assert boolean break byte case catch char class const continue default do
    double else enum extends final finally float for if implements import instanceof int interface
    long native new null package private protected public return short static strictfp super
    switch synchronized this throw throws transient try var void volatile while true false record
    String System out println Math ArrayList HashMap List Map Scanner`),
  kotlin: words(`as break class continue do else false for fun if in interface is null object
    package return super this throw true try typealias val var when while by catch constructor
    data enum finally get import init lateinit open override private protected public sealed set
    suspend println readLine listOf mutableListOf mapOf String Int Double Boolean`),
  c: words(`auto break case char const continue default do double else enum extern float for goto
    if inline int long register restrict return short signed sizeof static struct switch typedef
    union unsigned void volatile while bool true false NULL printf scanf malloc free include
    define stdio stdlib string`),
  cpp: words(`alignas auto bool break case catch char class const constexpr continue default
    delete do double else enum explicit extern false float for friend if inline int long mutable
    namespace new noexcept nullptr operator private protected public return short signed sizeof
    static struct switch template this throw true try typedef typename union unsigned using virtual
    void volatile while std cout cin endl string vector map include`),
  go: words(`break case chan const continue default defer else fallthrough for func go goto if
    import interface map package range return select struct switch type var true false nil
    fmt Println Printf append len make string int float64 bool error`),
  rust: words(`as async await break const continue crate else enum extern false fn for if impl in
    let loop match mod move mut pub ref return self Self static struct super trait true type
    unsafe use where while println print vec Vec String Option Some None Result Ok Err`),
  ruby: words(`alias and begin break case class def defined do else elsif end ensure false for if
    in module next nil not or redo rescue retry return self super then true undef unless until when
    while yield puts print gets require attr_accessor`),
  bash: words(`if then else elif fi case esac for while until do done in function select time
    echo read printf local export return exit source test true false`),
};

/** A few snippets per language, written with ${} placeholders (CodeMirror snippet syntax). */
export const SNIPPETS: Partial<Record<EditorMode, [label: string, template: string][]>> = {
  csharp: [
    ["for", "for (int ${i} = 0; ${i} < ${n}; ${i}++)\n{\n\t${}\n}"],
    ["if", "if (${condition})\n{\n\t${}\n}"],
    ["cw", "Console.WriteLine(${});"],
  ],
  java: [
    ["for", "for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}"],
    ["if", "if (${condition}) {\n\t${}\n}"],
    ["sout", "System.out.println(${});"],
  ],
  kotlin: [
    ["for", "for (${item} in ${items}) {\n\t${}\n}"],
    ["fun", "fun ${name}(${}) {\n\t\n}"],
  ],
  c: [
    ["for", "for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}"],
    ["printf", 'printf("${}\\n");'],
  ],
  cpp: [
    ["for", "for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}"],
    ["cout", "std::cout << ${} << std::endl;"],
  ],
  go: [
    ["for", "for ${i} := 0; ${i} < ${n}; ${i}++ {\n\t${}\n}"],
    ["func", "func ${name}(${}) {\n\t\n}"],
  ],
  rust: [
    ["for", "for ${item} in ${items} {\n\t${}\n}"],
    ["fn", "fn ${name}(${}) {\n\t\n}"],
  ],
  ruby: [["def", "def ${name}\n\t${}\nend"]],
  bash: [["for", "for ${item} in ${items}; do\n\t${}\ndone"]],
};
