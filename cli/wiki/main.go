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
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
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

// ============================================================
// HTTP helper
// ============================================================

type apiClient struct {
	baseURL string
	token   string
	http    *http.Client
}

func newClient() (*apiClient, error) {
	base := strings.TrimRight(os.Getenv(envServerURL), "/")
	if base == "" {
		return nil, errors.New(envServerURL + " is not set; wiki CLI must be launched by moss-server")
	}
	token := os.Getenv(envToken)
	if token == "" {
		return nil, errors.New(envToken + " is not set; wiki CLI cannot authenticate")
	}
	return &apiClient{
		baseURL: base,
		token:   token,
		http:    &http.Client{Timeout: 30 * time.Second},
	}, nil
}

func (c *apiClient) get(path string, out any) error {
	req, err := http.NewRequest(http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	return nil
}

// ============================================================
// Response types — mirror server JSON
// ============================================================

type wikiSummary struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	BuildStatus string `json:"buildStatus"`
}

type wikisListResp struct {
	Wikis []wikiSummary `json:"wikis"`
}

type wikiFilesResp struct {
	WikiID string   `json:"wiki_id"`
	Files  []string `json:"files"`
}

type wikiFileResp struct {
	WikiID  string `json:"wiki_id"`
	Path    string `json:"path"`
	Content string `json:"content"`
}

type searchMatch struct {
	File   string `json:"file"`
	LineNo int    `json:"line_no"`
	Line   string `json:"line"`
}

type searchResp struct {
	WikiID  string        `json:"wiki_id"`
	Query   string        `json:"query"`
	Matches []searchMatch `json:"matches"`
}

type metadataResp struct {
	WikiID              string `json:"wiki_id"`
	Name                string `json:"name"`
	Description         string `json:"description"`
	BuildStatus         string `json:"build_status"`
	LastBuiltAt         *int64 `json:"last_built_at"`
	SourceDocumentCount int    `json:"source_document_count"`
	ChunkCount          int    `json:"chunk_count"`
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
	var resp wikisListResp
	if err := c.get("/api/v1/agent/wikis", &resp); err != nil {
		return err
	}
	if *jsonOut {
		b, _ := json.MarshalIndent(resp.Wikis, "", "  ")
		fmt.Println(string(b))
		return nil
	}
	if len(resp.Wikis) == 0 {
		fmt.Println("(no wikis available to this assistant)")
		return nil
	}
	// Plain-text table for LLM consumption
	fmt.Printf("%-36s  %-30s  %s\n", "ID", "NAME", "DESCRIPTION")
	for _, w := range resp.Wikis {
		desc := w.Description
		if len(desc) > 80 {
			desc = desc[:77] + "..."
		}
		fmt.Printf("%-36s  %-30s  %s\n", w.ID, truncate(w.Name, 30), desc)
	}
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
		var resp wikiFilesResp
		if err := c.get("/api/v1/agent/wikis/"+url.PathEscape(wikiID)+"/files", &resp); err != nil {
			return err
		}
		for _, f := range resp.Files {
			fmt.Println(f)
		}
		return nil
	}
	var resp wikiFileResp
	endpoint := "/api/v1/agent/wikis/" + url.PathEscape(wikiID) + "/files/" + escapePath(*filePath)
	if err := c.get(endpoint, &resp); err != nil {
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
	q := url.Values{}
	q.Set("q", query)
	endpoint := "/api/v1/agent/wikis/" + url.PathEscape(wikiID) + "/search?" + q.Encode()
	var resp searchResp
	if err := c.get(endpoint, &resp); err != nil {
		return err
	}
	if len(resp.Matches) == 0 {
		fmt.Println("(no matches)")
		return nil
	}
	for _, m := range resp.Matches {
		fmt.Printf("%s:%d: %s\n", m.File, m.LineNo, strings.TrimRight(m.Line, "\r"))
	}
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
	var resp metadataResp
	if err := c.get("/api/v1/agent/wikis/"+url.PathEscape(wikiID)+"/metadata", &resp); err != nil {
		return err
	}
	fmt.Printf("Wiki ID:           %s\n", resp.WikiID)
	fmt.Printf("Name:              %s\n", resp.Name)
	if resp.Description != "" {
		fmt.Printf("Description:       %s\n", resp.Description)
	}
	fmt.Printf("Build status:      %s\n", resp.BuildStatus)
	if resp.LastBuiltAt != nil {
		fmt.Printf("Last built at:     %s\n", time.UnixMilli(*resp.LastBuiltAt).Format(time.RFC3339))
	} else {
		fmt.Println("Last built at:     never")
	}
	fmt.Printf("Source documents:  %d\n", resp.SourceDocumentCount)
	fmt.Printf("Chunks:            %d\n", resp.ChunkCount)
	return nil
}

// ============================================================
// helpers
// ============================================================

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	if n <= 1 {
		return "."
	}
	return s[:n-1] + "…"
}

// escapePath encodes each path segment but keeps "/" — so users can pass
// nested paths like `images/fig-001.png` without losing the structure.
func escapePath(p string) string {
	parts := strings.Split(p, "/")
	for i, seg := range parts {
		parts[i] = url.PathEscape(seg)
	}
	return strings.Join(parts, "/")
}
