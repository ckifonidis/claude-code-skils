#!/usr/bin/env node

/**
 * Azure DevOps CLI
 * Command-line interface for managing Azure DevOps boards
 */

import { readFileSync } from 'fs';
import { basename } from 'path';
import { WorkItemsClient } from './workItems.js';
import { BoardsClient } from './boards.js';
import { QueriesClient } from './queries.js';

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];
const subCommand = args[1];

// Parse flags and options
function parseArgs(args) {
  const options = {};
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('--')) {
        // Handle JSON values
        if (nextArg.startsWith('{') || nextArg.startsWith('[')) {
          try {
            options[key] = JSON.parse(nextArg);
          } catch {
            options[key] = nextArg;
          }
        } else if (nextArg === 'true') {
          options[key] = true;
        } else if (nextArg === 'false') {
          options[key] = false;
        } else if (!isNaN(nextArg)) {
          options[key] = Number(nextArg);
        } else {
          options[key] = nextArg;
        }
        i++;
      } else {
        options[key] = true;
      }
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  return { options, positional };
}

// Format output as JSON
function output(data) {
  console.log(JSON.stringify(data, null, 2));
}

// Format work item for display
function formatWorkItem(item) {
  const fields = item.fields || {};
  const result = {
    id: item.id,
    url: item.url,
    type: fields['System.WorkItemType'],
    title: fields['System.Title'],
    state: fields['System.State'],
    assignedTo: fields['System.AssignedTo']?.displayName || 'Unassigned',
    areaPath: fields['System.AreaPath'],
    iterationPath: fields['System.IterationPath'],
    createdDate: fields['System.CreatedDate'],
    changedDate: fields['System.ChangedDate'],
    description: fields['System.Description'],
    acceptanceCriteria: fields['Microsoft.VSTS.Common.AcceptanceCriteria'],
    tags: fields['System.Tags'],
  };

  // Include relations if present (when using --expand Relations)
  if (item.relations && item.relations.length > 0) {
    result.relations = item.relations.map(rel => ({
      type: rel.rel,
      url: rel.url,
      attributes: rel.attributes,
    }));
  }

  return result;
}

// Error handler
function handleError(error) {
  console.error(JSON.stringify({ error: error.message }, null, 2));
  process.exit(1);
}

// Print usage
function printUsage() {
  console.log(`
Azure DevOps CLI - Manage work items, boards, and sprints

USAGE:
  node cli.js <command> <subcommand> [options]

ENVIRONMENT VARIABLES (required):
  AZDO_ORGANIZATION  - Azure DevOps organization name
  AZDO_PROJECT       - Project name
  AZDO_PAT           - Personal Access Token
  AZDO_TEAM          - Team name (optional, defaults to "<project> Team")

COMMANDS:

  work-item (wi)
    list                     List work items
      --type <type>          Filter by type (Task, Bug, User Story, etc.)
      --state <state>        Filter by state (New, Active, Closed, etc.)
      --assignedTo <user>    Filter by assigned user
      --areaPath <path>      Filter by area path
      --iterationPath <path> Filter by iteration path
      --top <n>              Limit results (default: 100)

    get <id>                 Get a work item by ID
      --expand <level>       Expand relations (None, Relations, Fields, Links, All)

    create <type>            Create a work item
      --title <title>        Work item title (required)
      --description <md>     Description (Markdown supported)
      --acceptanceCriteria <md>  Acceptance criteria (Markdown supported)
      --assignedTo <user>    Assign to user
      --areaPath <path>      Area path
      --iterationPath <path> Iteration path
      --tags <tags>          Comma-separated tags
      --fields <json>        Additional fields as JSON

    update <id>              Update a work item
      --title <title>        New title
      --state <state>        New state
      --assignedTo <user>    New assignee
      --description <md>     New description (Markdown supported)
      --acceptanceCriteria <md>  Acceptance criteria (Markdown supported)
      --fields <json>        Fields to update as JSON

    link <id> <targetId>     Link work items
      --type <relation>      Relation type (default: parent link)
                             Common types:
                               System.LinkTypes.Hierarchy-Reverse (child->parent)
                               System.LinkTypes.Hierarchy-Forward (parent->child)
                               System.LinkTypes.Related (related)

    delete <id>              Delete a work item
      --destroy              Permanently delete (skip recycle bin)

    comment <id>             Add or list comments
      --add <text>           Add a comment

    query <wiql>             Run a WIQL query

    types                    List available work item types
    states <type>            List states for a work item type

    attach <id> <file>       Attach a file to a work item
      --name <name>          Custom file name (default: original filename)
      --comment <text>       Attachment comment

    attachments <id>         List attachments on a work item

  board
    list                     List all boards
    get <name>               Get a board by name
    columns <name>           Get board columns
    rows <name>              Get board rows (swimlanes)

  iteration (sprint)
    list                     List all iterations
      --timeframe <t>        Filter: current, past, future
    current                  Get current iteration
    get <id>                 Get iteration details
    work-items <id>          Get iteration work items
    capacity <id>            Get team capacity

    create                   Create a single iteration
      --name <name>          Iteration name (required)
      --startDate <date>     Start date YYYY-MM-DD (required)
      --finishDate <date>    End date YYYY-MM-DD (required)
      --path <path>          Parent path for nesting (optional)
      --addToTeam            Add to current team (default: true)

    update <path>            Update an iteration's dates
      --startDate <date>     New start date YYYY-MM-DD (required)
      --finishDate <date>    New end date YYYY-MM-DD (required)
      --name <name>          New name (optional)

    generate                 Generate multiple sprints
      --startDate <date>     First sprint start date (default: today)
      --endDate <date>       Generate until this date (default: 1 year)
      --weeks <n>            Sprint duration in weeks (default: 2)
      --prefix <name>        Sprint name prefix (default: "Sprint")
      --startNumber <n>      Starting sprint number (default: 1)
      --path <path>          Parent path for nesting (optional)
      --noTeam               Don't add iterations to team

    add-to-team <id>         Add existing iteration to team
    remove-from-team <id>    Remove iteration from team

  area
    list                     List area paths
      --depth <n>            Depth of tree (default: 2)

  query
    list                     List saved queries
      --folder <path>        Folder path
    get <id>                 Get query details
    run <id>                 Run a saved query
    shared                   List shared queries
    my                       List my queries

  team
    members                  List team members
    settings                 Get team settings

EXAMPLES:
  # List all active bugs
  node cli.js wi list --type Bug --state Active

  # Create a task
  node cli.js wi create Task --title "Fix login bug" --assignedTo "john@example.com"

  # Update work item state
  node cli.js wi update 123 --state "In Progress"

  # Get current sprint
  node cli.js iteration current

  # Run a WIQL query
  node cli.js wi query "SELECT [System.Id] FROM WorkItems WHERE [System.State] = 'New'"
`);
}

