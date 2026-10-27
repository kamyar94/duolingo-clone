package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// File is one source file of a program.
type File struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

// Plan is what one request does in its scratch folder: the files to write, the compile command
// (nil for interpreted languages) and the command that runs the program.
type Plan struct {
	Files     []File
	Compile   []string
	CompileMs int
	// Prepare runs before the compile step, for example to seed a build cache.
	Prepare func(dir string) error
	Run     []string
	// RunAfterCompile picks the run command once the compiler has written its output, for
	// languages where the entry point is only known then (the class that holds main in Java).
	RunAfterCompile func(dir string) []string
}

// Language describes one language a runner image can serve.
type Language struct {
	// Source is the file name of a single-file program.
	Source string
	// Ext lists the accepted source file extensions.
	Ext []string
	// Env is added to the environment of both steps. {dir} is replaced by the scratch folder.
	Env []string
	// Pass names variables copied from the runner's own environment, such as JAVA_HOME.
	Pass []string
	Plan func(files []File) (Plan, error)
}

var languages = map[string]Language{
	"csharp": {
		Source: "Program.cs",
		Ext:    []string{".cs"},
		Env: []string{
			"DOTNET_CLI_TELEMETRY_OPTOUT=1", "DOTNET_NOLOGO=1", "DOTNET_EnableDiagnostics=0",
			"DOTNET_gcServer=0", "DOTNET_TieredPGO=0", "DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1",
		},
		Pass: []string{"DOTNET_ROOT"},
		Plan: planCSharp,
	},
	"java": {
		Source: "Main.java",
		Ext:    []string{".java"},
		Pass:   []string{"JAVA_HOME"},
		Plan:   planJava,
	},
	"kotlin": {
		Source: "Main.kt",
		Ext:    []string{".kt"},
		Pass:   []string{"JAVA_HOME", "KOTLIN_HOME"},
		Plan:   planKotlin,
	},
	"c": {
		Source: "main.c",
		Ext:    []string{".c", ".h"},
		Plan: func(files []File) (Plan, error) {
			args := []string{"gcc", "-std=gnu17", "-O2", "-pipe", "-Wall", "-fdiagnostics-color=never", "-o", "main"}
			args = append(args, sources(files, ".c")...)
			return Plan{Files: files, Compile: append(args, "-lm"), Run: []string{"./main"}}, nil
		},
	},
	"cpp": {
		Source: "main.cpp",
		Ext:    []string{".cpp", ".cc", ".h", ".hpp"},
		Plan: func(files []File) (Plan, error) {
			args := []string{"g++", "-std=gnu++23", "-O2", "-pipe", "-Wall", "-fdiagnostics-color=never", "-o", "main"}
			args = append(args, sources(files, ".cpp", ".cc")...)
			return Plan{Files: files, Compile: args, Run: []string{"./main"}}, nil
		},
	},
	"go": {
		Source: "main.go",
		Ext:    []string{".go"},
		Env: []string{
			"GOCACHE={dir}/.cache/go-build", "GOPATH={dir}/go", "GOENV=off", "GOFLAGS=-trimpath",
			"GOPROXY=off", "GOTOOLCHAIN=local", "CGO_ENABLED=0", "GOTELEMETRY=off",
		},
		Pass: []string{"GOROOT"},
		Plan: func(files []File) (Plan, error) {
			args := append([]string{"go", "build", "-o", "main"}, sources(files, ".go")...)
			return Plan{Files: files, Compile: args, Run: []string{"./main"}, Prepare: seedGoCache}, nil
		},
	},
	"rust": {
		Source: "main.rs",
		Ext:    []string{".rs"},
		Plan: func(files []File) (Plan, error) {
			if len(files) != 1 {
				return Plan{}, fmt.Errorf("a Rust program is one file, main.rs")
			}
			rustc := envOr("LINGO_RUSTC", "rustc")
			args := []string{rustc, "--edition", "2024", "-O", "-C", "debuginfo=1", "-o", "main", files[0].Name}
			return Plan{Files: files, Compile: args, Run: []string{"./main"}}, nil
		},
	},
	"ruby": script("main.rb", ".rb", "ruby", "-W1"),
	"php":  script("main.php", ".php", "php", "-d", "display_errors=stderr", "-d", "log_errors=0", "-d", "error_reporting=E_ALL", "-d", "memory_limit=256M"),
	"perl": script("main.pl", ".pl", "perl"),
	"lua":  script("main.lua", ".lua", "lua5.4"),
	"bash": script("main.sh", ".sh", "bash"),
}

