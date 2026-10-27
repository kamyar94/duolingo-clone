# Course files

A course file is a JSON document that the server tool turns into a course with units, lessons and challenges. `SELF-HOSTED.md` explains the basic format with multiple-choice questions and the commands that check, import and update files. This document covers what coding lessons and math practice add to it. That is the `payload` of each new challenge type, the answer of a math problem and the animated solution script that a math problem can carry. It also describes the example courses in `courses/examples`, which are meant to be read, copied and changed.

Every example in this document is taken from those files, except the short script in the section on animated solutions, which went through the same validator. The files were checked in two ways. The `check` command accepts all of them, and each reference solution was run, in the browser runtimes or in the code runner containers, and passed all of its tests while its starter program failed at least one. The answers of the math problems went through the same answer check that grades learners, with right and wrong answers for each problem.

## The example courses

The example courses are original and use no outside material, so they can be published with the fork. They cover the three new kinds of content. The math course has five units with 27 problems in all and 15 animated solutions, at least two in every unit. Four browser courses teach Python, JavaScript, SQL and web pages. Twelve short courses, one per server language, show how the same ideas look in compiled and scripting languages.

| File | Course title | Size | What it shows |
|---|---|---|---|
| `math-problem-sets.json` | Math problem sets (example) | 5 units, 10 lessons, 27 problems | Algebra, geometry, calculus, probability and statistics, and physics word problems with numeric answers (some with units), expressions, single and multiple choice, free-form worked solutions and animated solutions |
| `python-basics.json` | Python basics (example) | 2 lessons, 12 exercises | All six program exercise types in both lessons, with input and output tests, function tests and a regular expression test |
| `javascript-basics.json` | JavaScript basics (example) | 2 lessons, 12 exercises | The same types with function tests, hidden tests and a syntax error to repair |
| `sql-basics.json` | SQL basics (example) | 2 lessons, 12 exercises | Row tests, a check query that guards the table and two tables with a join |
| `web-basics.json` | Web basics (example) | 2 lessons, 9 exercises | Page checks on structure, text, attributes and computed styles, and a script that changes the page |
| `csharp-basics.json`, `java-basics.json`, `kotlin-basics.json`, `c-basics.json`, `cpp-basics.json`, `go-basics.json`, `rust-basics.json`, `ruby-basics.json`, `php-basics.json`, `perl-basics.json`, `lua-basics.json`, `bash-basics.json` | One course per language, for example C# basics (example) | 1 lesson, 6 exercises each | The six program exercise types with input and output tests, run in the code runner containers |

The web course cannot use the six program types, because their payloads name a programming language and HTML and CSS are not one. Its exercises are all of the type `WEB_LIVE`, which is the type for pages.

The examples are not imported automatically. Inside the container they are in `/app/courses/examples`, so a course is checked and added with these commands.

```text
docker compose exec app node scripts/lingo.mjs check courses/examples/python-basics.json
docker compose exec app node scripts/lingo.mjs import courses/examples/python-basics.json
```

Course titles must be unique, so `import` refuses a file whose title exists already. Change the title in a copy when you want a second version. The server language courses open without the code runners, but Run and Check then say that the language cannot run on this server, and nothing costs a heart. Start the runners that a course needs first, as `deploy/README.md` describes.

## Coding challenges

A coding challenge has one of the types `CODE_READ`, `CODE_OUTPUT`, `CODE_FILL`, `CODE_ORDER`, `CODE_WRITE`, `CODE_FIX` or `WEB_LIVE`. Its `question` is the task in plain text. The `hint` and the `explanation` work as they do for other challenges and are plain text as well, so write formulas in them with ordinary characters. Everything the exercise needs goes into `payload`. The importer refuses unknown fields, which turns a misspelt name into a message from the `check` command.

