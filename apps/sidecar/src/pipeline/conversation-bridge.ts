import { getConversationState } from "../conversation/conversation-state.js"
import type { EntityType } from "../conversation/types.js"

export function registerEntityForToolResult(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
): void {
  const convState = getConversationState()
  const r = normalizeToolResult(result)
  if (r.error) return

  const entity = entityForToolResult(toolName, args, r)
  if (entity) {
    convState.registerEntity(entity as Parameters<typeof convState.registerEntity>[0])
  }
}

function normalizeToolResult(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object") return {}
  return result as Record<string, unknown>
}

function entityForToolResult(
  toolName: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
): {
  type: string
  title: string
  summary: string
  metadata: Record<string, unknown>
  toolResult: unknown
} | null {
  switch (toolName) {
    case "github-createOrUpdateFile": {
      const path = (result.path as string) || (args.path as string) || ""
      const commitSha = result.commitSha as string
      const url = result.url as string
      const owner = args.owner as string
      const repo = args.repo as string
      return {
        type: "github_file",
        title: path,
        summary: `File ${path} in ${owner}/${repo}`,
        metadata: {
          path,
          owner,
          repo,
          sha: result.sha,
          commitSha,
          url,
          branch: args.branch,
        },
        toolResult: result,
      }
    }

    case "github-createRepo": {
      const fullName = result.fullName as string
      return {
        type: "github_repo",
        title: fullName || (args.name as string),
        summary: `Repository ${fullName}`,
        metadata: {
          fullName,
          owner: (fullName as string)?.split("/")[0],
          repo: (fullName as string)?.split("/")[1] || args.name,
          url: result.url,
          private: result.private,
          defaultBranch: result.defaultBranch,
        },
        toolResult: result,
      }
    }

    case "github-createIssue":
    case "github-updateIssue": {
      const number = result.number as number
      const title = (result.title as string) || (args.title as string)
      const owner = args.owner as string
      const repo = args.repo as string
      return {
        type: "github_issue",
        title: `#${number}: ${title}`,
        summary: `Issue ${owner}/${repo}#${number}`,
        metadata: { owner, repo, number, title, url: result.url },
        toolResult: result,
      }
    }

    case "github-createPR": {
      const prNumber = result.number as number
      const prTitle = (result.title as string) || (args.title as string)
      const prOwner = args.owner as string
      const prRepo = args.repo as string
      return {
        type: "github_pr",
        title: `#${prNumber}: ${prTitle}`,
        summary: `PR ${prOwner}/${prRepo}#${prNumber}`,
        metadata: {
          owner: prOwner,
          repo: prRepo,
          number: prNumber,
          title: prTitle,
          url: result.url,
        },
        toolResult: result,
      }
    }

    case "github-createBranch": {
      const branch = (args.branch as string) || ""
      const branchOwner = args.owner as string
      const branchRepo = args.repo as string
      return {
        type: "github_repo",
        title: `${branchOwner}/${branchRepo} (${branch})`,
        summary: `Branch ${branch} in ${branchOwner}/${branchRepo}`,
        metadata: {
          owner: branchOwner,
          repo: branchRepo,
          branch,
          ref: result.ref,
          sha: result.sha,
        },
        toolResult: result,
      }
    }

    case "github-getFileContents": {
      const filePath = args.path as string
      const fileOwner = args.owner as string
      const fileRepo = args.repo as string
      return {
        type: "github_file",
        title: filePath,
        summary: `File ${filePath} in ${fileOwner}/${fileRepo}`,
        metadata: {
          owner: fileOwner,
          repo: fileRepo,
          path: filePath,
          sha: result.sha,
          url: result.url,
        },
        toolResult: result,
      }
    }

    case "read_document": {
      const url = args.url as string
      const filename = url.split("/").pop() || url
      return {
        type: "uploaded_file",
        title: filename,
        summary: `Parsed document: ${filename}`,
        metadata: { url, mimeType: args.mimeType, filename },
        toolResult: result,
      }
    }

    case "calendar-createEvent":
    case "calendar-quickAdd":
    case "calendar-createEventWithMeet": {
      return {
        type: "calendar_event",
        title: (result.summary as string) || (args.summary as string) || "Calendar event",
        summary: (result.htmlLink as string) || "",
        metadata: { ...args, ...result },
        toolResult: result,
      }
    }

    case "drive-createFile": {
      return {
        type: "drive_doc",
        title: (result.name as string) || (args.name as string) || "Document",
        summary: (result.link as string) || "Created document",
        metadata: { ...args, ...result },
        toolResult: result,
      }
    }

    case "drive-createFolder": {
      return {
        type: "drive_folder",
        title: (result.name as string) || (args.name as string) || "Folder",
        summary: "Created folder",
        metadata: { ...args, ...result },
        toolResult: result,
      }
    }

    case "gmail-send":
    case "gmail-createDraft": {
      return {
        type: "gmail_message",
        title: (result.subject as string) || (args.subject as string) || "Email",
        summary: `To: ${args.to as string}`,
        metadata: { ...args, ...result },
        toolResult: result,
      }
    }

    case "slack-sendMessage": {
      return {
        type: "slack_message",
        title:
          (result.text as string)?.slice(0, 80) ||
          (args.text as string)?.slice(0, 80) ||
          "Slack message",
        summary: result.permalink ? `[Permalink](${result.permalink as string})` : "",
        metadata: { ...args, ...result },
        toolResult: result,
      }
    }

    case "linear-createIssue": {
      return {
        type: "linear_ticket",
        title: (result.title as string) || (args.title as string) || "Linear issue",
        summary: (result.identifier as string) || "Created issue",
        metadata: { ...args, ...result },
        toolResult: result,
      }
    }

    case "bash": {
      const cmd = (args.command as string)?.slice(0, 80) || ""
      const exitCode = result.exitCode as number
      return {
        type: "bash_result",
        title: cmd,
        summary: exitCode === 0 ? `Command succeeded` : `Command exited with code ${exitCode}`,
        metadata: { command: args.command as string, exitCode, cwd: args.cwd },
        toolResult: result,
      }
    }

    default: {
      if (
        toolName.startsWith("github-") ||
        toolName.startsWith("google-") ||
        toolName.startsWith("slack-") ||
        toolName.startsWith("linear-") ||
        toolName.startsWith("notion-")
      ) {
        const ok = (result as Record<string, unknown>).ok
        if (ok === true || ok === undefined) {
          return {
            type: "generated_artifact",
            title: `${toolName} result`,
            summary: (result.message as string) || `Executed ${toolName}`,
            metadata: { toolName, args, result },
            toolResult: result,
          }
        }
      }
      return null
    }
  }
}
