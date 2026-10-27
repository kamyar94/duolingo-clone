// Built once when the image is made, so the standard library packages that lessons use are in
// the image's build cache. It is never run.
package main

import (
	"bufio"
	"bytes"
	"container/heap"
	"container/list"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"math"
	"math/big"
	"math/rand/v2"
	"net"
	"os"
	"os/exec"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

var (
	_ = bufio.NewReader
	_ = bytes.NewBuffer
	_ = heap.Init
	_ = list.New
	_ = json.Marshal
	_ = errors.New
	_ = fmt.Println
	_ = maps.Keys[map[int]int]
	_ = math.Sqrt
	_ = big.NewInt
	_ = rand.IntN
	_ = net.Dial
	_ = os.Exit
	_ = exec.Command
	_ = regexp.MustCompile
	_ = slices.Sort[[]int]
	_ = sort.Ints
	_ = strconv.Itoa
	_ = strings.Fields
	_ = sync.NewCond
	_ = time.Now
	_ = unicode.IsLetter
	_ = utf8.RuneLen
)

func main() {}