Every program type names its `language` in the payload. The languages are `python`, `javascript`, `typescript`, `sql`, `csharp`, `java`, `kotlin`, `c`, `cpp`, `go`, `rust`, `ruby`, `php`, `perl`, `lua` and `bash`. The optional `timeLimitMs` is the longest time of one run in milliseconds (3000 by default and 20000 at most). SQL exercises add `setup`, the statements that create and fill the tables, which run in a fresh in-memory database before every run. An optional `solution` holds a reference answer for authors. It stays on the server and is never sent to the browser.

### Reading and predicting

A `CODE_READ` exercise shows an explanation and a program that the learner can run and change. Pressing Check just moves on, so it is the right type for introducing an idea.

```json
{
  "type": "CODE_READ",
  "question": "Your first Python program",
  "explanation": "print() writes a line to the console, and a variable keeps a value under a name so you can use it again.",
  "payload": {
    "language": "python",
    "text": "`print()` shows values in the console, and a variable is a name for a value.\n\nPress Run, then change the place and run it again.",
    "code": "place = \"Rome\"\nprint(\"Hello,\", place)\nprint(\"2 + 3 =\", 2 + 3)\n"
  }
}
```

A `CODE_OUTPUT` exercise asks what a program prints. With `choices`, which must include the expected text, the learner picks an answer, and without them the learner types it. Choices may span several lines, which is useful for the result of a query. Run is locked until the answer is checked, because running the program would give it away.

```json
{
  "type": "CODE_OUTPUT",
  "question": "What does this program print?",
  "hint": "Multiplication is done before subtraction.",
  "explanation": "a * b is 12, and 12 - 2 is 10.",
  "payload": {
    "language": "python",
    "code": "a = 4\nb = 3\nprint(a * b - 2)\n",
    "expect": "10",
    "choices": ["10", "12", "14", "7"]
  }
}
```

### Filling blanks and ordering lines

A `CODE_FILL` exercise has a `template` in which each blank is three underscores that do not belong to a longer word, so `__init__` is not a blank. The learner taps chips or types. `answers` lists the accepted text of each blank, a list when several texts are fine, and `distractors` adds chips that fit nowhere. There are two ways to decide whether the exercise is solved. With `tests`, the completed program has to pass them, which also accepts answers that you did not think of. Without `tests`, each blank has to hold one of its accepted answers, which needs no runner and works for every language.

```json
{
  "type": "CODE_FILL",
  "question": "Complete the program so that it prints the total cost, 12.",
  "hint": "The total is the price times the quantity.",
  "explanation": "With a price of 4 and a quantity of 3, the total is 12.",
  "payload": {
    "language": "python",
    "template": "price = ___\nquantity = 3\ntotal = price * ___\nprint(total)\n",
    "answers": ["4", "quantity"],
    "distractors": ["total", "7"],
    "tests": [{ "expect": "12" }]
  }
}
```

```json
{
  "type": "CODE_FILL",
  "question": "Join the words with commas and print them in capital letters.",
  "hint": "One method joins an array into text, and another makes text upper case.",
  "explanation": "join(\", \") gives \"sun, moon, star\", and toUpperCase() makes every letter a capital.",
  "payload": {
    "language": "javascript",
    "template": "const words = [\"sun\", \"moon\", \"star\"];\nconst text = words.___(\", \");\nconsole.log(text.___());\n",
    "answers": ["join", "toUpperCase"],
    "distractors": ["split", "length"]
  }
}
```

The second example has no tests. It is the right choice when only one answer makes sense, such as a method name.

A `CODE_ORDER` exercise lists the `lines` of a program in the right order and shuffles them for the learner. In Python the learner also sets the indentation, because it carries meaning there, and `indent: false` turns that off. In the other languages every line keeps its own indentation. Like fill exercises, order exercises accept `tests` to judge the assembled program instead of comparing the order.

```json
{
  "type": "CODE_ORDER",
  "question": "Put the lines in order so the program prints HELLO!",
  "hint": "The function is defined first, and its body is indented under def.",
  "explanation": "The return line belongs to the function, so it is indented. The call comes last.",
  "payload": {
    "language": "python",
    "lines": ["def shout(word):", "    return word.upper() + \"!\"", "print(shout(\"hello\"))"],
    "tests": [{ "expect": "HELLO!" }]
  }
}
```

