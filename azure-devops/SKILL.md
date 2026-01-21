---
name: azure-devops
description: Manage Azure DevOps boards, work items, sprints, and queries. Use when working with Azure DevOps tickets, creating/updating work items, viewing backlogs, managing sprints, or querying boards.
allowed-tools: Bash
---

# Azure DevOps Boards Management

This skill provides a CLI tool to manage Azure DevOps boards, work items, sprints, and queries.

## Configuration

### Option 1: .env file (Recommended)

Create a `.env` file in the skill directory:

```bash
cp ~/.claude/skills/azure-devops/.env.example ~/.claude/skills/azure-devops/.env
```

Edit `~/.claude/skills/azure-devops/.env`:

```
AZDO_ORGANIZATION=your-org-name
AZDO_PROJECT=your-project
AZDO_PAT=your-personal-access-token
AZDO_TEAM=Your Team Name
```

### Option 2: Environment Variables

Alternatively, set these environment variables:

```bash
export AZDO_ORGANIZATION="your-org-name"   # Required: Organization name (from dev.azure.com/your-org-name)
export AZDO_PROJECT="your-project"          # Required: Project name
export AZDO_PAT="your-personal-access-token" # Required: PAT with Work Items read/write scope
export AZDO_TEAM="Your Team Name"           # Optional: Defaults to "<project> Team"
```

**Note:** The `.env` file takes precedence over environment variables.

## CLI Location

```bash
~/.claude/skills/azure-devops/src/cli.js
```

## Quick Reference

### Work Items

```bash
# List work items
node ~/.claude/skills/azure-devops/src/cli.js wi list
node ~/.claude/skills/azure-devops/src/cli.js wi list --type Bug --state Active
node ~/.claude/skills/azure-devops/src/cli.js wi list --assignedTo "user@example.com"
node ~/.claude/skills/azure-devops/src/cli.js wi list --iterationPath "Project\\Sprint 1"

# Get a work item
node ~/.claude/skills/azure-devops/src/cli.js wi get 123
node ~/.claude/skills/azure-devops/src/cli.js wi get 123 --expand Relations

# Create a work item
node ~/.claude/skills/azure-devops/src/cli.js wi create Task --title "Fix login bug"
node ~/.claude/skills/azure-devops/src/cli.js wi create Bug --title "Crash on startup" --description "App crashes when..." --assignedTo "user@example.com"
node ~/.claude/skills/azure-devops/src/cli.js wi create "User Story" --title "As a user I want to..." --tags "frontend,priority"

# Create with markdown description and acceptance criteria (RECOMMENDED)
node ~/.claude/skills/azure-devops/src/cli.js wi create "User Story" --title "Feature X" \
  --description "## Overview
User needs to do X.

## Details
- Point 1
- Point 2" \
  --acceptanceCriteria "- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3"

# Create with area and iteration (REQUIRED for board visibility)
node ~/.claude/skills/azure-devops/src/cli.js wi create "User Story" --title "Feature Y" \
  --areaPath "Project\\Team Name" \
  --iterationPath "Project\\Sprint 1"

# Update a work item
node ~/.claude/skills/azure-devops/src/cli.js wi update 123 --state "In Progress"
node ~/.claude/skills/azure-devops/src/cli.js wi update 123 --title "New title" --assignedTo "other@example.com"
node ~/.claude/skills/azure-devops/src/cli.js wi update 123 --acceptanceCriteria "- [ ] Updated criterion 1
- [ ] Updated criterion 2"

# Link work items (parent/child relationships)
node ~/.claude/skills/azure-devops/src/cli.js wi link 456 123                    # Link 456 as child of 123 (default)
node ~/.claude/skills/azure-devops/src/cli.js wi link 456 123 --type "System.LinkTypes.Hierarchy-Reverse"  # Explicit child->parent
node ~/.claude/skills/azure-devops/src/cli.js wi link 456 789 --type "System.LinkTypes.Related"            # Related items

# Delete a work item
node ~/.claude/skills/azure-devops/src/cli.js wi delete 123

# Comments
node ~/.claude/skills/azure-devops/src/cli.js wi comment 123 --add "This is a comment"
node ~/.claude/skills/azure-devops/src/cli.js wi comment 123  # List comments

# Work item types and states
node ~/.claude/skills/azure-devops/src/cli.js wi types
node ~/.claude/skills/azure-devops/src/cli.js wi states Bug

# Attachments
node ~/.claude/skills/azure-devops/src/cli.js wi attach 123 ./technical-design.md
node ~/.claude/skills/azure-devops/src/cli.js wi attach 123 ./design.md --name "Technical Design v1.0.md" --comment "Initial technical design"
node ~/.claude/skills/azure-devops/src/cli.js wi attachments 123  # List attachments
```

