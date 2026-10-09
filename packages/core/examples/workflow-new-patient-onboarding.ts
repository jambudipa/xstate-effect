/**
 * Workflow New Patient Onboarding Example
 *
 * A workflow that onboards new patients through multiple steps.
 *
 * Demonstrates:
 * - Event-triggered workflow start
 * - Sequential invoke steps
 * - Error handling at each step
 * - Compound state with onDone
 * - ID references for state targeting
 *
 * Ported from xstate/examples/workflow-new-patient-onboarding
 * Based on: https://github.com/serverlessworkflow/specification/blob/main/examples/README.md#New-Patient-Onboarding
 */
import { setup, assign, fromPromise } from "../src/index.js"

/**
 * Patient information.
 */
export interface Patient {
  name: string
  condition: string
}

/**
 * Context type for the patient onboarding workflow.
 */
export interface PatientOnboardingContext {
  patient: Patient | null
}

/**
 * Events for the patient onboarding workflow.
 */
export type PatientOnboardingEvent = { type: "NewPatientEvent"; name: string; condition: string }

/**
 * Store new patient info actor.
 */
export const storeNewPatientInfoActor = fromPromise<void, Patient | null>(async ({ input }) => {
  await new Promise((resolve) => setTimeout(resolve, 50))
  console.log("Stored patient info:", input)
})

/**
 * Assign doctor actor.
 */
export const assignDoctorActor = fromPromise<void, void>(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50))
  console.log("Doctor assigned")
})

/**
 * Schedule appointment actor.
 */
export const scheduleApptActor = fromPromise<void, void>(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50))
  console.log("Appointment scheduled")
})

/**
 * Patient onboarding workflow machine.
 *
 * This workflow:
 * 1. Waits for new patient event
 * 2. Stores patient info
 * 3. Assigns a doctor
 * 4. Schedules appointment
 * 5. Completes and clears patient data
 */
export const patientOnboardingMachine = setup({
  types: {
    context: {} as PatientOnboardingContext,
    events: {} as PatientOnboardingEvent,
  },
  actors: {
    StoreNewPatientInfo: storeNewPatientInfoActor,
    AssignDoctor: assignDoctorActor,
    ScheduleAppt: scheduleApptActor,
  },
}).createMachine({
  id: "patientonboarding",
  initial: "Idle",
  context: {
    patient: null,
  },
  states: {
    Idle: {
      on: {
        NewPatientEvent: {
          target: "Onboard",
          actions: assign(({ event }) => ({
            patient: {
              name: event.name,
              condition: event.condition,
            },
          })),
        },
      },
    },
    Onboard: {
      initial: "StorePatient",
      states: {
        StorePatient: {
          invoke: {
            src: "StoreNewPatientInfo",
            input: ({ context }) => context.patient,
            onDone: "AssignDoctor",
            onError: "#patientonboarding.End",
          },
        },
        AssignDoctor: {
          invoke: {
            src: "AssignDoctor",
            onDone: "ScheduleAppt",
            onError: "#patientonboarding.End",
          },
        },
        ScheduleAppt: {
          invoke: {
            src: "ScheduleAppt",
            onDone: "Done",
            onError: "#patientonboarding.End",
          },
        },
        Done: {
          type: "final",
        },
      },
      onDone: {
        target: "End",
        actions: assign({
          patient: null,
        }),
      },
    },
    End: {
      type: "final",
    },
  },
})