### Writing and repairing

`CODE_WRITE` and `CODE_FIX` need `tests` and may have a `starter` program, which `CODE_FIX` requires because it holds the bug. Write the reference `solution` as well. An exercise is only good when the solution passes every test and the starter does not.

```json
{
  "type": "CODE_WRITE",
  "question": "Write a function is_even(n) that returns True when n is even.",
  "hint": "An even number leaves no remainder when divided by 2.",
  "explanation": "n % 2 is the remainder, so n % 2 == 0 is True exactly for even numbers.",
  "payload": {
    "language": "python",
    "starter": "def is_even(n):\n    pass\n",
    "tests": [
      { "call": "is_even(4)", "expect": "True" },
      { "call": "is_even(7)", "expect": "False" },
      { "call": "is_even(0)", "expect": "True", "visible": false }
    ],
    "solution": "def is_even(n):\n    return n % 2 == 0\n"
  }
}
```

```json
{
  "type": "CODE_FIX",
  "question": "The program should print the average of two numbers. Fix it.",
  "hint": "Division is done before addition. Which part has to be added first?",
  "explanation": "a + b / 2 divides only b by 2. Brackets make the sum come first: (a + b) / 2.",
  "payload": {
    "language": "python",
    "starter": "a = int(input())\nb = int(input())\nprint(a + b / 2)\n",
    "tests": [
      {
        "name": "Average of 4 and 10",
        "stdin": "4\n10\n",
        "expect": "^7(\\.0)?$",
        "match": "regex"
      },
      {
        "name": "Average of 6 and 6",
        "stdin": "6\n6\n",
        "expect": "^6(\\.0)?$",
        "match": "regex"
      },
      { "stdin": "1\n2\n", "expect": "^1\\.5$", "match": "regex", "visible": false }
    ],
    "solution": "a = int(input())\nb = int(input())\nprint((a + b) / 2)\n"
  }
}
```

The second example compares the printed result with a regular expression, because Python prints the average of 4 and 10 as `7.0` and a learner who rounds might print `7`.

### Tests

A test is visible unless it says `"visible": false`. Visible tests show the expected and the actual value when they fail, and hidden tests show only whether they passed. Hidden tests keep a learner from writing code that answers the visible cases only, but they are not secret. Checking happens in the browser, so the page data contains them, just as it contains the right option of a multiple-choice question.

There are four kinds of test, told apart by their fields.

```text
{ "stdin": "3\n4\n", "expect": "7", "match": "normalized" }
{ "call": "area(2, 3)", "expect": "6", "visible": false }
{ "query": "SELECT count(*) FROM items", "rows": [[2]] }
{ "selector": "button.buy", "text": "Buy", "style": { "color": "white" } }
```

The first kind feeds `stdin` to the program and compares the printed output with `expect`. The comparison `match` is `normalized` by default, which ignores differences in spaces and blank lines at the ends, `exact`, which ignores only the line ending and one final line break, or `regex`, in which `expect` is a regular expression that is tested against the whole output and in which `^` and `$` match at every line. A test may carry a `name`, which makes the report easier to read.

The second kind calls a function. It exists for JavaScript, TypeScript and Python. `call` is an expression in the language of the program and `expect` is an expression for the expected value. Python compares with `==`, JavaScript compares deeply, and numbers may differ by `tolerance`. All function tests of an exercise share one run of the program.

The third kind belongs to SQL. A test with `rows` compares the last result of the learner's own statements with the rows, in order unless `"ordered": false`, and a test with `expect` compares the printed result, which shows the column names on the first line and the cells of a row separated by a vertical bar. A test with `query` runs a check query after the learner's statements and compares its result. The SQL course uses this to see that a table is still intact, for example with a hidden test on `SELECT COUNT(*) FROM pets`.

The fourth kind belongs to web exercises and is described below.

### Pages