// Main execution
async function main() {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

  const { options, positional } = parseArgs(args.slice(2));

  try {
    switch (command) {
      case 'work-item':
      case 'wi': {
        const client = new WorkItemsClient();
        switch (subCommand) {
          case 'list': {
            const items = await client.list({
              type: options.type,
              state: options.state,
              assignedTo: options.assignedTo,
              areaPath: options.areaPath,
              iterationPath: options.iterationPath,
              top: options.top || 100,
            });
            output(items.map(formatWorkItem));
            break;
          }
          case 'get': {
            const id = positional[0];
            if (!id) throw new Error('Work item ID required');
            const item = await client.get(id, null, options.expand);
            output(formatWorkItem(item));
            break;
          }
          case 'create': {
            const type = positional[0];
            if (!type) throw new Error('Work item type required');
            if (!options.title) throw new Error('Title required (--title)');

            const fields = {
              'System.Title': options.title,
              ...(options.description && { 'System.Description': options.description }),
              ...(options.acceptanceCriteria && { 'Microsoft.VSTS.Common.AcceptanceCriteria': options.acceptanceCriteria }),
              ...(options.assignedTo && { 'System.AssignedTo': options.assignedTo }),
              ...(options.areaPath && { 'System.AreaPath': options.areaPath }),
              ...(options.iterationPath && { 'System.IterationPath': options.iterationPath }),
              ...(options.tags && { 'System.Tags': options.tags }),
              ...(options.fields || {}),
            };

            const item = await client.create(type, fields);
            output(formatWorkItem(item));
            break;
          }
          case 'update': {
            const id = positional[0];
            if (!id) throw new Error('Work item ID required');

            const fields = {
              ...(options.title && { 'System.Title': options.title }),
              ...(options.state && { 'System.State': options.state }),
              ...(options.assignedTo && { 'System.AssignedTo': options.assignedTo }),
              ...(options.description && { 'System.Description': options.description }),
              ...(options.acceptanceCriteria && { 'Microsoft.VSTS.Common.AcceptanceCriteria': options.acceptanceCriteria }),
              ...(options.areaPath && { 'System.AreaPath': options.areaPath }),
              ...(options.iterationPath && { 'System.IterationPath': options.iterationPath }),
              ...(options.tags && { 'System.Tags': options.tags }),
              ...(options.fields || {}),
            };

            if (Object.keys(fields).length === 0) {
              throw new Error('No fields to update. Use --title, --state, --assignedTo, --acceptanceCriteria, etc.');
            }

            const item = await client.update(id, fields);
            output(formatWorkItem(item));
            break;
          }
          case 'delete': {
            const id = positional[0];
            if (!id) throw new Error('Work item ID required');
            await client.delete(id, options.destroy);
            output({ success: true, message: `Work item ${id} deleted` });
            break;
          }
          case 'comment': {
            const id = positional[0];
            if (!id) throw new Error('Work item ID required');
            if (options.add) {
              const comment = await client.addComment(id, options.add);
              output(comment);
            } else {
              const comments = await client.getComments(id);
              output(comments);
            }
            break;
          }
          case 'query': {
            const wiql = positional[0];
            if (!wiql) throw new Error('WIQL query required');
            const result = await client.query(wiql);
            output(result.workItems ? result.workItems.map(formatWorkItem) : result);
            break;
          }
          case 'types': {
            const types = await client.getTypes();
            output(types.value.map(t => ({ name: t.name, description: t.description })));
            break;
          }
          case 'link': {
            const id = positional[0];
            const targetId = positional[1];
            if (!id || !targetId) throw new Error('Usage: wi link <id> <targetId> --type <relation-type>');

            // Default to parent link (child -> parent)
            const relationType = options.type || 'System.LinkTypes.Hierarchy-Reverse';
            await client.addLink(id, relationType, targetId);
            output({ success: true, message: `Linked work item ${id} to ${targetId} (${relationType})` });
            break;
          }
          case 'states': {
            const type = positional[0];
            if (!type) throw new Error('Work item type required');
            const states = await client.getStates(type);
            output(states.value);
            break;
          }
          case 'attach': {
            const id = positional[0];
            const filePath = positional[1];
            if (!id) throw new Error('Work item ID required');
            if (!filePath) throw new Error('File path required');

            const fileBuffer = readFileSync(filePath);
            const fileName = options.name || basename(filePath);
            const comment = options.comment || `Technical Design: ${fileName}`;

            const item = await client.addAttachment(id, fileBuffer, fileName, comment);
            output({ success: true, message: `Attachment "${fileName}" added to work item ${id}`, workItem: formatWorkItem(item) });
            break;
          }
          case 'attachments': {
            const id = positional[0];
            if (!id) throw new Error('Work item ID required');
            const attachments = await client.getAttachments(id);
            output(attachments);
            break;
          }
          default:
            throw new Error(`Unknown work-item subcommand: ${subCommand}`);
        }
        break;
      }

      case 'board': {
        const client = new BoardsClient();
        switch (subCommand) {
          case 'list': {
            const boards = await client.listBoards();
            output(boards.value);
            break;
          }
          case 'get': {
            const name = positional[0];
            if (!name) throw new Error('Board name required');
            const board = await client.getBoard(name);
            output(board);
            break;
          }
          case 'columns': {
            const name = positional[0];
            if (!name) throw new Error('Board name required');
            const columns = await client.getColumns(name);
            output(columns.value);
            break;
          }
          case 'rows': {
            const name = positional[0];
            if (!name) throw new Error('Board name required');
            const rows = await client.getRows(name);
            output(rows.value);
            break;
          }
          default:
            throw new Error(`Unknown board subcommand: ${subCommand}`);
        }
        break;
      }

      case 'iteration':
      case 'sprint': {
        const client = new BoardsClient();
        switch (subCommand) {
          case 'list': {
            const iterations = await client.listIterations(options.timeframe);
            output(iterations.value);
            break;
          }
          case 'current': {
            const iteration = await client.getCurrentIteration();
            output(iteration);
            break;
          }
          case 'get': {
            const id = positional[0];
            if (!id) throw new Error('Iteration ID required');
            const iteration = await client.getIteration(id);
            output(iteration);
            break;
          }
          case 'work-items': {
            const id = positional[0];
            if (!id) throw new Error('Iteration ID required');
            const items = await client.getIterationWorkItems(id);
            output(items);
            break;
          }
          case 'capacity': {
            const id = positional[0];
            if (!id) throw new Error('Iteration ID required');
            const capacity = await client.getCapacity(id);
            output(capacity);
            break;
          }
          case 'create': {
            if (!options.name) throw new Error('Iteration name required (--name)');
            if (!options.startDate) throw new Error('Start date required (--startDate YYYY-MM-DD)');
            if (!options.finishDate) throw new Error('Finish date required (--finishDate YYYY-MM-DD)');

            const iteration = await client.createIteration(
              options.name,
              options.startDate,
              options.finishDate,
              options.path || null
            );

            // Add to team by default unless explicitly disabled
            if (options.addToTeam !== false && iteration.identifier) {
              await client.addIterationToTeam(iteration.identifier);
            }

            output({
              success: true,
              name: options.name,
              startDate: options.startDate,
              finishDate: options.finishDate,
              id: iteration.identifier,
              path: iteration.path,
              addedToTeam: options.addToTeam !== false,
            });
            break;
          }
          case 'update': {
            const path = positional[0];
            if (!path) throw new Error('Iteration path required (e.g., "Test Sprint 1")');
            if (!options.startDate) throw new Error('Start date required (--startDate YYYY-MM-DD)');
            if (!options.finishDate) throw new Error('Finish date required (--finishDate YYYY-MM-DD)');

            const iteration = await client.updateIteration(
              path,
              options.startDate,
              options.finishDate,
              options.name || null
            );

            output({
              success: true,
              path: path,
              startDate: options.startDate,
              finishDate: options.finishDate,
              newName: options.name || null,
              result: iteration,
            });
            break;
          }
          case 'generate': {
            // Default start date is today
            const startDate = options.startDate || new Date().toISOString().split('T')[0];

            // Default end date is 1 year from start
            let endDate = options.endDate;
            if (!endDate) {
              const end = new Date(startDate);
              end.setFullYear(end.getFullYear() + 1);
              endDate = end.toISOString().split('T')[0];
            }

            const results = await client.generateIterations({
              startDate,
              endDate,
              durationWeeks: options.weeks || 2,
              namePrefix: options.prefix || 'Sprint',
              startNumber: options.startNumber || 1,
              addToTeam: !options.noTeam,
              path: options.path || null,
            });

            const successful = results.filter(r => r.success).length;
            const failed = results.filter(r => !r.success).length;

            output({
              summary: {
                total: results.length,
                successful,
                failed,
                startDate,
                endDate,
                durationWeeks: options.weeks || 2,
              },
              iterations: results,
            });
            break;
          }
          case 'add-to-team': {
            const id = positional[0];
            if (!id) throw new Error('Iteration ID required');
            const result = await client.addIterationToTeam(id);
            output({ success: true, message: `Iteration ${id} added to team`, result });
            break;
          }
          case 'remove-from-team': {
            const id = positional[0];
            if (!id) throw new Error('Iteration ID required');
            await client.removeIterationFromTeam(id);
            output({ success: true, message: `Iteration ${id} removed from team` });
            break;
          }
          case 'delete': {
            const path = positional[0];
            if (!path) throw new Error('Iteration path required (e.g., "Test Sprint 1")');
            await client.deleteIteration(path);
            output({ success: true, message: `Iteration "${path}" deleted from project` });
            break;
          }
          case 'paths': {
            const iterationPaths = await client.listIterationPaths(options.depth || 2);
            output(iterationPaths);
            break;
          }
          default:
            throw new Error(`Unknown iteration subcommand: ${subCommand}`);
        }
        break;
      }

      case 'area': {
        const client = new BoardsClient();
        switch (subCommand) {
          case 'list': {
            const areas = await client.listAreaPaths(options.depth || 2);
            output(areas);
            break;
          }
          default:
            throw new Error(`Unknown area subcommand: ${subCommand}`);
        }
        break;
      }

      case 'query': {
        const client = new QueriesClient();
        switch (subCommand) {
          case 'list': {
            const queries = await client.list(options.folder);
            output(queries);
            break;
          }
          case 'get': {
            const id = positional[0];
            if (!id) throw new Error('Query ID or path required');
            const query = await client.get(id);
            output(query);
            break;
          }
          case 'run': {
            const id = positional[0];
            if (!id) throw new Error('Query ID or path required');
            const result = await client.run(id);
            output(result.workItems ? result.workItems.map(formatWorkItem) : result);
            break;
          }
          case 'shared': {
            const queries = await client.getSharedQueries(options.depth || 2);
            output(queries);
            break;
          }
          case 'my': {
            const queries = await client.getMyQueries(options.depth || 2);
            output(queries);
            break;
          }
          default:
            throw new Error(`Unknown query subcommand: ${subCommand}`);
        }
        break;
      }

      case 'team': {
        const client = new BoardsClient();
        switch (subCommand) {
          case 'members': {
            const members = await client.getTeamMembers();
            output(members.value);
            break;
          }
          case 'settings': {
            const settings = await client.getTeamSettings();
            output(settings);
            break;
          }
          default:
            throw new Error(`Unknown team subcommand: ${subCommand}`);
        }
        break;
      }

      default:
        throw new Error(`Unknown command: ${command}. Run with --help for usage.`);
    }
  } catch (error) {
    handleError(error);
  }
}

main();
