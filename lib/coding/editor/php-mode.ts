// PHP highlighting for the editor. @codemirror/legacy-modes has no PHP mode, so this one is built
// on its C-like mode with PHP's words, $variables, # comments and the <?php tag, the way
// CodeMirror 5 highlighted PHP code.
import type { StreamParser, StringStream } from "@codemirror/language";
import { clike } from "@codemirror/legacy-modes/mode/clike";

const set = (text: string) =>
  Object.fromEntries(
    text
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => [word, true])
  );

export const phpMode = () =>
  clike({
    name: "php",
    keywords: set(`abstract and as break callable case catch class clone const continue declare
      default do else elseif enddeclare endfor endforeach endif endswitch endwhile enum extends
      final finally fn for foreach function global goto if implements include include_once
      instanceof insteadof interface match namespace new or private protected public readonly
      require require_once return static switch throw trait try use var while xor yield`),
    blockKeywords: set("catch do else elseif finally for foreach if switch try while"),
    atoms: set(`true false null TRUE FALSE NULL PHP_EOL __CLASS__ __DIR__ __FILE__ __FUNCTION__
      __LINE__ __METHOD__ __NAMESPACE__`),
    builtin: set(`array echo empty isset list print unset count strlen str_repeat implode explode
      array_map array_filter array_keys array_values in_array sort printf sprintf fgets trim
      intval floatval json_encode`),
    multiLineStrings: true,
    hooks: {
      $: (stream: StringStream) => {
        stream.eatWhile(/[\w$]/);
        return "variable-2";
      },
      "#": (stream: StringStream) => {
        stream.skipToEnd();
        return "comment";
      },
      "<": (stream: StringStream) => (stream.match("?php") ? "meta" : false),
      "?": (stream: StringStream) => (stream.eat(">") ? "meta" : false),
    },
  }) as StreamParser<unknown>;
