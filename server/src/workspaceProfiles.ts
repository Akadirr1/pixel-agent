import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const MANIFEST_RELATIVE_PATH = path.join('.pixel-agents', 'workspace.json');
const MAX_PROFILE_BYTES = 256 * 1024;
const MAX_PROFILE_COUNT = 256;
const DEFAULT_SOURCES: AgentSourceConfig[] = [
  { path: path.join('.pixel-agents', 'agents'), provider: 'claude' },
  { path: path.join('.claude', 'agents'), provider: 'claude' },
  { path: path.join('.codex', 'agents'), provider: 'codex' },
];

export interface AgentSourceConfig {
  path: string;
  provider?: string;
}

interface WorkspaceManifest {
  schemaVersion?: number;
  name?: string;
  includeDefaultAgentSources?: boolean;
  agentSources?: AgentSourceConfig[];
}

export interface AgentProfileData {
  id: string;
  name: string;
  description: string;
  provider: string;
  sourcePath: string;
  instructions: string;
  model?: string;
  effort?: string;
  launchable: boolean;
}

export interface WorkspaceProfileSnapshot {
  workspaceName: string;
  workspacePath: string;
  profiles: AgentProfileData[];
  warnings: string[];
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function toPortablePath(value: string): string {
  return value.split(path.sep).join('/');
}

function readManifest(workspaceRoot: string, warnings: string[]): WorkspaceManifest {
  const manifestPath = path.join(workspaceRoot, MANIFEST_RELATIVE_PATH);
  if (!fs.existsSync(manifestPath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as WorkspaceManifest;
    if (parsed.schemaVersion !== 1) {
      warnings.push(`${toPortablePath(MANIFEST_RELATIVE_PATH)} must use schemaVersion 1`);
      return {};
    }
    return parsed;
  } catch (error) {
    warnings.push(`Cannot read ${toPortablePath(MANIFEST_RELATIVE_PATH)}: ${String(error)}`);
    return {};
  }
}

function parseFrontmatter(content: string): { fields: Record<string, string>; body: string } {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { fields: {}, body: normalized.trim() };
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) return { fields: {}, body: normalized.trim() };
  const fields: Record<string, string> = {};
  for (const line of normalized.slice(4, end).split('\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  return { fields, body: normalized.slice(end + 5).trim() };
}

function validProvider(value: string): string {
  return /^[a-z][a-z0-9-]*$/.test(value) ? value : 'custom';
}

function profileId(provider: string, sourcePath: string): string {
  const hash = crypto.createHash('sha256').update(sourcePath).digest('hex').slice(0, 12);
  return `${provider}:${hash}`;
}

export class WorkspaceProfileService {
  readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  load(): WorkspaceProfileSnapshot {
    const warnings: string[] = [];
    const manifest = readManifest(this.workspaceRoot, warnings);
    const workspaceName = manifest.name?.trim() || path.basename(this.workspaceRoot);
    const sources = [
      ...(manifest.includeDefaultAgentSources === false ? [] : DEFAULT_SOURCES),
      ...(Array.isArray(manifest.agentSources) ? manifest.agentSources : []),
    ];
    const seenFiles = new Set<string>();
    const profiles: AgentProfileData[] = [];

    for (const source of sources) {
      if (!source || typeof source.path !== 'string' || !source.path.trim()) continue;
      const sourceRoot = path.resolve(this.workspaceRoot, source.path);
      if (!isInside(this.workspaceRoot, sourceRoot)) {
        warnings.push(`Agent source is outside the workspace and was ignored: ${source.path}`);
        continue;
      }
      if (!fs.existsSync(sourceRoot)) continue;
      let files: string[];
      try {
        const stat = fs.statSync(sourceRoot);
        files = stat.isFile()
          ? [sourceRoot]
          : fs
              .readdirSync(sourceRoot, { withFileTypes: true })
              .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
              .map((entry) => path.join(sourceRoot, entry.name));
      } catch (error) {
        warnings.push(`Cannot inspect agent source ${source.path}: ${String(error)}`);
        continue;
      }

      for (const file of files.sort()) {
        if (profiles.length >= MAX_PROFILE_COUNT) {
          warnings.push(`Agent profile limit reached (${MAX_PROFILE_COUNT})`);
          break;
        }
        const absolute = path.resolve(file);
        const dedupeKey = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
        if (seenFiles.has(dedupeKey)) continue;
        seenFiles.add(dedupeKey);
        try {
          const size = fs.statSync(absolute).size;
          if (size > MAX_PROFILE_BYTES) {
            warnings.push(`Agent profile exceeds ${MAX_PROFILE_BYTES} bytes: ${file}`);
            continue;
          }
          const content = fs.readFileSync(absolute, 'utf8');
          const { fields, body } = parseFrontmatter(content);
          if (!body) {
            warnings.push(`Agent profile has no instruction body: ${file}`);
            continue;
          }
          const provider = validProvider(fields.provider || source.provider || 'claude');
          const relativePath = toPortablePath(path.relative(this.workspaceRoot, absolute));
          const name = fields.name?.trim() || path.basename(file, path.extname(file));
          profiles.push({
            id: profileId(provider, relativePath),
            name,
            description: fields.description?.trim() || 'No description provided.',
            provider,
            sourcePath: relativePath,
            instructions: body,
            ...(fields.model ? { model: fields.model } : {}),
            ...(fields.effort ? { effort: fields.effort } : {}),
            launchable: provider === 'claude',
          });
        } catch (error) {
          warnings.push(`Cannot read agent profile ${file}: ${String(error)}`);
        }
      }
    }

    profiles.sort((left, right) => left.name.localeCompare(right.name));
    return {
      workspaceName,
      workspacePath: this.workspaceRoot,
      profiles,
      warnings,
    };
  }
}