A `WEB_LIVE` exercise gives the learner an HTML, a CSS and a JavaScript tab with a live preview. The payload holds the starting `html`, `css` and `js`, a list of `checks` and optionally `editable`, which names the tabs that the learner may change. A reference `solution` holds all three tabs.

```json
{
  "type": "WEB_LIVE",
  "question": "Turn the words Read more into a link to https://example.org.",
  "hint": "A link is an a element, and its address goes into the href attribute.",
  "explanation": "<a href=\"https://example.org\">Read more</a> shows the words Read more and sends the reader to the address in href.",
  "payload": {
    "html": "<p>Want to know more? Read more</p>\n",
    "css": "",
    "js": "",
    "editable": ["html"],
    "checks": [
      { "name": "One link", "selector": "a", "count": 1 },
      { "name": "The link says Read more", "selector": "a", "text": "Read more" },
      {
        "name": "The link goes to example.org",
        "selector": "a",
        "attr": { "href": "https://example.org" }
      },
      {
        "name": "The question stays in the paragraph",
        "selector": "p",
        "text": "Want to know more?",
        "textMatch": "contains",
        "visible": false
      }
    ],
    "solution": {
      "html": "<p>Want to know more? <a href=\"https://example.org\">Read more</a></p>\n",
      "css": "",
      "js": ""
    }
  }
}
```

A check finds the first element that matches its `selector`. Alone it passes when there is such an element. `count` asks for an exact number of matches, and zero is allowed, which makes sure that something was removed. `text` compares the text of the element, exactly by default, and `textMatch` can be `contains` or `regex`. `attr` compares attributes as written in the HTML, so a link to `https://example.org` is not the same as one to `https://example.org/`. `style` compares computed styles, and a colour may be written by name, so `white` matches `rgb(255, 255, 255)`.

The page's JavaScript runs when the learner presses Run or Check, so a half-typed loop cannot freeze the preview. A check cannot click or type, which means that scripts are best tested by what they put on the page when they start.

### Where programs run

JavaScript, TypeScript, Python, SQL and web exercises run in the learner's browser, and they need nothing on the server. The twelve server languages (C#, Java, Kotlin, C, C++, Go, Rust, Ruby, PHP, Perl, Lua and Bash) run in the code runner containers. They support only input and output tests, because a function test needs a test harness in the language. A server run compiles the program once for all tests of an exercise. The program reads its input from standard input in the way of its language, and the server language examples show the common ways in all twelve.

## Math challenges

A `MATH` challenge shows a statement, an optional figure, a canvas for the work and an answer box. Its `question` is the problem in plain text, and the payload holds everything else. `statement` is the problem with math between dollar signs, typeset with KaTeX. Without it the question is shown. Because a dollar sign starts math, write amounts of money in words. `figure` is an optional picture on this site with `src`, `alt`, and optionally `caption` and `width`. `answer` says how the final answer is checked, and `solution` lists the reference solution as LaTeX lines for the AI grader. The learner's browser never receives the answer, the tolerance or the reference solution.

There are four kinds of answer. The kind `numeric` takes a number or LaTeX that evaluates to one in `value`, a `unit` such as `km`, `m/s`, `m/s^2`, `J` or `deg`, and a `tolerance` or a `relativeTolerance`. Learners may answer in any unit of the same kind, and the answer part after the last equals sign is the one that counts, so `x = 6` and `6` are both read as 6.

```json
{
  "type": "MATH",
  "question": "A taxi charges a fixed fee of 4 dollars plus 2.50 dollars per kilometre. A ride costs 19 dollars. How many kilometres was the ride?",
  "hint": "Write the cost as 4 + 2.5 times the distance, and set it equal to 19.",
  "explanation": "4 + 2.5k = 19 gives 2.5k = 15, so k = 6 kilometres.",
  "payload": {
    "statement": "A taxi charges a fixed fee of $4$ dollars plus $2.50$ dollars for every kilometre. A ride costs $19$ dollars in total. How many kilometres was the ride?",
    "answer": { "kind": "numeric", "value": 6, "unit": "km", "tolerance": 0.01 },
    "solution": ["4 + 2.5k = 19", "2.5k = 15", "k = 6\\,\\mathrm{km}"]
  }
}
```

