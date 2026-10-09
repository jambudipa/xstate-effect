/**
 * Workflow Media Scanner Example
 *
 * A media library scanning and file management workflow.
 *
 * Demonstrates:
 * - Multi-step workflow with sequential invocations
 * - Error handling with named actions
 * - Input-based context initialization
 * - Complex file processing pipeline
 *
 * Ported from xstate/examples/workflow-media-scanner
 */
import { Option } from "effect"
import { setup, assign, fromPromise } from "../src/index.js"

/**
 * Context for the media scanner.
 */
export interface MediaScannerContext {
  /** The library root to scan; fixed at "/media". */
  basePath: string
  /** The folder that qualifying directories move to; fixed at "/media/4k". */
  destinationPath: string
  /** The directories the scan found; the permission check reads them. */
  directoriesToCheck: string[]
  /** The directories that passed the permission check; the file evaluation reads them. */
  dirsToEvaluate: string[]
  /** The directories that the evaluation selected to move. */
  dirsToMove: string[]
  /** Not used: no state reads or writes it. */
  filesToEmail: string[]
  /**
   * The directories to report: those that failed the permission check. A rejected permission
   * check must reject with an object that has `dirsToReport`; the error handler reads it without a check.
   */
  dirsToReport: string[]
  /** Not used: no state reads or writes it. */
  processedFiles: string[]
  /** The file extensions (without the dot) that the evaluation accepts; the mock evaluation ignores them. */
  acceptedFileTypes: string[]
}

/**
 * Input for the media scanner.
 */
export interface MediaScannerInput {
  /**
   * The library root. The machine does not read an input: its context starts with the fixed
   * paths, so this type only records the input shape.
   */
  basePath: string
  /** The destination folder; not read, like `basePath`. */
  destinationPath: string
}

/**
 * Events for the media scanner.
 */
export type MediaScannerEvent =
  | { type: "START_SCAN" }
  | { type: "RESTART" }

/**
 * Mock scan directories function.
 */
async function scanDirectories(basePath: string): Promise<string[]> {
  await new Promise((resolve) => setTimeout(resolve, 50))
  return [`${basePath}/movies`, `${basePath}/shows`, `${basePath}/music`]
}

/**
 * Mock check file permissions function.
 */
async function checkFilePermissions(
  directories: string[]
): Promise<{ dirsToEvaluate: string[]; dirsToReport: string[] }> {
  await new Promise((resolve) => setTimeout(resolve, 50))
  return {
    dirsToEvaluate: directories.filter((_, i) => i < 2),
    dirsToReport: directories.filter((_, i) => i >= 2),
  }
}

/**
 * Mock evaluate files function.
 */
async function evaluateFiles(
  directories: string[],
  _acceptedTypes: string[]
): Promise<{ dirsToMove: string[] }> {
  await new Promise((resolve) => setTimeout(resolve, 50))
  return {
    dirsToMove: directories.map((d) => `${d}/4k`),
  }
}

/**
 * Mock move files function.
 */
async function moveFiles(
  directories: string[],
  _destination: string
): Promise<string[]> {
  await new Promise((resolve) => setTimeout(resolve, 50))
  return directories
}

/**
 * Scan library actor.
 */
export const scanLibraryActor = fromPromise<string[], { basePath: string }>(
  async ({ input }) => scanDirectories(input.basePath)
)

/**
 * Check file permissions actor.
 */
export const checkFilePermissionsActor = fromPromise<
  { dirsToEvaluate: string[]; dirsToReport: string[] },
  { directoriesToCheck: string[] }
>(async ({ input }) => checkFilePermissions(input.directoriesToCheck))

/**
 * Evaluate files actor.
 */
export const evaluateFilesActor = fromPromise<
  { dirsToMove: string[] },
  { dirsToEvaluate: string[]; acceptedFileTypes: string[] }
>(async ({ input }) =>
  evaluateFiles(input.dirsToEvaluate, input.acceptedFileTypes)
)

/**
 * Move files actor.
 */
export const moveFilesActor = fromPromise<
  string[],
  { dirsToMove: string[]; destinationPath: string }
>(async ({ input }) => moveFiles(input.dirsToMove, input.destinationPath))

/**
 * Media Scanner machine.
 *
 * Scans a media library and processes files:
 * 1. Scans directories for media files
 * 2. Checks file permissions
 * 3. Evaluates files (e.g., resolution)
 * 4. Moves qualifying files to destination
 */
export const mediaScannerMachine = setup({
  types: {
    context: {} as MediaScannerContext,
    events: {} as MediaScannerEvent,
  },
  actions: {
    emailErrors: () => {
      console.log("Emailing errors")
    },
  },
  actors: {
    scanLibrary: scanLibraryActor,
    checkFilePermissions: checkFilePermissionsActor,
    evaluateFiles: evaluateFilesActor,
    moveFiles: moveFilesActor,
  },
}).createMachine({
  id: "mediaScanner",
  initial: "idle",
  context: {
    basePath: "/media",
    destinationPath: "/media/4k",
    directoriesToCheck: [],
    dirsToEvaluate: [],
    dirsToMove: [],
    filesToEmail: [],
    dirsToReport: [],
    processedFiles: [],
    acceptedFileTypes: [
      "mp4",
      "mkv",
      "avi",
      "mov",
      "m4v",
      "mpg",
      "mpeg",
      "wmv",
      "flv",
      "ts",
      "mts",
    ],
  },
  states: {
    idle: {
      on: {
        START_SCAN: "Scanning",
      },
    },
    Scanning: {
      invoke: {
        id: "scanLibrary",
        src: "scanLibrary",
        input: ({ context }) => ({ basePath: context.basePath }),
        onDone: {
          target: "CheckingFilePermissions",
          actions: assign(({ event }) => ({
            directoriesToCheck: Option.getOrElse(event.output, (): string[] => []),
          })),
        },
        onError: "ReportingErrors",
      },
    },
    CheckingFilePermissions: {
      invoke: {
        id: "checkFilePermissions",
        src: "checkFilePermissions",
        input: ({ context }) => ({
          directoriesToCheck: context.directoriesToCheck,
        }),
        onDone: {
          target: "EvaluatingFiles",
          actions: assign(({ event }) => {
            const output = Option.getOrElse(event.output, () => ({ dirsToEvaluate: [], dirsToReport: [] }))
            return {
              dirsToEvaluate: output.dirsToEvaluate,
              dirsToReport: output.dirsToReport,
            }
          }),
        },
        onError: {
          target: "ReportingErrors",
          actions: assign(({ event }) => ({
            dirsToReport: ((event as { error: { dirsToReport: string[] } }).error)
              .dirsToReport,
          })),
        },
      },
    },
    ReportingErrors: {
      entry: "emailErrors",
      on: {
        RESTART: "idle",
      },
    },
    EvaluatingFiles: {
      invoke: {
        id: "evaluatingFiles",
        src: "evaluateFiles",
        input: ({ context }) => ({
          dirsToEvaluate: context.dirsToEvaluate,
          acceptedFileTypes: context.acceptedFileTypes,
        }),
        onDone: {
          target: "MovingFiles",
          actions: assign(({ event }) => ({
            dirsToMove: Option.match(event.output, { onNone: (): string[] => [], onSome: (output) => output.dirsToMove }),
          })),
        },
      },
    },
    MovingFiles: {
      invoke: {
        id: "moveFiles",
        src: "moveFiles",
        input: ({ context }) => ({
          dirsToMove: context.dirsToMove,
          destinationPath: context.destinationPath,
        }),
        onDone: "idle",
        onError: "ReportingErrors",
      },
    },
  },
})
