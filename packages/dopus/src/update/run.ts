import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectProject } from '../init/detect.js'
import { type InitIO, installArgs, toImportPath } from '../init/run.js'
import { PRESETS, readTemplate, routeTemplate } from '../init/templates.js'
import { unifiedDiff } from './diff.js'
import { CONFIG_IMPORT, normalize, shippedIn } from './history.js'

export interface UpdateOptions {
  cwd: string
  /** Report what would change; write nothing. */
  dryRun?: boolean
  /** Never prompt: replace untouched copies, save edited ones as `<file>.new`. */
  yes?: boolean
  /** Replace edited copies too. */
  force?: boolean
  /** Install missing dependencies. Default true. */
  install?: boolean
}

export type Choice = 'overwrite' | 'skip' | 'new' | 'diff'

export interface UpdateIO
  extends Pick<InitIO, 'confirm' | 'info' | 'warn' | 'success' | 'install'> {
  choose(message: string, options: { value: Choice; label: string }[]): Promise<Choice>
  /** Prints a diff (lines start with ' ', '-', '+' or '@@'). */
  diff(text: string): void
}

export type FileStatus =
  | 'up-to-date'
  | 'updated' // an untouched copy of an older version, replaced
  | 'created'
  | 'modified' // edited by the user; left as is (dry run)
  | 'overwritten' // edited by the user, replaced on request
  | 'kept' // edited by the user, left as is
  | 'saved-new' // edited by the user; the new template written next to it as <file>.new
  | 'missing'

export interface UpdateResult {
  files: { file: string; status: FileStatus; from?: string }[]
  installed: string[]
  /** Dependencies the new templates need that are not installed (when not installed by this run). */
  missingDependencies: string[]
  /**
   * The chat file is an edited copy of the old self-contained UI (0.2.x, no `dopus/react` import) and was left in
   * place. The new wrapper replaces it rather than merging into it.
   */
  oldChatUI: boolean
}

interface Target {
  file: string
  /** Key in templates/history.json. */
  key: string
  latest: string
  /** Create the file when it does not exist. */
  create?: boolean
}