The kind `expression` takes the expected expression in LaTeX and accepts every equivalent form, so `-15 - 2x + x^2` is as good as `x^2 - 2x - 15`. This also means that the check cannot tell whether a learner expanded a product or only wrote it down again, which is worth remembering when you phrase the problem.

```json
{
  "type": "MATH",
  "question": "Differentiate f(x) = x³ - 6x.",
  "hint": "Use the power rule on each term: the exponent comes down and drops by one.",
  "explanation": "The derivative of x³ is 3x², and the derivative of -6x is -6, so f'(x) = 3x² - 6.",
  "payload": {
    "statement": "Differentiate $f(x) = x^3 - 6x$.",
    "answer": { "kind": "expression", "value": "3x^2-6" },
    "solution": ["f(x) = x^3 - 6x", "f'(x) = 3x^2 - 6"]
  }
}
```

The kind `choice` lists the `choices` as text with math between dollar signs and the index of the right one in `correct`, counted from 0. A list of indexes makes it a multiple-selection question in which all of the right options and no others have to be picked.

```json
{
  "type": "MATH",
  "question": "Which values of x solve x² - 5x + 6 = 0? Pick all that apply.",
  "hint": "Try each value in the equation, or factor the left side.",
  "explanation": "x² - 5x + 6 factors as (x - 2)(x - 3), so the solutions are 2 and 3. For 1 the left side is 2, and for 6 it is 12.",
  "payload": {
    "statement": "Which values of $x$ solve $x^2 - 5x + 6 = 0$? Pick all that apply.",
    "answer": {
      "kind": "choice",
      "choices": ["$x = 1$", "$x = 2$", "$x = 3$", "$x = 6$"],
      "correct": [1, 2]
    },
    "solution": ["x^2 - 5x + 6 = (x-2)(x-3) = 0", "x = 2 \\text{ or } x = 3"]
  }
}
```

The kind `freeform` has no automatic check. The AI grader judges the whole worked solution and is guided by an optional `value` that describes a full answer. It needs a provider key on the learner's account.

```json
{
  "type": "MATH",
  "question": "Explain why the three angles of any triangle add up to 180 degrees.",
  "hint": "Draw a line through one corner that is parallel to the opposite side.",
  "explanation": "The parallel line makes alternate angles equal to the two base angles. Together with the top angle they fill a straight line, which is 180 degrees.",
  "payload": {
    "statement": "Explain why the three angles of any triangle add up to $180^\\circ$. A sketch helps.",
    "answer": {
      "kind": "freeform",
      "value": "A full answer draws a line through one vertex parallel to the opposite side, uses alternate angles to show that the two base angles reappear next to the third angle, and concludes that the three angles fill a straight line of 180 degrees."
    },
    "solution": [
      "\\text{Draw a line through the top corner, parallel to the base.}",
      "\\text{The alternate angles at the two ends equal the two base angles.}",
      "\\alpha + \\beta + \\gamma = 180^\\circ \\text{ (a straight line)}"
    ]
  }
}
```

Give a tolerance whenever learners round. Without one, a numeric answer has to match up to rounding noise. The example for the probability of two dice uses the value `\frac{5}{36}` with a tolerance of 0.001, so that 0.139 and 0.1389 are both right.

## Animated solutions

A math problem can carry an animated solution in `payload.solutionScript`. Import and update store the script as a new version in the table of solutions, but only when it differs from the newest one, and the challenge keeps no copy, so the lesson page never sends a script to a browser. Learners can open the animation after they have checked the problem, and it starts at the step of their mistake.