### WIQL Queries

```bash
# Run a WIQL query
node ~/.claude/skills/azure-devops/src/cli.js wi query "SELECT [System.Id], [System.Title] FROM WorkItems WHERE [System.State] = 'New'"

# Complex query
node ~/.claude/skills/azure-devops/src/cli.js wi query "SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.State] <> 'Closed' ORDER BY [System.ChangedDate] DESC"
```

### Boards

```bash
# List boards
node ~/.claude/skills/azure-devops/src/cli.js board list

# Get board details
node ~/.claude/skills/azure-devops/src/cli.js board get Stories
node ~/.claude/skills/azure-devops/src/cli.js board columns Stories
node ~/.claude/skills/azure-devops/src/cli.js board rows Stories
```

### Iterations (Sprints)

```bash
# List iterations
node ~/.claude/skills/azure-devops/src/cli.js iteration list
node ~/.claude/skills/azure-devops/src/cli.js iteration list --timeframe current
node ~/.claude/skills/azure-devops/src/cli.js iteration list --timeframe future

# Current sprint
node ~/.claude/skills/azure-devops/src/cli.js iteration current

# Sprint work items
node ~/.claude/skills/azure-devops/src/cli.js iteration work-items <iteration-id>

# Create a single iteration (sprint)
node ~/.claude/skills/azure-devops/src/cli.js iteration create --name "Sprint 1" --startDate 2025-01-07 --finishDate 2025-01-20
node ~/.claude/skills/azure-devops/src/cli.js iteration create --name "Sprint 1" --startDate 2025-01-07 --finishDate 2025-01-20 --path "Release 1"

# Generate multiple sprints automatically (Scrum board setup)
# Default: 2-week sprints for 1 year, added to current team
node ~/.claude/skills/azure-devops/src/cli.js iteration generate
node ~/.claude/skills/azure-devops/src/cli.js iteration generate --startDate 2025-01-07 --endDate 2026-01-07
node ~/.claude/skills/azure-devops/src/cli.js iteration generate --weeks 2 --prefix "Sprint" --startNumber 1
node ~/.claude/skills/azure-devops/src/cli.js iteration generate --weeks 3 --prefix "Iteration" --path "2025"

# Generate sprints without adding to team
node ~/.claude/skills/azure-devops/src/cli.js iteration generate --noTeam

# Add/remove iterations from team settings
node ~/.claude/skills/azure-devops/src/cli.js iteration add-to-team <iteration-id>
node ~/.claude/skills/azure-devops/src/cli.js iteration remove-from-team <iteration-id>
```

### Areas

```bash
# List area paths
node ~/.claude/skills/azure-devops/src/cli.js area list
node ~/.claude/skills/azure-devops/src/cli.js area list --depth 3
```

### Saved Queries

```bash
# List queries
node ~/.claude/skills/azure-devops/src/cli.js query list
node ~/.claude/skills/azure-devops/src/cli.js query shared
node ~/.claude/skills/azure-devops/src/cli.js query my

# Run a saved query
node ~/.claude/skills/azure-devops/src/cli.js query run "Shared Queries/Active Bugs"
node ~/.claude/skills/azure-devops/src/cli.js query run <query-guid>
```

