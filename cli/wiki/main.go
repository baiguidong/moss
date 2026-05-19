// Command wiki — Document Center CLI used by scode inside the moss runtime
// container. It speaks to moss-server via the agent-facing wiki API and
// authorises every call with SESSION_TOKEN (a short-lived JWT issued by
// moss-server when it spawned this scode session).
//
// Subcommands (kept intentionally small for P0):
//
//	wiki list                          # list wikis the current Assistant can access
//	wiki list --json
//	wiki read <wikiId>                 # read WIKI.md by default
//	wiki read <wikiId> --file <path>   # read a specific .md
//	wiki search <wikiId> <query>       # full-text grep across the wiki
//	wiki metadata <wikiId>             # wiki info (build time, doc count, chunks)
//
// Environment variables (set by moss-server when it spawns scode):
//
//	MOSS_SERVER_URL — base URL, e.g. http://moss-internal:43127
//	SESSION_TOKEN   — bearer token; embeds assistant_id + user_id + org_id
//
// The transport and formatting logic lives in the importable sub-package
// github.com/sudoprivacy/moss/cli/wiki/client — this file is only the
// moss-specific CLI shell around it.
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/sudoprivacy/moss/cli/wiki/client"
)

const (
	envServerURL = "MOSS_SERVER_URL"
	envToken     = "SESSION_TOKEN"
)

func main() {
	if len(os.Args) < 2 {
		printHelp(os.Stderr)
		os.Exit(2)
	}
	sub := os.Args[1]
	args := os.Args[2:]

	var err error
	switch sub {
	case "list":
		err = runList(args)
	case "read":
		err = runRead(args)
	case "search":
		err = runSearch(args)
	case "metadata":
		err = runMetadata(args)
	case "-h", "--help", "help":
		printHelp(os.Stdout)
		return
	default:
		fmt.Fprintf(os.Stderr, "wiki: unknown subcommand %q\n", sub)
		printHelp(os.Stderr)
		os.Exit(2)
	}

	if err != nil {
		fmt.Fprintf(os.Stderr, "wiki: %v\n", err)
		os.Exit(1)
	}
}

func printHelp(w io.Writer) {
	fmt.Fprintln(w, `wiki — Document Center CLI for use inside the scode runtime.

Usage:
  wiki list [--json]
  wiki read <wikiId> [--file <path>]
  wiki search <wikiId> <query>
  wiki metadata <wikiId>

Environment:
  MOSS_SERVER_URL  base URL of moss-server (set by moss-server when it
                   spawns scode)
  SESSION_TOKEN    bearer JWT with assistant_id/user_id/org_id claims
                   (set by moss-server when it spawns scode)`)
}

// newClient bootstraps a wiki client from the moss-provided env vars. The
// error messages are intentionally moss-specific — they direct the operator
// back to moss-server, which is responsible for spawning scode with these
// vars set.
func newClient() (*client.Client, error) {
	base := os.Getenv(envServerURL)
	if strings.TrimRight(base, "/") == "" {
		return nil, errors.New(envServerURL + " is not set; wiki CLI must be launched by moss-server")
	}
	token := os.Getenv(envToken)
	if token == "" {
		return nil, errors.New(envToken + " is not set; wiki CLI cannot authenticate")
	}
	return client.New(base, token), nil
}

// ============================================================
// list
// ============================================================

func runList(args []string) error {
	fs := flag.NewFlagSet("list", flag.ContinueOnError)
	jsonOut := fs.Bool("json", false, "output JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}
	c, err := newClient()
	if err != nil {
		return err
	}
	wikis, err := c.ListWikis()
	if err != nil {
		return err
	}
	if *jsonOut {
		// Match original behavior: marshal error is silently swallowed (the
		// fixed schema cannot fail to marshal in practice).
		_ = client.FormatWikiListJSON(os.Stdout, wikis)
		return nil
	}
	client.FormatWikiList(os.Stdout, wikis)
	return nil
}

// ============================================================
// read
// ============================================================

func runRead(args []string) error {
	fs := flag.NewFlagSet("read", flag.ContinueOnError)
	filePath := fs.String("file", "WIKI.md", "path inside the wiki dir (default: WIKI.md)")
	listFiles := fs.Bool("list", false, "list files in the wiki, do not read content")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("usage: wiki read <wikiId> [--file <path>] [--list]")
	}
	wikiID := fs.Arg(0)
	c, err := newClient()
	if err != nil {
		return err
	}
	if *listFiles {
		files, err := c.ListFiles(wikiID)
		if err != nil {
			return err
		}
		for _, f := range files {
			fmt.Println(f)
		}
		return nil
	}
	resp, err := c.ReadFile(wikiID, *filePath)
	if err != nil {
		return err
	}
	fmt.Print(resp.Content)
	if !strings.HasSuffix(resp.Content, "\n") {
		fmt.Println()
	}
	return nil
}

// ============================================================
// search
// ============================================================

func runSearch(args []string) error {
	fs := flag.NewFlagSet("search", flag.ContinueOnError)
	contextLines := fs.Int("context", 0, "lines of context around each match (P0: server-side ignored)")
	_ = contextLines
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 2 {
		return errors.New("usage: wiki search <wikiId> <query>")
	}
	wikiID := fs.Arg(0)
	query := strings.Join(fs.Args()[1:], " ")
	c, err := newClient()
	if err != nil {
		return err
	}
	resp, err := c.Search(wikiID, query)
	if err != nil {
		return err
	}
	client.FormatSearchMatches(os.Stdout, resp.Matches)
	return nil
}

// ============================================================
// metadata
// ============================================================

func runMetadata(args []string) error {
	if len(args) < 1 {
		return errors.New("usage: wiki metadata <wikiId>")
	}
	wikiID := args[0]
	c, err := newClient()
	if err != nil {
		return err
	}
	resp, err := c.Metadata(wikiID)
	if err != nil {
		return err
	}
	client.FormatMetadata(os.Stdout, resp)
	return nil
}
