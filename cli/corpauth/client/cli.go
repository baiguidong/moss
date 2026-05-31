package client

import (
	"flag"
	"fmt"
	"io"
	"os"
)

// RunOptions tunes the CLI presentation. All fields are optional.
type RunOptions struct {
	// ProgName is the prefix in error messages ("<prog>: ..."). Defaults to
	// "corpauth" if empty.
	ProgName string
	// HelpText is printed for help/--help/-h, after "unknown subcommand", and
	// when no subcommand is given. A generic default is used if empty.
	HelpText string
	// Stdout / Stderr default to os.Stdout / os.Stderr if nil.
	Stdout io.Writer
	Stderr io.Writer
}

const defaultHelpText = `corpauth — Corp Auth CLI.

Usage:
  corpauth token [--json]`

// Run dispatches a corpauth invocation and returns the process exit code:
//
//	0  success
//	1  request error (HTTP failure, missing args, etc.)
//	2  usage error (no subcommand, unknown subcommand)
//
// Run never calls os.Exit; the caller decides.
func Run(args []string, c *Client, opts RunOptions) int {
	if opts.ProgName == "" {
		opts.ProgName = "corpauth"
	}
	if opts.Stdout == nil {
		opts.Stdout = os.Stdout
	}
	if opts.Stderr == nil {
		opts.Stderr = os.Stderr
	}

	if len(args) < 1 {
		printHelp(opts.Stderr, opts)
		return 2
	}
	sub := args[0]
	rest := args[1:]

	var err error
	switch sub {
	case "token":
		err = runToken(rest, c, opts)
	case "-h", "--help", "help":
		printHelp(opts.Stdout, opts)
		return 0
	default:
		fmt.Fprintf(opts.Stderr, "%s: unknown subcommand %q\n", opts.ProgName, sub)
		printHelp(opts.Stderr, opts)
		return 2
	}

	if err != nil {
		fmt.Fprintf(opts.Stderr, "%s: %v\n", opts.ProgName, err)
		return 1
	}
	return 0
}

func printHelp(w io.Writer, opts RunOptions) {
	body := opts.HelpText
	if body == "" {
		body = defaultHelpText
	}
	fmt.Fprintln(w, body)
}

// ============================================================
// token
// ============================================================

func runToken(args []string, c *Client, opts RunOptions) error {
	fs := flag.NewFlagSet("token", flag.ContinueOnError)
	jsonOut := fs.Bool("json", false, "output JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}
	resp, err := c.GetToken()
	if err != nil {
		return err
	}
	if *jsonOut {
		return FormatTokenJSON(opts.Stdout, resp)
	}
	FormatToken(opts.Stdout, resp)
	return nil
}