A script describes a scene and then the steps that change it. The scene has the `question`, cut into spans, the `givens`, the `equations` with their states, and optionally `graphs`, `figures`, `tables` and `notes`. The `steps` follow, each with a `kind`, a `duration` in seconds and an optional `narration`, which is shown as a subtitle and read aloud when voice is set up. The shortest useful script is an equation that is solved in a few steps.

```json
{
  "type": "MATH",
  "question": "Solve 3x + 7 = 25 for x.",
  "payload": {
    "statement": "Solve $3x + 7 = 25$ for $x$.",
    "answer": { "kind": "numeric", "value": 6, "tolerance": 0.001 },
    "solution": ["3x + 7 = 25", "3x = 18", "x = 6"],
    "solutionScript": {
      "format": 1,
      "question": [
        { "text": "Solve " },
        { "id": "q-eq", "text": "$3x + 7 = 25$" },
        { "text": " for " },
        { "id": "q-ask", "text": "$x$" },
        { "text": "." }
      ],
      "givens": [],
      "equations": [
        {
          "id": "lin",
          "states": [
            {
              "id": "start",
              "latex": "\\term{c}{3}\\term{x}{x} \\term{p}{+ 7} \\term{eq}{=} \\term{n}{25}"
            },
            { "id": "mid", "latex": "\\term{c}{3}\\term{x}{x} \\term{eq}{=} \\term{m}{18}" },
            { "id": "done", "latex": "\\term{x}{x} \\term{eq}{=} \\term{res}{6}" }
          ]
        }
      ],
      "steps": [
        {
          "kind": "Relate",
          "equation": "lin",
          "state": "start",
          "duration": 4,
          "narration": "Three x plus seven equals twenty-five."
        },
        {
          "kind": "Transform",
          "equation": "lin",
          "to": "mid",
          "duration": 3.5,
          "narration": "Subtract 7 from both sides."
        },
        {
          "kind": "Transform",
          "equation": "lin",
          "to": "done",
          "duration": 3.5,
          "narration": "Divide both sides by 3."
        },
        {
          "kind": "Answer",
          "equation": "lin",
          "term": "res",
          "span": "q-ask",
          "text": "x = 6",
          "duration": 3
        }
      ]
    }
  }
}
```

The `question` of the script repeats the statement, cut into spans so that a span with an `id` can light up and fly into a given. The examples build the `statement` of the payload from these spans, which keeps the two equal. An equation is a list of states, and each state is LaTeX in which terms are tagged as `\term{id}{...}`. When the same id appears in two consecutive states, the term moves from its old place to its new one. Terms with an id that is new fade in and terms that are gone fade out. Reuse an id only when the content is the same, and give a changed term a new id, as the example does for `n` and `m`. When two terms should be followed although their ids differ, a `Transform` or `Substitute` step can list `links` of the form `["from", "to"]`.

The eight kinds of step are `Extract`, `Relate`, `Substitute`, `Transform`, `Plot`, `Construct`, `Annotate` and `Answer`. `Extract` lifts a span of the question into a given. `Relate` shows an equation, and the givens that it lists fly into the terms that have the same id as the given. `Transform` changes the equation to another state. `Substitute` does the same and flies the value of each given in `pairs` into the named term. An equation has to be shown by a `Relate` step before it can be transformed. The next script has givens with units and shows all three.

