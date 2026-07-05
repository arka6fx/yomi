import type { TrackedEntity, EntityType, ActiveContext } from "./types.js"

let _nextId = 0
function nextId(): string {
  return `ent_${++_nextId}`
}

export class EntityStore {
  private entities = new Map<string, TrackedEntity>()
  private entityIndex = new Map<EntityType, string[]>()
  private activeContext: ActiveContext = {}

  register(entity: Omit<TrackedEntity, "id" | "createdAt">): TrackedEntity {
    const id = nextId()
    const tracked: TrackedEntity = {
      ...entity,
      id,
      createdAt: new Date(),
    }
    this.entities.set(id, tracked)

    const existing = this.entityIndex.get(entity.type) ?? []
    existing.unshift(id)
    if (existing.length > 20) existing.pop()
    this.entityIndex.set(entity.type, existing)

    this.updateActiveContext(tracked)
    return tracked
  }

  get(id: string): TrackedEntity | undefined {
    return this.entities.get(id)
  }

  getLatestByType(type: EntityType): TrackedEntity | undefined {
    const ids = this.entityIndex.get(type)
    if (!ids || ids.length === 0) return undefined
    const id = ids[0]
    if (!id) return undefined
    return this.entities.get(id)
  }

  getRecentByType(type: EntityType, limit = 3): TrackedEntity[] {
    const ids = this.entityIndex.get(type) ?? []
    const out: TrackedEntity[] = []
    for (const id of ids) {
      const e = this.entities.get(id)
      if (e) out.push(e)
      if (out.length >= limit) break
    }
    return out
  }

  getActiveContext(): ActiveContext {
    return { ...this.activeContext }
  }

  private updateActiveContext(entity: TrackedEntity): void {
    const m = entity.metadata
    switch (entity.type) {
      case "github_repo":
        this.activeContext.currentRepo = {
          owner: m.owner as string,
          repo: m.repo as string,
          fullName: m.fullName as string,
        }
        this.activeContext.currentBranch = m.defaultBranch as string | undefined
        break
      case "github_file":
        this.activeContext.currentFile = {
          path: entity.title,
          repo: (m.owner as string) + "/" + (m.repo as string),
        }
        break
      case "drive_doc":
        this.activeContext.currentDriveDoc = {
          id: m.id as string,
          title: entity.title,
          url: m.url as string,
        }
        break
      case "slides_presentation":
        this.activeContext.currentSlidesPresentation = {
          id: m.id as string,
          title: entity.title,
          url: m.url as string,
        }
        break
      case "uploaded_file":
        this.activeContext.currentUploadedFile = {
          id: entity.id,
          filename: entity.title,
          mimeType: m.mimeType as string,
        }
        break
      case "slack_channel":
        this.activeContext.currentSlackChannel = {
          id: m.id as string,
          name: entity.title,
        }
        break
      case "gmail_draft":
        this.activeContext.currentEmailDraft = {
          id: m.id as string,
          to: m.to as string,
          subject: entity.title,
        }
        break
      case "calendar_event":
        this.activeContext.currentCalendarEvent = {
          id: m.id as string,
          title: entity.title,
          startTime: m.startTime as string,
        }
        break
      case "linear_ticket":
        this.activeContext.currentTicket = {
          id: m.id as string,
          title: entity.title,
          system: "linear",
        }
        break
      case "generated_artifact":
        this.activeContext.currentGeneratedArtifact = {
          id: entity.id,
          type: m.artifactType as string,
          title: entity.title,
        }
        break
    }
  }

  search(query: string): TrackedEntity | undefined {
    const q = query.toLowerCase()

    const all: TrackedEntity[] = []
    for (const e of this.entities.values()) {
      all.push(e)
    }

    const exactMatch = all.find(
      (e) => e.title.toLowerCase().includes(q) || e.summary.toLowerCase().includes(q),
    )
    if (exactMatch) return exactMatch

    const typeMatch = all.reverse().find((e) => {
      const typeLabel = e.type.replace("_", " ").toLowerCase()
      return typeLabel.includes(q)
    })
    if (typeMatch) return typeMatch

    return undefined
  }

  clearByType(type: EntityType): void {
    const ids = this.entityIndex.get(type)
    if (ids) {
      for (const id of ids) this.entities.delete(id)
      this.entityIndex.set(type, [])
    }
  }

  clear(): void {
    this.entities.clear()
    this.entityIndex.clear()
    this.activeContext = {}
  }
}