// script is an interpreted language whose program is one file.
func script(source, ext string, interpreter ...string) Language {
	return Language{
		Source: source,
		Ext:    []string{ext},
		Plan: func(files []File) (Plan, error) {
			if len(files) != 1 {
				return Plan{}, fmt.Errorf("this language runs a single file")
			}
			return Plan{Files: files, Run: append(append([]string{}, interpreter...), files[0].Name)}, nil
		},
	}
}

// sources lists the files with one of the extensions, in request order.
func sources(files []File, exts ...string) []string {
	var names []string
	for _, file := range files {
		for _, ext := range exts {
			if strings.HasSuffix(file.Name, ext) {
				names = append(names, file.Name)
				break
			}
		}
	}
	return names
}

// reserve refuses learner files that would overwrite generated ones.
func reserve(files []File, names ...string) error {
	for _, file := range files {
		for _, name := range names {
			if strings.EqualFold(file.Name, name) {
				return fmt.Errorf("the file name %s is reserved", name)
			}
		}
	}
	return nil
}

// ---- C# ----

// The same namespaces as the implicit usings of a .NET console project.
const csGlobalUsings = `global using global::System;
global using global::System.Collections.Generic;
global using global::System.IO;
global using global::System.Linq;
global using global::System.Net.Http;
global using global::System.Threading;
global using global::System.Threading.Tasks;
`

func planCSharp(files []File) (Plan, error) {
	if err := reserve(files, "GlobalUsings.g.cs", "main.runtimeconfig.json"); err != nil {
		return Plan{}, err
	}
	tfm := envOr("LINGO_DOTNET_TFM", "net10.0")
	version := envOr("LINGO_DOTNET_VERSION", "10.0.0")
	config := fmt.Sprintf(`{"runtimeOptions":{"tfm":%q,"framework":{"name":"Microsoft.NETCore.App","version":%q},`+
		`"configProperties":{"System.GC.Server":false,"System.GC.Concurrent":false,"System.Globalization.Invariant":true}}}`,
		tfm, version)
	args := []string{
		"dotnet", envOr("LINGO_CSC", "/opt/lingo/roslyn/csc.dll"), "-noconfig", "-nologo",
		"@" + envOr("LINGO_CSC_RSP", "/opt/lingo/csc.rsp"), "-out:main.dll",
	}
	args = append(args, sources(files, ".cs")...)
	args = append(args, "GlobalUsings.g.cs")
	all := append(append([]File{}, files...),
		File{Name: "GlobalUsings.g.cs", Content: csGlobalUsings},
		File{Name: "main.runtimeconfig.json", Content: config})
	return Plan{Files: all, Compile: args, Run: []string{"dotnet", "main.dll"}}, nil
}

// ---- Java and Kotlin ----

var (
	javaPublicType = regexp.MustCompile(`(?m)^\s*public\s+(?:(?:final|abstract|sealed|non-sealed|strictfp|static)\s+)*(?:class|record|enum|interface)\s+([A-Za-z_$][\w$]*)`)
	javaTopType    = regexp.MustCompile(`(?m)^(?:(?:public|final|abstract|sealed|non-sealed|strictfp)\s+)*(?:class|record|enum|interface)\s+([A-Za-z_$][\w$]*)`)
	javaComments   = regexp.MustCompile(`(?s)/\*.*?\*/|//[^\n]*`)
)

func jvmOptions() []string {
	return []string{"-XX:+UseSerialGC", "-XX:TieredStopAtLevel=1", "-XX:-UsePerfData", "-Xshare:auto"}
}