```json
{
  "type": "MATH",
  "question": "A car starts from rest and speeds up at 2.5 m/s² for 8 s. How fast is it going then?",
  "payload": {
    "statement": "A car starts from rest and speeds up at $2.5\\,\\mathrm{m/s^2}$ for $8\\,\\mathrm{s}$. How fast is it going then?",
    "answer": { "kind": "numeric", "value": 20, "unit": "m/s", "tolerance": 0.01 },
    "solutionScript": {
      "format": 1,
      "title": "Speed after steady acceleration",
      "question": [
        { "text": "A car starts from rest and speeds up at " },
        { "id": "q-a", "text": "$2.5\\,\\mathrm{m/s^2}$" },
        { "text": " for " },
        { "id": "q-t", "text": "$8\\,\\mathrm{s}$" },
        { "text": ". " },
        { "id": "q-ask", "text": "How fast is it going then?" }
      ],
      "givens": [
        {
          "id": "a",
          "symbol": "a",
          "value": 2.5,
          "unit": "m/s^2",
          "span": "q-a",
          "label": "acceleration"
        },
        {
          "id": "t",
          "symbol": "t",
          "value": 8,
          "unit": "s",
          "span": "q-t",
          "label": "time"
        }
      ],
      "equations": [
        {
          "id": "kin",
          "states": [
            {
              "id": "rule",
              "latex": "\\term{v}{v} \\term{eq}{=} \\term{a}{a}\\,\\term{t}{t}"
            },
            {
              "id": "numbers",
              "latex": "\\term{v}{v} \\term{eq}{=} \\term{av}{2.5\\,\\mathrm{m/s^2}} \\cdot \\term{tv}{8\\,\\mathrm{s}}"
            },
            {
              "id": "done",
              "latex": "\\term{v}{v} \\term{eq}{=} \\term{res}{20\\,\\mathrm{m/s}}"
            }
          ]
        }
      ],
      "steps": [
        {
          "kind": "Extract",
          "given": "a",
          "duration": 3,
          "narration": "The car speeds up by 2.5 metres per second, every second."
        },
        {
          "kind": "Extract",
          "given": "t",
          "duration": 3,
          "narration": "It does this for 8 seconds."
        },
        {
          "kind": "Relate",
          "equation": "kin",
          "state": "rule",
          "givens": ["a", "t"],
          "duration": 4,
          "narration": "Starting from rest, the speed afterwards is the acceleration times the time."
        },
        {
          "kind": "Substitute",
          "equation": "kin",
          "to": "numbers",
          "pairs": [{ "given": "a", "term": "av" }, { "given": "t", "term": "tv" }],
          "duration": 3.5,
          "narration": "Put in 2.5 metres per second squared and 8 seconds."
        },
        {
          "kind": "Transform",
          "equation": "kin",
          "to": "done",
          "duration": 4,
          "narration": "2.5 times 8 is 20, and metres per second squared times seconds leaves metres per second."
        },
        {
          "kind": "Answer",
          "equation": "kin",
          "term": "res",
          "span": "q-ask",
          "text": "The car reaches 20 m/s.",
          "duration": 3,
          "narration": "The car is going twenty metres per second."
        }
      ]
    }
  }
}
```

`Plot`, `Construct` and `Annotate` bring the other elements onto the stage. A graph has a `view` and `items`. An item is a `function` written in x (such as `x^2-4*x-5`, read by a small parser of its own, so a script never runs code), a `point` that is fixed or moves along a function, an `area` under a function between two values, a `vector` or a `segment`, which can be dashed. A `Plot` step draws the items that it names.

```text
{
  "id": "curve",
  "view": { "x": [-1, 5], "y": [-2, 18] },
  "height": 280,
  "items": [
    {
      "id": "parab",
      "type": "function",
      "fn": "x^2",
      "domain": [-1, 4.2],
      "color": "blue",
      "label": "y = x²"
    },
    { "id": "pt", "type": "point", "along": "parab", "from": 0, "to": 3, "color": "orange" },
    {
      "id": "tan",
      "type": "segment",
      "from": [1.5, 0],
      "to": [4.2, 16.2],
      "color": "red",
      "label": "tangent"
    }
  ]
}
```

A figure is drawn as SVG in a box of its own, with y pointing down. Its shapes are points, segments, arrows, polygons, circles, angles (with `"right": true` for the square mark), rectangles, text and number lines, and a shape can name a point of the figure instead of coordinates. A `Construct` step draws the shapes that it names. The same step type reveals rows of a table, with `table` and `rows` instead of `figure` and `shapes`, as the dice example does.