### Team

```bash
# Team information
node ~/.claude/skills/azure-devops/src/cli.js team members
node ~/.claude/skills/azure-devops/src/cli.js team settings
```

## Common Work Item Types

- **Epic** - Large feature or initiative
- **Feature** - Product feature
- **User Story** - User-facing functionality
- **Task** - Development task
- **Bug** - Defect to fix
- **Issue** - Problem or impediment

## Common States

- **New** - Not started
- **Active** / **In Progress** - Being worked on
- **Resolved** - Completed, awaiting verification
- **Closed** - Done
- **Removed** - Deleted/cancelled

## WIQL Reference

WIQL (Work Item Query Language) is similar to SQL:

```sql
SELECT [System.Id], [System.Title], [System.State]
FROM WorkItems
WHERE [System.TeamProject] = 'MyProject'
  AND [System.WorkItemType] = 'Bug'
  AND [System.State] <> 'Closed'
  AND [System.AssignedTo] = @Me
ORDER BY [System.CreatedDate] DESC
```

### Common Fields

| Field | Description |
|-------|-------------|
| `System.Id` | Work item ID |
| `System.Title` | Title |
| `System.State` | Current state |
| `System.AssignedTo` | Assigned user |
| `System.WorkItemType` | Type (Bug, Task, etc.) |
| `System.AreaPath` | Area path |
| `System.IterationPath` | Sprint/iteration |
| `System.CreatedDate` | Creation date |
| `System.ChangedDate` | Last modified date |
| `System.Tags` | Tags |
| `System.Description` | Description (supports Markdown) |
| `Microsoft.VSTS.Common.AcceptanceCriteria` | Acceptance criteria (supports Markdown, User Stories) |

### WIQL Operators

- `=`, `<>`, `<`, `>`, `<=`, `>=`
- `CONTAINS`, `NOT CONTAINS`
- `IN`, `NOT IN`
- `UNDER` (for paths)
- `@Me` - Current user
- `@Today` - Today's date

## Output Format

All commands output JSON for easy parsing. Work items are formatted as:

```json
{
  "id": 123,
  "type": "User Story",
  "title": "Fix login issue",
  "state": "Active",
  "assignedTo": "John Doe",
  "areaPath": "Project\\Area",
  "iterationPath": "Project\\Sprint 1",
  "createdDate": "2024-01-15T10:00:00Z",
  "changedDate": "2024-01-16T14:30:00Z",
  "description": "## Overview\nUser story description...",
  "acceptanceCriteria": "- [ ] Criterion 1\n- [ ] Criterion 2",
  "tags": "frontend; priority"
}
```

## Markdown Formatting

**Always use Markdown** for description and acceptance criteria fields. Azure DevOps renders Markdown properly.

### Description Example
```markdown
## Summary
Brief overview of the feature.

## Details
- Key point 1
- Key point 2

## Context
Background information if needed.
```

### Acceptance Criteria Example
```markdown
- [ ] User can perform action X
- [ ] System displays confirmation message
- [ ] Error is shown when validation fails
- [ ] Data is persisted correctly
```

## Troubleshooting

### Work Item Not Visible on Board
For a work item to appear on a team's board, it must have:
- **Area Path**: Set to the team's area (e.g., `Project\Team Name`)
- **Iteration Path**: Set to an iteration the team is tracking (e.g., `Project\Sprint 1`)

Use `area list` and `iteration list` to find valid paths for your team.

### Authentication Error
Ensure your PAT has the correct scopes:
- **Work Items**: Read & Write
- **Project and Team**: Read

### 404 Not Found
- Check organization and project names are correct
- Verify the work item ID exists
- Ensure team name matches (case-sensitive)

### Permission Denied
- Your PAT may have expired
- You may not have access to the project/area
