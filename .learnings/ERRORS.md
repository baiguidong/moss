# Errors

Command failures and integration errors.

---

## [ERR-20260924-001] grep_tool_rg_missing

**Logged**: 2026-09-24T20:05:00+08:00
**Priority**: medium
**Status**: pending
**Area**: infra

### Summary
Moss Grep tool failed because bundled ripgrep binary was missing.

### Error
```
spawn /Users/bgd/repo/moss/bin/vendor/ripgrep/arm64-darwin/rg ENOENT
```

### Context
- Attempted to search the moss repository with the Grep tool.
- Fallback is to use git grep from the repository root for this investigation.

### Suggested Fix
Check vendor/ripgrep packaging or tool path resolution for the bin working directory.

### Metadata
- Reproducible: yes
- Related Files: bin/vendor/ripgrep/arm64-darwin/rg

---