```text
[
  { "id": "C", "type": "point", "at": [70, 270], "label": "C" },
  { "id": "B", "type": "point", "at": [170, 270], "label": "B" },
  { "id": "A", "type": "point", "at": [70, 30], "label": "A" },
  {
    "id": "leg-a",
    "type": "segment",
    "from": "C",
    "to": "B",
    "color": "blue",
    "label": "a = 5 cm"
  },
  {
    "id": "leg-b",
    "type": "segment",
    "from": "C",
    "to": "A",
    "color": "green",
    "label": "b = 12 cm"
  }
]
```

```text
{
  "tables": [
    {
      "id": "ways",
      "header": ["Die 1", "Die 2", "Sum"],
      "rows": [["2", "6", "8"], ["3", "5", "8"], ["4", "4", "8"], ["5", "3", "8"], ["6", "2", "8"]]
    }
  ],
  "step": {
    "kind": "Construct",
    "table": "ways",
    "rows": [2, 3, 4],
    "duration": 3.5,
    "narration": "Then 4 and 4, 5 and 3, and 6 and 2. That is five ways in all."
  }
}
```

A note points at a part of an element, such as a shape, a graph item, a term or a table row, and an `Annotate` step shows it. The last step of a script is usually an `Answer` step, which boxes a term of the final equation and shows a sentence that ties the result to the question.

Ids have to be unique among the spans, givens, equations, graphs, figures, tables and notes of a script. The ids of states, terms, shapes and graph items only have to be unique inside their own equation, state, figure or graph. A step lasts from 0.2 to 60 seconds, a script at most 900 seconds in all and 200 kilobytes. Scripts may not use the LaTeX commands that KaTeX needs for raw HTML or links, and the check names the field of every problem it finds. The `check` command validates every script in a file, and the authors' screens at `/math-author` play it and change it.

## Checking, importing and updating

The `check` command reads a file without touching the database. It reports every problem with the unit, lesson and challenge in which it occurs, such as `Unit 1 > lesson 2 > challenge 3 > payload.tests[1] needs expect, the expected output.`. `import` adds the courses of one or more files in a single transaction, so either all of a file lands or none of it does. `update` finds the course with the same title and replaces its texts, answers, payloads and scripts in place, which keeps everybody's progress. The units, lessons, challenges and options have to match the database in number and order, and otherwise nothing changes. A changed script becomes a new version of the solution, and explanations stored for the old version stay with it.

Outside Docker the payload checks need the TypeScript runner, so call the tool as `pnpm exec tsx scripts/lingo.mjs <command>`.

## Writing a new course

Start from the example that is closest to what you want, copy it and change the title. Write the reference solution of an exercise before the starter, run it, and only then take away the part that the learner has to write. Make the visible tests show the idea, and add a hidden test or two for the edge cases, such as an empty list or the number zero. For an exercise with blanks or distractors, try a wrong fill to see that it fails. Give every exercise a hint that points the way without giving the answer, and an explanation that says why the answer is right.

A lesson of five or six exercises is a good size. The examples start with a reading exercise and then alternate between low effort (predict, fill, order) and writing. Do not show the answer of an exercise in another exercise of the same lesson, because the whole lesson is loaded together. The SQL example once asked the learner to predict the result of the very query that a later exercise asked them to write.

If you write many exercises, generate the file with a small script. LaTeX needs doubled backslashes inside JSON strings, and a script that builds the strings from raw text avoids that source of mistakes. Run the `check` command after every change, and look at a few exercises in a lesson before you import a whole course.

## Things to watch for

A few mistakes came up while the examples were written, and each is easy to repeat. A distractor that also fits a blank makes a fill exercise ambiguous, so choose wrong answers that really fail. Browsers differ in the default look of elements such as buttons, so check only the properties that the exercise tells the learner to set. Printing a number may add a decimal point, so use a regular expression test when several outputs are fine.

In Python the indentation carries meaning, so an order exercise needs the learner to set it, which is the default there. A program that reads input has to read exactly what the tests send, and the server language examples read one whole number in the usual way of each language. A dollar sign starts a math span, so write amounts of money in words. Hints and explanations are plain text, and a formula in them shows as the characters that you typed.
