/**
 * Workflow Monitor Job Example
 *
 * A workflow that monitors a job until completion.
 *
 * Demonstrates:
 * - Polling pattern with delayed transitions
 * - Always transitions for decision logic
 * - Context accumulation from multiple invokes
 * - Loop-back transitions
 *
 * Ported from xstate/examples/workflow-monitor-job
 * Based on: https://github.com/serverlessworkflow/specification/tree/main/examples#monitor-job-example
 */
import { Option } from "effect"
import { setup, assign, fromPromise } from "../src/index.js"

/**
 * Job information.
 */
export interface Job {
  /** The job name that the submit actor receives. */
  name: string
}

/**
 * Input type for the job monitoring workflow.
 */
export interface MonitorJobInput {
  /** The job to submit. Required: the context factory copies it without a check. */
  job: Job
}

/**
 * Context type for the job monitoring workflow.
 */
export interface MonitorJobContext {
  /** The job from the input; nothing changes it. */
  job: Job
  /** The id that the submit actor returned; undefined until the submit finishes. The status check receives it as `name`. */
  jobuid: string | undefined
  /**
   * The status of the last check; undefined until a check finishes. Any value other than
   * "SUCCEEDED" or "FAILED" makes the machine check again.
   */
  jobStatus: "SUCCEEDED" | "FAILED" | undefined
}

/**
 * Submit job actor.
 */
export const submitJobActor = fromPromise<{ jobuid: string }, { name: string }>(
  async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    return { jobuid: "123" }
  }
)

/**
 * Check job status actor.
 */
export const checkJobStatusActor = fromPromise<{ jobStatus: "SUCCEEDED" | "FAILED" }, { name: string | undefined }>(
  async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 50))
    return { jobStatus: "SUCCEEDED" as const }
  }
)

/**
 * Report job succeeded actor.
 */
export const reportJobSucceededActor = fromPromise<void, unknown>(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50))
})

/**
 * Report job failed actor.
 */
export const reportJobFailedActor = fromPromise<void, unknown>(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50))
})

/**
 * Job monitoring workflow machine.
 *
 * This workflow:
 * 1. Submits a job
 * 2. Waits for completion (polling)
 * 3. Checks job status
 * 4. Reports success or failure
 */
export const monitorJobMachine = setup({
  types: {
    context: {} as MonitorJobContext,
  },
  actors: {
    submitJob: submitJobActor,
    checkJobStatus: checkJobStatusActor,
    reportJobSucceeded: reportJobSucceededActor,
    reportJobFailed: reportJobFailedActor,
  },
}).createMachine({
  id: "jobmonitoring",
  initial: "SubmitJob",
  context: ({ input }) => ({
    job: (input as MonitorJobInput).job,
    jobuid: undefined,
    jobStatus: undefined,
  }),
  states: {
    SubmitJob: {
      invoke: {
        src: "submitJob",
        input: ({ context }) => ({
          name: context.job.name,
        }),
        onDone: {
          target: "WaitForCompletion",
          actions: assign(({ event }) => ({
            // A done event's output is an Option (D8)
            jobuid: Option.getOrUndefined(Option.map(event.output, (output) => output.jobuid)),
          })),
        },
      },
    },
    WaitForCompletion: {
      // In full implementation, this would use after: { 5000: "GetJobStatus" }
      // For testing, we transition immediately
      always: "GetJobStatus",
    },
    GetJobStatus: {
      invoke: {
        src: "checkJobStatus",
        input: ({ context }) => ({
          name: context.jobuid,
        }),
        onDone: {
          target: "DetermineCompletion",
          actions: assign(({ event }) => ({
            // A done event's output is an Option (D8)
            jobStatus: Option.getOrUndefined(Option.map(event.output, (output) => output.jobStatus)),
          })),
        },
      },
    },
    DetermineCompletion: {
      always: [
        {
          guard: ({ context }) => context.jobStatus === "SUCCEEDED",
          target: "JobSucceeded",
        },
        {
          guard: ({ context }) => context.jobStatus === "FAILED",
          target: "JobFailed",
        },
        {
          target: "WaitForCompletion",
        },
      ],
    },
    JobSucceeded: {
      invoke: {
        src: "reportJobSucceeded",
        onDone: "End",
      },
    },
    JobFailed: {
      invoke: {
        src: "reportJobFailed",
        onDone: "End",
      },
    },
    End: {
      type: "final",
    },
  },
})