/** The thin wrapper (0.3+) imports the package UI; the 0.2.x chat file is self-contained. */
const IMPORTS_DOPUS_REACT = /from\s+['"]dopus\/react['"]/

/** Packages the chat UI imports (the rest were added by `init` and are needed by the route too). */
const UI_DEPENDENCIES: [string, string][] = [
  ['@ai-sdk/react', '@ai-sdk/react@^4'],
  ['react-markdown', 'react-markdown@^10'],
  ['remark-gfm', 'remark-gfm@^4'],
]

/** Which preset an existing preset.ts came from: by its hash, else the one it shares most lines with. */
function presetKey(text: string) {
  const keys = PRESETS.map((preset) => `prompts/presets/${preset.id}.ts`)
  const exact = keys.find((key) => shippedIn(key, text))
  if (exact) return exact
  const lines = new Set(text.split('\n').map((line) => line.trim()))
  const shared = (key: string) =>
    readTemplate(key)
      .split('\n')
      .filter((line) => line.trim() && lines.has(line.trim())).length
  return keys.reduce((best, key) => (shared(key) > shared(best) ? key : best))
}

/**
 * Brings the files `dopus init` copied (chat UI, route, preset prompt) up to this version's templates.
 * Untouched copies of an older version are replaced; copies the user edited are never replaced without
 * asking. agent.config.ts, app.ts and .env.local are the user's and are never touched.
 */
export async function runUpdate(options: UpdateOptions, io: UpdateIO): Promise<UpdateResult> {
  const project = detectProject(options.cwd)
  const { root } = project
  const at = (path: string) => join(project.configDir, path)
  const read = (file: string) => readFileSync(join(root, file), 'utf8')
  const exists = (file: string) => existsSync(join(root, file))
  const result: UpdateResult = {
    files: [],
    installed: [],
    missingDependencies: [],
    oldChatUI: false,
  }

  const chatFile = at('components/agent/agent-chat.tsx')
  const routeFile = join(project.appDir, 'api', 'agent', 'route.ts')
  const presetFile = at('agent/prompts/preset.ts')
  const targets: Target[] = [
    { file: chatFile, key: 'ui/agent-chat.tsx', latest: readTemplate('ui/agent-chat.tsx') },
    {
      file: at('components/agent/agent-chat.css'),
      key: 'ui/agent-chat.css',
      latest: readTemplate('ui/agent-chat.css'),
      // Before 0.2.2 the styles were a CSS Module; the new chat UI imports this file.
      create: exists(chatFile),
    },
  ]
  if (exists(routeFile)) {
    const configImport =
      read(routeFile).match(CONFIG_IMPORT)?.[1] ?? toImportPath(routeFile, at('agent.config'))
    targets.push({ file: routeFile, key: 'route', latest: routeTemplate(configImport) })
  } else {
    result.files.push({ file: routeFile, status: 'missing' })
  }
  if (exists(presetFile)) {
    const key = presetKey(read(presetFile))
    targets.push({ file: presetFile, key, latest: readTemplate(key) })
  } else {
    result.files.push({ file: presetFile, status: 'missing' })
  }

  const write = (file: string, content: string) => {
    if (!options.dryRun) writeFileSync(join(root, file), content)
  }

  for (const target of targets) {
    const { file, latest } = target
    if (!exists(file)) {
      if (target.create) {
        write(file, latest)
        result.files.push({ file, status: 'created' })
      } else {
        result.files.push({ file, status: 'missing' })
      }
      continue
    }
    const current = read(file)
    if (normalize(current) === normalize(latest)) {
      result.files.push({ file, status: 'up-to-date' })
      continue
    }
    const from = shippedIn(target.key, current)
    if (from) {
      write(file, latest)
      result.files.push({ file, status: 'updated', from })
      continue
    }

    // Edited by the user.
    let choice: Choice
    if (options.dryRun) {
      result.files.push({ file, status: 'modified' })
      continue
    } else if (options.force) {
      choice = 'overwrite'
    } else if (options.yes) {
      choice = 'new'
    } else {
      do {
        choice = await io.choose(`${file} has your changes. Replace it with the new template?`, [
          { value: 'diff', label: 'Show the diff (yours → new)' },
          { value: 'new', label: `Keep yours, save the new one as ${file}.new` },
          { value: 'overwrite', label: 'Replace (your changes are lost)' },
          { value: 'skip', label: 'Keep yours, skip' },
        ])
        if (choice === 'diff') io.diff(unifiedDiff(current, latest))
      } while (choice === 'diff')
    }
    if (choice === 'overwrite') {
      write(file, latest)
      result.files.push({ file, status: 'overwritten' })
    } else if (choice === 'new') {
      write(`${file}.new`, latest)
      result.files.push({ file, status: 'saved-new' })
    } else {
      result.files.push({ file, status: 'kept' })
    }
  }

  const chatKept = result.files.some(
    (f) =>
      f.file === chatFile &&
      (f.status === 'saved-new' || f.status === 'kept' || f.status === 'modified'),
  )
  result.oldChatUI = chatKept && !IMPORTS_DOPUS_REACT.test(read(chatFile))

  const chatReplaced = result.files.some(
    (f) => f.file === chatFile && (f.status === 'updated' || f.status === 'overwritten'),
  )
  const oldModule = at('components/agent/agent-chat.module.css')
  if (chatReplaced && exists(oldModule)) {
    io.warn(
      `${oldModule} is no longer used by the chat UI (it now imports agent-chat.css). Delete it.`,
    )
  }

  if (exists(chatFile)) {
    const missing = UI_DEPENDENCIES.filter(([name]) => !project.dependencies[name]).map(
      ([, spec]) => spec,
    )
    if (missing.length > 0) {
      const install =
        !options.dryRun &&
        options.install !== false &&
        (options.yes || options.force || (await io.confirm(`Install ${missing.join(', ')}?`, true)))
      if (install) {
        await io.install(project.packageManager, missing, root)
        result.installed = missing
      } else {
        result.missingDependencies = missing
        io.warn(
          `The chat UI needs: ${project.packageManager} ${installArgs(project.packageManager, missing).join(' ')}`,
        )
      }
    }
  }
  return result
}

/**
 * What to tell the user about an edited 0.2.x chat file (`oldChatUI`), for what is on disk: the wrapper saved as
 * `.new`, the old file kept without one, or a dry run that wrote nothing.
 */
export function oldChatUINote(status: FileStatus): string {
  const head =
    'Your agent-chat.tsx is the old self-contained chat UI (0.2.x) and keeps working as it is.'
  const tail =
    'carry your changes over as CSS, labels or plugins. See "Upgrading from 0.2" in the README.'
  if (status === 'saved-new') {
    return `${head}\nTo move to the package UI, replace it with agent-chat.tsx.new and ${tail}`
  }
  return `${head}\nTo move to the package UI, run \`dopus update\` and save the new wrapper as agent-chat.tsx.new, then\nreplace yours with it and ${tail}`
}