func planJava(files []File) (Plan, error) {
	files = append([]File{}, files...)
	// A single file is named after its public class, so that class names need not match Main.
	if len(files) == 1 {
		if match := javaPublicType.FindStringSubmatch(javaComments.ReplaceAllString(files[0].Content, "")); match != nil {
			files[0].Name = match[1] + ".java"
		}
	}
	args := []string{"javac"}
	for _, option := range jvmOptions() {
		args = append(args, "-J"+option)
	}
	args = append(args, "-encoding", "UTF-8", "-g", "-Xlint:-options", "-d", "out")
	args = append(args, sources(files, ".java")...)
	return Plan{
		Files:   files,
		Compile: args,
		RunAfterCompile: func(dir string) []string {
			run := append([]string{"java"}, jvmOptions()...)
			run = append(run, "-Xmx"+envOr("LINGO_JAVA_HEAP", "256m"), "-Dfile.encoding=UTF-8",
				"-Dstdout.encoding=UTF-8", "-Djava.io.tmpdir=tmp", "-Duser.home=.", "-cp", "out",
				javaMainClass(dir, files))
			return run
		},
	}, nil
}

// javaMainClass picks the class to start: the first top-level type, in source order, whose class
// file holds a main method; then the public type; then Main (compact source files).
func javaMainClass(dir string, files []File) string {
	var candidates []string
	for _, file := range files {
		code := javaComments.ReplaceAllString(file.Content, "")
		for _, match := range javaTopType.FindAllStringSubmatch(code, -1) {
			candidates = append(candidates, match[1])
		}
	}
	for _, name := range candidates {
		if classHasMain(filepath.Join(dir, "out", name+".class")) {
			return name
		}
	}
	for _, file := range files {
		if match := javaPublicType.FindStringSubmatch(javaComments.ReplaceAllString(file.Content, "")); match != nil {
			return match[1]
		}
	}
	return "Main"
}

// classHasMain looks for the constant "main" in a class file. A class that only calls another
// class's main also has it, which is rare enough in lessons.
func classHasMain(path string) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	return bytes.Contains(data, []byte("\x00\x04main"))
}

func planKotlin(files []File) (Plan, error) {
	args := append([]string{"kotlinc"}, sources(files, ".kt")...)
	args = append(args, "-d", "out")
	stdlib := filepath.Join(envOr("KOTLIN_HOME", "/opt/kotlinc"), "lib", "kotlin-stdlib.jar")
	return Plan{
		Files:     files,
		Compile:   args,
		CompileMs: 60000,
		RunAfterCompile: func(dir string) []string {
			run := append([]string{"java"}, jvmOptions()...)
			run = append(run, "-Xmx"+envOr("LINGO_JAVA_HEAP", "256m"), "-Dfile.encoding=UTF-8",
				"-Dstdout.encoding=UTF-8", "-Djava.io.tmpdir=tmp", "-Duser.home=.",
				"-cp", "out:"+stdlib, kotlinMainClass(dir, files))
			return run
		},
	}, nil
}

// kotlinMainClass is the file class of the first source file with a main function (main.kt and
// Main.kt both become MainKt).
func kotlinMainClass(dir string, files []File) string {
	for _, file := range files {
		base := strings.TrimSuffix(file.Name, ".kt")
		if base == "" {
			continue
		}
		name := strings.ToUpper(base[:1]) + base[1:] + "Kt"
		if classHasMain(filepath.Join(dir, "out", name+".class")) {
			return name
		}
	}
	return "MainKt"
}

// ---- Go ----

// seedGoCache copies the build cache made when the image was built (the standard library
// packages lessons use) into the run's own cache, so a build compiles only the learner's code.
// The image copy is read-only and each run gets a fresh one, so no run can change another's.
func seedGoCache(dir string) error {
	seed := envOr("LINGO_GOCACHE_SEED", "")
	if seed == "" {
		return nil
	}
	if _, err := os.Stat(seed); err != nil {
		return nil
	}
	return copyTree(seed, filepath.Join(dir, ".cache", "go-build"))
}

func copyTree(from, to string) error {
	return filepath.WalkDir(from, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(from, path)
		if err != nil {
			return err
		}
		target := filepath.Join(to, rel)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o600)
	})
}
