---
name: postmortem
description: Generate a post-mortem PDF report for any reverted or failed commit. Use when you need to analyze what went wrong with a commit.
---

# Postmortem - Incident Analysis Reports

Generate a PDF post-mortem report for any commit that was reverted, failed, or caused issues. The report includes commit metadata, agent activity trace, file diffs, revert detection, and a root cause analysis template.

## When to Use

- After a commit is reverted (manually or by the health daemon)
- When investigating a failed deployment or broken build
- When a commit caused unexpected issues that need documenting
- When the user asks for a post-mortem or incident report

## Commands

### Generate report
```bash
./tools/postmortem <commit-hash>
```

### Custom output path
```bash
./tools/postmortem <commit-hash> -o /path/to/output.pdf
```

## Output

- Default location: `.soren/journal/supervisor/YYYY-MM-DD/artifacts/postmortem-<hash>.pdf`
- Contains 7 sections: summary, revert status, files changed, agent activity, diff, root cause analysis, timeline

## Tips

- Use the short or full commit hash — both work
- The tool auto-queries the agent events API to correlate agent activity
- Root cause analysis section has fill-in-the-blank fields — edit the PDF or add findings to the journal
