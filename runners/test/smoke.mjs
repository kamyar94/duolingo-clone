// Smoke and hardening test of the Lingo code runners. It runs where the app runs, on the
// runners' internal networks (see compose.yml next to this file), and checks for every language:
// hello world with input, a compile or syntax error, a runtime error, an endless loop stopped at
// the time limit, a fork bomb stopped by the process limit, a memory hog stopped, no network,
// no writes outside the scratch folder, capped output, nothing left behind after a job, the
// token out of reach, and two concurrent requests served one after the other.
//
// Environment: RUNNER_TOKEN, RUNNER_URL_<FAMILY> for the runners to test, SMOKE_ONLY (optional
// comma list of languages), SMOKE_PIDS_LIMIT (the pids_limit of the runners, default 128).

const TOKEN = process.env.RUNNER_TOKEN ?? "";
const PIDS_LIMIT = Number(process.env.SMOKE_PIDS_LIMIT) || 128;
const ONLY = (process.env.SMOKE_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const FAMILIES = {
  DOTNET: ["csharp"],
  JVM: ["java", "kotlin"],
  NATIVE: ["c", "cpp"],
  GO: ["go"],
  RUST: ["rust"],
  SCRIPT: ["ruby", "php", "perl", "lua", "bash"],
};

const LINE = "0123456789012345678901234567890123456789";

// ---- programs, one set per language ----

const P = {};

P.csharp = {
  file: "Program.cs",
  compiled: true,
  hello: `var name = Console.ReadLine();\nConsole.WriteLine($"Hello, {name}!");\n`,
  compileError: `Console.WriteLine("before");\n\nint x = "text";\n`,
  compileErrorPattern: /Program\.cs\(3,\d+\): error CS/,
  runtimeError: `int[] items = new int[2];\nConsole.WriteLine("start");\nConsole.WriteLine(items[5]);\n`,
  runtimePattern: /IndexOutOfRangeException[\s\S]*Program\.cs:line 3/,
  loop: `while (true) { }\n`,
  forkBomb: `using System.Diagnostics;\nint n = 0;\ntry\n{\n    while (true)\n    {\n        Process.Start(new ProcessStartInfo("sleep", "60") { UseShellExecute = false });\n        n++;\n    }\n}\ncatch (Exception e)\n{\n    Console.WriteLine($"spawned {n} then failed: {e.GetType().Name}");\n}\n`,
  memoryHog: `var keep = new List<byte[]>();\nwhile (true)\n{\n    var block = new byte[64 << 20];\n    Array.Fill(block, (byte)1);\n    keep.Add(block);\n    Console.WriteLine(keep.Count * 64);\n}\n`,
  network: `using System.Net.Sockets;\nstring line;\nwhile ((line = Console.ReadLine()) != null)\n{\n    var parts = line.Split(' ');\n    try\n    {\n        using var client = new TcpClient();\n        if (!client.ConnectAsync(parts[0], int.Parse(parts[1])).Wait(2000)) throw new TimeoutException();\n        Console.WriteLine($"{parts[0]}:open");\n    }\n    catch { Console.WriteLine($"{parts[0]}:blocked"); }\n}\n`,
  writes: `string line;\nwhile ((line = Console.ReadLine()) != null)\n{\n    if (line.Length == 0) continue;\n    try { File.WriteAllText(line, "x"); Console.WriteLine($"{line}:written"); }\n    catch { Console.WriteLine($"{line}:denied"); }\n}\n`,
  flood: `while (true) Console.WriteLine("${LINE}");\n`,
  shell: `using System.Diagnostics;\nvar script = Console.In.ReadToEnd();\nvar process = Process.Start(new ProcessStartInfo("/bin/sh") { ArgumentList = { "-c", script }, UseShellExecute = false });\nprocess.WaitForExit();\nreturn process.ExitCode;\n`,
};

const javaClass = (body, imports = "") =>
  `${imports}public class Main {\n    public static void main(String[] args) throws Exception {\n${body}\n    }\n}\n`;

P.java = {
  file: "Main.java",
  compiled: true,
  hello: `import java.util.Scanner;\n\npublic class Greeter {\n    public static void main(String[] args) {\n        String name = new Scanner(System.in).nextLine();\n        System.out.println("Hello, " + name + "!");\n    }\n}\n`,
  compileError: `public class Main {\n    public static void main(String[] args) {\n        int x = "text";\n    }\n}\n`,
  compileErrorPattern: /Main\.java:3: error/,
  runtimeError: `public class Main {\n    public static void main(String[] args) {\n        int[] items = new int[2];\n        System.out.println(items[5]);\n    }\n}\n`,
  runtimePattern: /ArrayIndexOutOfBoundsException[\s\S]*Main\.java:4/,
  loop: javaClass(`        while (true) { }`),
  forkBomb: javaClass(
    `        int n = 0;\n        try { while (true) { new ProcessBuilder("sleep", "60").start(); n++; } }\n        catch (Throwable e) { System.out.println("spawned " + n + " then failed: " + e.getClass().getSimpleName()); }`
  ),
  memoryHog: javaClass(
    `        java.util.List<byte[]> keep = new java.util.ArrayList<>();\n        while (true) { byte[] b = new byte[64 << 20]; java.util.Arrays.fill(b, (byte) 1); keep.add(b); System.out.println(keep.size() * 64); }`
  ),
  network: javaClass(
    `        var in = new java.io.BufferedReader(new java.io.InputStreamReader(System.in));\n        String line;\n        while ((line = in.readLine()) != null) {\n            String[] p = line.split(" ");\n            try (var s = new java.net.Socket()) { s.connect(new java.net.InetSocketAddress(p[0], Integer.parseInt(p[1])), 2000); System.out.println(p[0] + ":open"); }\n            catch (Exception e) { System.out.println(p[0] + ":blocked"); }\n        }`
  ),
  writes: javaClass(
    `        var in = new java.io.BufferedReader(new java.io.InputStreamReader(System.in));\n        String line;\n        while ((line = in.readLine()) != null) {\n            if (line.isEmpty()) continue;\n            try { java.nio.file.Files.writeString(java.nio.file.Path.of(line), "x"); System.out.println(line + ":written"); }\n            catch (Exception e) { System.out.println(line + ":denied"); }\n        }`
  ),
  flood: javaClass(`        while (true) System.out.println("${LINE}");`),
  shell: javaClass(
    `        String script = new String(System.in.readAllBytes());\n        Process p = new ProcessBuilder("/bin/sh", "-c", script).inheritIO().start();\n        System.exit(p.waitFor());`
  ),
};

P.kotlin = {
  file: "Main.kt",
  compiled: true,
  hello: `fun main() {\n    val name = readln()\n    println("Hello, $name!")\n}\n`,
  compileError: `fun main() {\n    println("before")\n    val x: Int = "text"\n}\n`,
  compileErrorPattern: /Main\.kt:3:\d+: error/,
  runtimeError: `fun main() {\n    val items = IntArray(2)\n    println(items[5])\n}\n`,
  runtimePattern: /ArrayIndexOutOfBoundsException[\s\S]*Main\.kt:3/,
  loop: `fun main() {\n    while (true) { }\n}\n`,
  forkBomb: `fun main() {\n    var n = 0\n    try { while (true) { ProcessBuilder("sleep", "60").start(); n++ } }\n    catch (e: Throwable) { println("spawned $n then failed: \${e.javaClass.simpleName}") }\n}\n`,
  memoryHog: `fun main() {\n    val keep = ArrayList<ByteArray>()\n    while (true) { val b = ByteArray(64 shl 20); b.fill(1); keep.add(b); println(keep.size * 64) }\n}\n`,
  network: `import java.net.InetSocketAddress\nimport java.net.Socket\n\nfun main() {\n    while (true) {\n        val line = readlnOrNull() ?: break\n        val p = line.split(" ")\n        try { Socket().use { it.connect(InetSocketAddress(p[0], p[1].toInt()), 2000) }; println("\${p[0]}:open") }\n        catch (e: Exception) { println("\${p[0]}:blocked") }\n    }\n}\n`,
  writes: `import java.io.File\n\nfun main() {\n    while (true) {\n        val line = readlnOrNull() ?: break\n        if (line.isEmpty()) continue\n        try { File(line).writeText("x"); println("$line:written") }\n        catch (e: Exception) { println("$line:denied") }\n    }\n}\n`,
  flood: `fun main() {\n    while (true) println("${LINE}")\n}\n`,
  shell: `fun main() {\n    val script = generateSequence(::readLine).joinToString("\\n")\n    val p = ProcessBuilder("/bin/sh", "-c", script).inheritIO().start()\n    kotlin.system.exitProcess(p.waitFor())\n}\n`,
};

const C_NET = `#include <errno.h>
#include <netdb.h>
#include <poll.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

static int reach(const char *host, const char *port) {
    struct addrinfo hints, *res, *ai;
    memset(&hints, 0, sizeof hints);
    hints.ai_socktype = SOCK_STREAM;
    if (getaddrinfo(host, port, &hints, &res) != 0) return 0;
    int ok = 0;
    for (ai = res; ai && !ok; ai = ai->ai_next) {
        int fd = socket(ai->ai_family, ai->ai_socktype | SOCK_NONBLOCK, 0);
        if (fd < 0) continue;
        if (connect(fd, ai->ai_addr, ai->ai_addrlen) == 0) ok = 1;
        else if (errno == EINPROGRESS) {
            struct pollfd p = { fd, POLLOUT, 0 };
            int err = 1;
            socklen_t len = sizeof err;
            if (poll(&p, 1, 2000) == 1 && getsockopt(fd, SOL_SOCKET, SO_ERROR, &err, &len) == 0 && err == 0) ok = 1;
        }
        close(fd);
    }
    freeaddrinfo(res);
    return ok;
}

int main(void) {
    char host[256], port[16];
    while (scanf("%255s %15s", host, port) == 2) printf("%s:%s\\n", host, reach(host, port) ? "open" : "blocked");
    return 0;
}
`;

const C_FORK = `#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

int main(void) {
    int n = 0;
    for (;;) {
        pid_t pid = fork();
        if (pid == 0) { pause(); _exit(0); }
        if (pid < 0) { printf("spawned %d then failed: %s\\n", n, strerror(errno)); return 0; }
        n++;
    }
}
`;

const C_SHELL = `#include <stdio.h>
#include <stdlib.h>

int main(void) {
    static char script[65536];
    size_t n = fread(script, 1, sizeof script - 1, stdin);
    script[n] = 0;
    fflush(stdout);
    int status = system(script);
    return (status >> 8) & 0xff;
}
`;

const C_WRITES = `#include <stdio.h>
#include <string.h>

int main(void) {
    char path[512];
    while (fgets(path, sizeof path, stdin)) {
        path[strcspn(path, "\\n")] = 0;
        if (!*path) continue;
        FILE *f = fopen(path, "w");
        if (f && fputs("x", f) >= 0 && fclose(f) == 0) printf("%s:written\\n", path);
        else printf("%s:denied\\n", path);
    }
    return 0;
}
`;

P.c = {
  file: "main.c",
  compiled: true,
  hello: `#include <stdio.h>\n#include <string.h>\n\nint main(void) {\n    char name[100] = "";\n    if (!fgets(name, sizeof name, stdin)) return 1;\n    name[strcspn(name, "\\n")] = 0;\n    printf("Hello, %s!\\n", name);\n    return 0;\n}\n`,
  compileError: `#include <stdio.h>\nint main(void) {\n    int x = ;\n    return 0;\n}\n`,
  compileErrorPattern: /main\.c:3:\d+: error/,
  runtimeError: `#include <stdio.h>\n\nint main(void) {\n    volatile int *p = 0;\n    printf("start\\n");\n    fflush(stdout);\n    return *p;\n}\n`,
  runtimeSignal: "SIGSEGV",
  loop: `int main(void) {\n    for (;;) { }\n}\n`,
  forkBomb: C_FORK,
  memoryHog: `#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n\nint main(void) {\n    size_t total = 0;\n    for (;;) {\n        char *p = malloc(64 << 20);\n        if (!p) { printf("malloc failed after %zu MB\\n", total); return 1; }\n        memset(p, 1, 64 << 20);\n        total += 64;\n        printf("%zu\\n", total);\n        fflush(stdout);\n    }\n}\n`,
  network: C_NET,
  writes: C_WRITES,
  flood: `#include <stdio.h>\n\nint main(void) {\n    for (;;) puts("${LINE}");\n}\n`,
  shell: C_SHELL,
};

P.cpp = {
  file: "main.cpp",
  compiled: true,
  hello: `#include <iostream>\n#include <string>\n\nint main() {\n    std::string name;\n    std::getline(std::cin, name);\n    std::cout << "Hello, " << name << "!" << std::endl;\n}\n`,
  compileError: `#include <iostream>\nint main() {\n    int x = "text";\n}\n`,
  compileErrorPattern: /main\.cpp:3:\d+: error/,
  runtimeError: `#include <iostream>\n#include <stdexcept>\n\nint main() {\n    std::cout << "start" << std::endl;\n    throw std::runtime_error("boom");\n}\n`,
  runtimePattern: /runtime_error[\s\S]*boom/,
  loop: `int main() {\n    volatile unsigned long n = 0;\n    for (;;) n++;\n}\n`,
  forkBomb: C_FORK,
  memoryHog: `#include <cstring>\n#include <iostream>\n#include <vector>\n\nint main() {\n    std::vector<char*> keep;\n    for (;;) {\n        char* block = new char[64 << 20];\n        std::memset(block, 1, 64 << 20);\n        keep.push_back(block);\n        std::cout << keep.size() * 64 << std::endl;\n    }\n}\n`,
  network: C_NET,
  writes: C_WRITES,
  flood: `#include <cstdio>\n\nint main() {\n    for (;;) std::puts("${LINE}");\n}\n`,
  shell: C_SHELL,
};

P.go = {
  file: "main.go",
  compiled: true,
  hello: `package main\n\nimport (\n\t"bufio"\n\t"fmt"\n\t"os"\n\t"strings"\n)\n\nfunc main() {\n\tname, _ := bufio.NewReader(os.Stdin).ReadString('\\n')\n\tfmt.Printf("Hello, %s!\\n", strings.TrimSpace(name))\n}\n`,
  compileError: `package main\n\nfunc main() { var x int = "text"; _ = x }\n`,
  compileErrorPattern: /main\.go:3:\d+: cannot use/,
  runtimeError: `package main\n\nfunc main() {\n\tvar items []int\n\tprintln(items[5])\n}\n`,
  runtimePattern: /index out of range[\s\S]*main\.go:5/,
  loop: `package main\n\nfunc main() {\n\tfor {\n\t}\n}\n`,
  forkBomb: `package main\n\nimport (\n\t"fmt"\n\t"os/exec"\n)\n\nfunc main() {\n\tn := 0\n\tfor {\n\t\tif err := exec.Command("sleep", "60").Start(); err != nil {\n\t\t\tfmt.Printf("spawned %d then failed: %v\\n", n, err)\n\t\t\treturn\n\t\t}\n\t\tn++\n\t}\n}\n`,
  memoryHog: `package main\n\nimport "fmt"\n\nfunc main() {\n\tvar keep [][]byte\n\tfor {\n\t\tb := make([]byte, 64<<20)\n\t\tfor i := range b {\n\t\t\tb[i] = 1\n\t\t}\n\t\tkeep = append(keep, b)\n\t\tfmt.Println(len(keep) * 64)\n\t}\n}\n`,
  network: `package main\n\nimport (\n\t"bufio"\n\t"fmt"\n\t"net"\n\t"os"\n\t"strings"\n\t"time"\n)\n\nfunc main() {\n\ts := bufio.NewScanner(os.Stdin)\n\tfor s.Scan() {\n\t\tf := strings.Fields(s.Text())\n\t\tif len(f) != 2 {\n\t\t\tcontinue\n\t\t}\n\t\tc, err := net.DialTimeout("tcp", net.JoinHostPort(f[0], f[1]), 2*time.Second)\n\t\tif err == nil {\n\t\t\tc.Close()\n\t\t\tfmt.Println(f[0] + ":open")\n\t\t} else {\n\t\t\tfmt.Println(f[0] + ":blocked")\n\t\t}\n\t}\n}\n`,
  writes: `package main\n\nimport (\n\t"bufio"\n\t"fmt"\n\t"os"\n)\n\nfunc main() {\n\ts := bufio.NewScanner(os.Stdin)\n\tfor s.Scan() {\n\t\tp := s.Text()\n\t\tif p == "" {\n\t\t\tcontinue\n\t\t}\n\t\tif err := os.WriteFile(p, []byte("x"), 0o644); err == nil {\n\t\t\tfmt.Println(p + ":written")\n\t\t} else {\n\t\t\tfmt.Println(p + ":denied")\n\t\t}\n\t}\n}\n`,
  flood: `package main\n\nimport "fmt"\n\nfunc main() {\n\tfor {\n\t\tfmt.Println("${LINE}")\n\t}\n}\n`,
  shell: `package main\n\nimport (\n\t"io"\n\t"os"\n\t"os/exec"\n)\n\nfunc main() {\n\tscript, _ := io.ReadAll(os.Stdin)\n\tcmd := exec.Command("/bin/sh", "-c", string(script))\n\tcmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr\n\t_ = cmd.Run()\n}\n`,
};

P.rust = {
  file: "main.rs",
  compiled: true,
  hello: `use std::io;\n\nfn main() {\n    let mut name = String::new();\n    io::stdin().read_line(&mut name).unwrap();\n    println!("Hello, {}!", name.trim());\n}\n`,
  compileError: `fn main() {\n    println!("before");\n    let x: i32 = "text";\n}\n`,
  compileErrorPattern: /main\.rs:3:\d+/,
  runtimeError: `fn main() {\n    let items: Vec<i32> = Vec::new();\n    println!("{}", items[5]);\n}\n`,
  runtimePattern: /panicked at main\.rs:3/,
  loop: `fn main() {\n    loop {}\n}\n`,
  forkBomb: `use std::process::Command;\n\nfn main() {\n    let mut n = 0;\n    loop {\n        match Command::new("sleep").arg("60").spawn() {\n            Ok(_) => n += 1,\n            Err(e) => {\n                println!("spawned {} then failed: {}", n, e);\n                return;\n            }\n        }\n    }\n}\n`,
  memoryHog: `fn main() {\n    let mut keep: Vec<Vec<u8>> = Vec::new();\n    loop {\n        keep.push(vec![1u8; 64 << 20]);\n        println!("{}", keep.len() * 64);\n    }\n}\n`,
  network: `use std::io::BufRead;\nuse std::net::{TcpStream, ToSocketAddrs};\nuse std::time::Duration;\n\nfn main() {\n    for line in std::io::stdin().lock().lines() {\n        let line = line.unwrap();\n        let p: Vec<&str> = line.split_whitespace().collect();\n        if p.len() != 2 { continue; }\n        let open = format!("{}:{}", p[0], p[1])\n            .to_socket_addrs()\n            .ok()\n            .and_then(|mut a| a.next())\n            .map(|a| TcpStream::connect_timeout(&a, Duration::from_secs(2)).is_ok())\n            .unwrap_or(false);\n        println!("{}:{}", p[0], if open { "open" } else { "blocked" });\n    }\n}\n`,
  writes: `use std::io::BufRead;\n\nfn main() {\n    for line in std::io::stdin().lock().lines() {\n        let p = line.unwrap();\n        if p.is_empty() { continue; }\n        match std::fs::write(&p, "x") {\n            Ok(_) => println!("{}:written", p),\n            Err(_) => println!("{}:denied", p),\n        }\n    }\n}\n`,
  flood: `fn main() {\n    loop {\n        println!("${LINE}");\n    }\n}\n`,
  shell: `use std::io::Read;\nuse std::process::Command;\n\nfn main() {\n    let mut script = String::new();\n    std::io::stdin().read_to_string(&mut script).unwrap();\n    let status = Command::new("/bin/sh").arg("-c").arg(&script).status().unwrap();\n    std::process::exit(status.code().unwrap_or(1));\n}\n`,
};

P.ruby = {
  file: "main.rb",
  hello: `name = gets.to_s.strip\nputs "Hello, #{name}!"\n`,
  compileError: `puts "before"\nx = [1, 2\nputs x\n`,
  compileErrorPattern: /main\.rb:\d+/,
  runtimeError: `puts "start"\nnil.upcase\n`,
  runtimePattern: /main\.rb:2/,
  loop: `loop { }\n`,
  forkBomb: `n = 0\nbegin\n  loop { Process.spawn("sleep", "60"); n += 1 }\nrescue => e\n  puts "spawned #{n} then failed: #{e.class}"\nend\n`,
  memoryHog: `keep = []\nloop { keep << ("x" * (64 << 20)); puts keep.size * 64 }\n`,
  network: `require "socket"\nSTDIN.each_line do |line|\n  host, port = line.split\n  next unless port\n  begin\n    Socket.tcp(host, port.to_i, connect_timeout: 2) { }\n    puts "#{host}:open"\n  rescue StandardError\n    puts "#{host}:blocked"\n  end\nend\n`,
  writes: `STDIN.each_line do |line|\n  path = line.strip\n  next if path.empty?\n  begin\n    File.write(path, "x")\n    puts "#{path}:written"\n  rescue SystemCallError, IOError\n    puts "#{path}:denied"\n  end\nend\n`,
  flood: `loop { puts "${LINE}" }\n`,
  shell: `system("/bin/sh", "-c", STDIN.read)\nexit($?.exitstatus || 1)\n`,
};

P.php = {
  file: "main.php",
  hello: `<?php\n$name = trim(fgets(STDIN));\necho "Hello, $name!\\n";\n`,
  compileError: `<?php\necho "before";\n$x = ;\n`,
  compileErrorPattern: /main\.php on line 3/,
  runtimeError: `<?php\necho "start\\n";\nthrow new Exception("boom");\n`,
  runtimePattern: /boom[\s\S]*main\.php/,
  loop: `<?php\nwhile (true) { }\n`,
  forkBomb: `<?php\n$n = 0;\n$keep = [];\nwhile (true) {\n    $p = @proc_open(["sleep", "60"], [], $pipes);\n    if ($p === false) { echo "spawned $n then failed\\n"; exit(0); }\n    $keep[] = $p;\n    $n++;\n}\n`,
  memoryHog: `<?php\n$keep = [];\nwhile (true) { $keep[] = str_repeat("x", 64 << 20); echo count($keep) * 64, "\\n"; }\n`,
  network: `<?php\nwhile (($line = fgets(STDIN)) !== false) {\n    $p = preg_split('/\\s+/', trim($line));\n    if (count($p) != 2) continue;\n    $s = @fsockopen($p[0], (int)$p[1], $errno, $errstr, 2);\n    if ($s) { fclose($s); echo "$p[0]:open\\n"; } else { echo "$p[0]:blocked\\n"; }\n}\n`,
  writes: `<?php\nwhile (($line = fgets(STDIN)) !== false) {\n    $path = trim($line);\n    if ($path === "") continue;\n    echo $path, @file_put_contents($path, "x") !== false ? ":written\\n" : ":denied\\n";\n}\n`,
  flood: `<?php\nwhile (true) echo "${LINE}\\n";\n`,
  shell: `<?php\npassthru("/bin/sh -c " . escapeshellarg(stream_get_contents(STDIN)), $code);\nexit($code);\n`,
};

P.perl = {
  file: "main.pl",
  hello: `my $name = <STDIN>;\nchomp $name;\nprint "Hello, $name!\\n";\n`,
  compileError: `print "before\\n";\nmy $x = ;\n`,
  compileErrorPattern: /main\.pl line 2/,
  runtimeError: `print "start\\n";\ndie "boom";\n`,
  runtimePattern: /boom at main\.pl line 2/,
  loop: `while (1) { }\n`,
  forkBomb: `my $n = 0;\nwhile (1) {\n    my $pid = fork();\n    if (!defined $pid) { print "spawned $n then failed: $!\\n"; exit 0; }\n    if ($pid == 0) { sleep 60; exit 0; }\n    $n++;\n}\n`,
  memoryHog: `my @keep;\nwhile (1) { push @keep, "x" x (64 << 20); print scalar(@keep) * 64, "\\n"; }\n`,
  network: `use IO::Socket::INET;\nwhile (my $line = <STDIN>) {\n    my ($h, $p) = split ' ', $line;\n    next unless $p;\n    my $s = IO::Socket::INET->new(PeerAddr => $h, PeerPort => $p, Proto => 'tcp', Timeout => 2);\n    print $s ? "$h:open\\n" : "$h:blocked\\n";\n    close $s if $s;\n}\n`,
  writes: `while (my $p = <STDIN>) {\n    chomp $p;\n    next unless length $p;\n    if (open(my $f, '>', $p)) { print $f "x"; close $f; print "$p:written\\n"; }\n    else { print "$p:denied\\n"; }\n}\n`,
  flood: `$| = 1;\nwhile (1) { print "${LINE}\\n"; }\n`,
  shell: `local $/;\nmy $script = <STDIN>;\nsystem('/bin/sh', '-c', $script);\nexit($? >> 8);\n`,
};

P.lua = {
  file: "main.lua",
  hello: `local name = io.read("l") or ""\nprint("Hello, " .. name .. "!")\n`,
  compileError: `print("before")\nlocal x = = 1\n`,
  compileErrorPattern: /main\.lua:2:/,
  runtimeError: `print("start")\nlocal t = nil\nprint(t.x)\n`,
  runtimePattern: /main\.lua:3:/,
  loop: `while true do end\n`,
  forkBomb: `local n, keep = 0, {}\nwhile true do\n  local f, err = io.popen("sleep 60")\n  if not f then print("spawned " .. n .. " then failed: " .. tostring(err)) break end\n  keep[#keep + 1] = f\n  n = n + 1\nend\n`,
  memoryHog: `local keep = {}\nwhile true do\n  keep[#keep + 1] = string.rep("x", 64 << 20) .. #keep\n  print(#keep * 64)\nend\n`,
  // Lua has no sockets of its own; the attempt goes through Bash's /dev/tcp.
  network: `for line in io.lines() do\n  local host, port = line:match("^([%w%.%-]+) (%d+)$")\n  if host then\n    local ok = os.execute("timeout 2 bash -c 'exec 3<>/dev/tcp/" .. host .. "/" .. port .. "' 2>/dev/null")\n    print(host .. (ok and ":open" or ":blocked"))\n  end\nend\n`,
  writes: `for path in io.lines() do\n  if path ~= "" then\n    local f = io.open(path, "w")\n    if f and f:write("x") and f:close() then print(path .. ":written") else print(path .. ":denied") end\n  end\nend\n`,
  flood: `while true do print("${LINE}") end\n`,
  shell: `local script = io.read("a")\nlocal ok, how, code = os.execute(script)\nos.exit(code or 0)\n`,
};

P.bash = {
  file: "main.sh",
  hello: `read -r name\necho "Hello, $name!"\n`,
  compileError: `echo before\nif true; then\n  echo inside\n`,
  compileErrorPattern: /main\.sh: line \d+: syntax error/,
  runtimeError: `echo start\nset -e\nno_such_command_here\necho never\n`,
  runtimePattern: /main\.sh: line 3: no_such_command_here/,
  loop: `while :; do :; done\n`,
  // The classic bomb, then the main script keeps spawning until fork fails or time runs out.
  forkBomb: `bomb() { bomb | bomb & }\nbomb\nn=0\nwhile :; do\n  sleep 60 & [ $? -eq 0 ] || { echo "spawned $n then failed"; exit 0; }\n  n=$((n+1))\ndone\n`,
  memoryHog: `x=a\nwhile :; do x="$x$x"; echo \${#x}; done\n`,
  network: `while read -r host port; do\n  if timeout 2 bash -c "exec 3<>/dev/tcp/$host/$port" 2>/dev/null; then echo "$host:open"; else echo "$host:blocked"; fi\ndone\n`,
  writes: `while read -r p; do\n  [ -n "$p" ] || continue\n  if ( echo x > "$p" ) 2>/dev/null; then echo "$p:written"; else echo "$p:denied"; fi\ndone\n`,
  flood: `while :; do echo ${LINE}; done\n`,
  shell: `sh -c "$(cat)"\n`,
};

// ---- shell scripts run through each language's shell program ----

const LEFTOVER = `setsid sleep 300 > /dev/null 2>&1 < /dev/null &
echo x > /tmp/lingo-leftover
echo x > /dev/shm/lingo-leftover
echo planted`;

const CHECK = `n=0
for f in /proc/[0-9]*/cmdline; do
  if tr '\\000' ' ' < "$f" 2>/dev/null | grep -q '^sleep 30[0]'; then n=$((n+1)); fi
done
echo "procs:$n"
if [ -e /tmp/lingo-leftover ]; then echo tmp:left; else echo tmp:clean; fi
if [ -e /dev/shm/lingo-leftover ]; then echo shm:left; else echo shm:clean; fi
echo "runs:$(ls -d /tmp/lingo-run-* 2>/dev/null | wc -l)"
echo "uid:$(id -u)"
if cat /proc/1/environ > /dev/null 2>&1; then echo environ:readable; else echo environ:denied; fi
echo "childtoken:$(env | grep -c RUNNER_TOKEN)"`;

const WRITE_TARGETS = [
  "/etc/lingo-test",
  "/opt/lingo/lingo-test",
  "/usr/local/bin/lingo-test",
  "/lingo-test",
  "/var/tmp/lingo-test",
  "/root/lingo-test",
  "/home/lingo-test",
];

// ---- runner calls ----

const urlFor = (family) => process.env[`RUNNER_URL_${family}`];

const run = async (url, language, code, { inputs = [""], timeLimitMs = 5000 } = {}) => {
  const started = Date.now();
  const response = await fetch(`${url}/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      language,
      files: [{ name: P[language].file, content: code }],
      runs: inputs.map((stdin) => ({ stdin })),
      timeLimitMs,
    }),
  });
  const body = await response.json();
  return { status: response.status, body, ms: Date.now() - started };
};

const results = [];
let failures = 0;

const check = (language, name, ok, detail) => {
  results.push({ language, name, ok });
  if (!ok) failures++;
  const mark = ok ? "PASS" : "FAIL";
  console.log(`${mark} ${language.padEnd(7)} ${name}${detail ? ` | ${detail}` : ""}`);
};

const short = (text, n = 160) => JSON.stringify(String(text ?? "").slice(0, n));
const out = (r) => (r.body.runs?.[0]?.stdout ?? "") + (r.body.runs?.[0]?.stderr ?? "");
const compileText = (r) => (r.body.compile?.stdout ?? "") + (r.body.compile?.stderr ?? "");

const helloWorks = async (url, language) => {
  const r = await run(url, language, P[language].hello, { inputs: ["Ada\n"] });
  return r.status === 200 && r.body.runs?.[0]?.stdout === "Hello, Ada!\n";
};

const testLanguage = async (family, language, url, otherHosts) => {
  const prog = P[language];

  // hello world, twice in one request (one compile, two runs with their own input)
  let r = await run(url, language, prog.hello, { inputs: ["Ada\n", "Grace\n"] });
  check(
    language,
    "hello world with input",
    r.status === 200 &&
      r.body.runs?.length === 2 &&
      r.body.runs[0].stdout === "Hello, Ada!\n" &&
      r.body.runs[1].stdout === "Hello, Grace!\n" &&
      r.body.runs.every((x) => x.exitCode === 0),
    `${r.ms} ms, compile ${r.body.compile?.durationMs ?? "-"} ms, run ${r.body.runs?.[0]?.durationMs} ms ${r.status !== 200 ? short(JSON.stringify(r.body)) : ""}`
  );

  // compile or syntax error with its line
  r = await run(url, language, prog.compileError);
  if (prog.compiled) {
    check(
      language,
      "compile error with line",
      r.status === 200 && r.body.compile?.exitCode !== 0 && r.body.runs.length === 0 && prog.compileErrorPattern.test(compileText(r)),
      short(compileText(r))
    );
  } else {
    check(
      language,
      "syntax error with line",
      r.status === 200 && r.body.runs[0]?.exitCode !== 0 && prog.compileErrorPattern.test(out(r)),
      short(out(r))
    );
  }

  // runtime error
  r = await run(url, language, prog.runtimeError);
  const rt = r.body.runs?.[0];
  check(
    language,
    "runtime error",
    r.status === 200 &&
      rt?.exitCode !== 0 &&
      (prog.runtimeSignal ? rt.signal === prog.runtimeSignal : prog.runtimePattern.test(rt.stderr + rt.stdout)),
    `exit ${rt?.exitCode} ${rt?.signal ?? ""} ${short(rt?.stderr)}`
  );

  // endless loop stopped at the time limit
  r = await run(url, language, prog.loop, { timeLimitMs: 1500 });
  const loop = r.body.runs?.[0];
  check(
    language,
    "endless loop stopped at the limit",
    r.status === 200 && loop?.timedOut === true && loop.durationMs >= 1400 && loop.durationMs < 3500,
    `${loop?.durationMs} ms, timedOut ${loop?.timedOut}`
  );

  // fork bomb: stopped by the process limit, and the runner keeps working
  r = await run(url, language, prog.forkBomb, { timeLimitMs: 8000 });
  const bomb = r.body.runs?.[0];
  const spawned = /spawned (\d+)/.exec(bomb?.stdout ?? "");
  const bombStopped =
    r.status === 200 &&
    bomb &&
    (bomb.timedOut || /failed/.test(bomb.stdout) || bomb.exitCode !== 0) &&
    (!spawned || Number(spawned[1]) < PIDS_LIMIT);
  const aliveAfterBomb = await helloWorks(url, language);
  check(
    language,
    "fork bomb stopped, runner alive",
    bombStopped && aliveAfterBomb,
    `${short(bomb?.stdout, 80)} exit ${bomb?.exitCode} timedOut ${bomb?.timedOut} ${short(bomb?.stderr, 100)}`
  );

  // memory hog
  r = await run(url, language, prog.memoryHog, { timeLimitMs: 15000 });
  const hog = r.body.runs?.[0];
  const hogText = (hog?.stderr ?? "") + (hog?.stdout ?? "");
  const hogStopped =
    r.status === 200 &&
    hog &&
    !hog.timedOut &&
    hog.exitCode !== 0 &&
    (hog.oomKilled ||
      hog.signal === "SIGKILL" ||
      /OutOfMemory|out of memory|memory exhausted|Cannot allocate|bad_alloc|memory allocation|xmalloc|Allowed memory size|failed to allocate|not enough memory|malloc failed/i.test(hogText));
  const aliveAfterHog = await helloWorks(url, language);
  check(
    language,
    "memory hog stopped, runner alive",
    hogStopped && aliveAfterHog,
    `exit ${hog?.exitCode} ${hog?.signal ?? ""} oom ${hog?.oomKilled} ${hog?.durationMs} ms ${short(hog?.stderr, 100)}`
  );

  // no network: the internet by address and by name, and the other runners
  const targets = ["1.1.1.1 80", "example.com 443", ...otherHosts.map((h) => `${h} 8080`)];
  r = await run(url, language, prog.network, { inputs: [targets.join("\n") + "\n"], timeLimitMs: 20000 });
  const net = r.body.runs?.[0]?.stdout ?? "";
  const blocked = targets.every((t) => net.includes(`${t.split(" ")[0]}:blocked`));
  check(language, "no network", r.status === 200 && blocked && !net.includes(":open"), short(net.replace(/\n/g, " ")));

  // no writes outside the scratch folder
  r = await run(url, language, prog.writes, { inputs: [[...WRITE_TARGETS, "scratch-file"].join("\n") + "\n"] });
  const writes = r.body.runs?.[0]?.stdout ?? "";
  check(
    language,
    "writes outside scratch fail",
    r.status === 200 && WRITE_TARGETS.every((t) => writes.includes(`${t}:denied`)) && writes.includes("scratch-file:written"),
    short(writes.replace(/\n/g, " "), 300)
  );

  // output cap
  r = await run(url, language, prog.flood, { timeLimitMs: 10000 });
  const flood = r.body.runs?.[0];
  check(
    language,
    "output capped",
    r.status === 200 && flood?.truncated === true && !flood.timedOut && flood.stdout.length + flood.stderr.length <= 65536 && flood.stdout.length > 60000,
    `${flood?.stdout.length} bytes, truncated ${flood?.truncated}, ${flood?.durationMs} ms`
  );

  // nothing left behind: a detached process and files outside the scratch folder
  r = await run(url, language, prog.shell, { inputs: [LEFTOVER] });
  const planted = (r.body.runs?.[0]?.stdout ?? "").includes("planted");
  r = await run(url, language, prog.shell, { inputs: [CHECK] });
  const state = r.body.runs?.[0]?.stdout ?? "";
  check(
    language,
    "nothing left after a job",
    planted && /procs:0/.test(state) && /tmp:clean/.test(state) && /shm:clean/.test(state) && /runs:1\b/.test(state),
    short(state.replace(/\n/g, " "), 200)
  );
  check(
    language,
    "non-root, token out of reach",
    /uid:10001/.test(state) && /environ:denied/.test(state) && /childtoken:0/.test(state),
    short(state.replace(/\n/g, " "), 200)
  );

  // two concurrent requests run one after the other
  const sleeper = "sleep 1\necho done";
  const [a, b] = await Promise.all([
    run(url, language, prog.shell, { inputs: [sleeper] }),
    run(url, language, prog.shell, { inputs: [sleeper] }),
  ]);
  const bothDone = [a, b].every((x) => x.status === 200 && x.body.runs?.[0]?.stdout === "done\n");
  const waited = Math.max(a.body.queueMs ?? 0, b.body.queueMs ?? 0);
  check(language, "concurrent runs queued", bothDone && waited >= 900, `queue ${a.body.queueMs} / ${b.body.queueMs} ms`);
};

const main = async () => {
  if (TOKEN.length < 24) throw new Error("RUNNER_TOKEN is not set");
  const families = Object.entries(FAMILIES).filter(([family]) => urlFor(family));
  const hosts = Object.fromEntries(families.map(([family]) => [family, new URL(urlFor(family)).hostname]));

  for (const [family, langs] of families) {
    const url = urlFor(family);
    let health;
    try {
      health = await (await fetch(`${url}/health`)).json();
    } catch (error) {
      check(family.toLowerCase(), "runner reachable", false, String(error));
      continue;
    }
    const otherHosts = Object.entries(hosts)
      .filter(([other]) => other !== family)
      .map(([, host]) => host);

    // requests without the token or with bad input are refused
    const noToken = await fetch(`${url}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const wrongLanguage = await fetch(`${url}/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ language: "cobol", files: [{ name: "a.cob", content: "" }] }),
    });
    const badName = await fetch(`${url}/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ language: langs[0], files: [{ name: "../x", content: "" }] }),
    });
    check(
      family.toLowerCase(),
      "token and request checks",
      noToken.status === 401 && wrongLanguage.status === 400 && badName.status === 400,
      `${noToken.status} ${wrongLanguage.status} ${badName.status}; serves ${health.languages}`
    );

    for (const language of langs) {
      if (ONLY.length && !ONLY.includes(language)) continue;
      if (!health.languages.includes(language)) {
        check(language, "served", false, `runner serves ${health.languages}`);
        continue;
      }
      try {
        await testLanguage(family, language, url, otherHosts);
      } catch (error) {
        check(language, "test run", false, String(error?.stack ?? error));
      }
    }
  }

  const byLanguage = {};
  for (const r of results) {
    byLanguage[r.language] ??= { pass: 0, fail: 0 };
    byLanguage[r.language][r.ok ? "pass" : "fail"]++;
  }
  console.log("\nSummary");
  for (const [language, counts] of Object.entries(byLanguage))
    console.log(`  ${language.padEnd(7)} ${counts.pass} passed, ${counts.fail} failed`);
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
};

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
