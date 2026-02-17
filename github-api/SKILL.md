---
name: github-api
description: This skill should be used when the user asks to "interact with GitHub", "create a PR", "manage issues", "view GitHub checks", "work with releases", "manage repositories", or needs to automate GitHub workflows using the gh CLI.
allowed-tools: Bash, Read, Write, Glob, Grep
version: 0.1.0
---

# GitHub API Skill

Use the `gh` CLI for all GitHub operations. It handles authentication and provides a clean interface to the GitHub API.

## Authentication

Check auth status:
```bash
gh auth status
```

Login if needed:
```bash
gh auth login
```

## Pull Requests

### View PR
```bash
gh pr view <number>                    # Current repo
gh pr view <number> --repo owner/repo  # Specific repo
gh pr view <number> --json title,body,state,reviews,checks
```

### List PRs
```bash
gh pr list                             # Open PRs
gh pr list --state all                 # All PRs
gh pr list --author @me                # Your PRs
gh pr list --search "is:open draft:false"
```

### Create PR
```bash
gh pr create --title "Title" --body "Description"
gh pr create --fill                    # Use commit info
gh pr create --draft                   # Draft PR
gh pr create --base main --head feature-branch
```

### PR Actions
```bash
gh pr merge <number>                   # Merge
gh pr merge <number> --squash          # Squash merge
gh pr merge <number> --rebase          # Rebase merge
gh pr close <number>                   # Close
gh pr reopen <number>                  # Reopen
gh pr ready <number>                   # Mark ready for review
```

### PR Reviews
```bash
gh pr review <number> --approve
gh pr review <number> --request-changes --body "Please fix..."
gh pr review <number> --comment --body "Looks good"
```

### PR Checks
```bash
gh pr checks <number>                  # View CI status
gh pr checks <number> --watch          # Watch until complete
```

### PR Comments
```bash
gh api repos/{owner}/{repo}/pulls/<number>/comments
gh pr comment <number> --body "Comment text"
```

## Issues

### View Issue
```bash
gh issue view <number>
gh issue view <number> --json title,body,state,labels,assignees
```

### List Issues
```bash
gh issue list
gh issue list --assignee @me
gh issue list --label "bug"
gh issue list --state closed
gh issue list --search "is:open label:bug"
```

### Create Issue
```bash
gh issue create --title "Title" --body "Description"
gh issue create --label "bug,priority"
gh issue create --assignee username
```

### Issue Actions
```bash
gh issue close <number>
gh issue reopen <number>
gh issue edit <number> --title "New title"
gh issue edit <number> --add-label "label"
gh issue comment <number> --body "Comment"
```

## Repositories

### View Repo
```bash
gh repo view                           # Current repo
gh repo view owner/repo
gh repo view --json name,description,url,defaultBranchRef
```

### Clone/Create
```bash
gh repo clone owner/repo
gh repo create my-repo --public
gh repo create my-repo --private --clone
gh repo fork owner/repo --clone
```

### Repo Settings
```bash
gh repo edit --default-branch main
gh repo edit --visibility private
gh repo delete owner/repo --yes
```

## Releases

### List Releases
```bash
gh release list
gh release view <tag>
```

### Create Release
```bash
gh release create v1.0.0
gh release create v1.0.0 --title "Release 1.0" --notes "Changes..."
gh release create v1.0.0 --generate-notes
gh release create v1.0.0 ./dist/*      # Upload assets
```

### Release Actions
```bash
gh release download <tag>
gh release delete <tag> --yes
```

## Workflow Runs (Actions)

### List Runs
```bash
gh run list
gh run list --workflow=ci.yml
gh run list --status failure
```

### View Run
```bash
gh run view <run-id>
gh run view <run-id> --log
gh run view <run-id> --job=<job-id>
```

### Run Actions
```bash
gh run watch <run-id>                  # Watch live
gh run rerun <run-id>                  # Rerun failed
gh run cancel <run-id>
```

### Trigger Workflow
```bash
gh workflow run <workflow> --ref main
gh workflow run <workflow> -f param=value
```

## GitHub API Direct Access

For operations not covered by gh commands:

### GET Request
```bash
gh api repos/{owner}/{repo}
gh api repos/{owner}/{repo}/commits
gh api /user
```

### POST Request
```bash
gh api repos/{owner}/{repo}/issues -f title="Bug" -f body="Description"
```

### With JQ Processing
```bash
gh api repos/{owner}/{repo}/pulls --jq '.[].title'
gh api repos/{owner}/{repo}/issues --jq '.[] | {number, title, state}'
```

### Pagination
```bash
gh api repos/{owner}/{repo}/issues --paginate
gh api repos/{owner}/{repo}/commits --paginate --jq '.[].sha'
```

## Gists

```bash
gh gist list
gh gist view <id>
gh gist create file.txt --public
gh gist create file.txt --desc "Description"
gh gist edit <id>
gh gist delete <id>
```

## Search

```bash
gh search repos "language:python stars:>1000"
gh search issues "repo:owner/repo is:open label:bug"
gh search prs "author:username is:merged"
gh search code "function main" --repo owner/repo
```

## JSON Output

Most commands support `--json` for structured output:

```bash
gh pr view 123 --json number,title,state,author,labels
gh issue list --json number,title,assignees --jq '.[] | select(.assignees | length > 0)'
```

Common JSON fields:
- PRs: `number`, `title`, `body`, `state`, `author`, `labels`, `reviews`, `checks`, `mergeable`
- Issues: `number`, `title`, `body`, `state`, `author`, `labels`, `assignees`, `milestone`
- Repos: `name`, `description`, `url`, `defaultBranchRef`, `isPrivate`

## Environment Variables

- `GH_TOKEN`: Authentication token
- `GH_REPO`: Default repository (owner/repo format)
- `GH_HOST`: GitHub Enterprise hostname

## Tips

1. Use `--help` on any command for full options
2. Use `--json` + `--jq` for scripting
3. Use `@me` as shorthand for your username
4. Use `-R owner/repo` to target a different repo
5. Combine with standard Unix tools for complex operations
