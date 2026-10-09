/**
 * Workflow Event-Based Service Example
 *
 * A veterinary appointment workflow that responds to events.
 *
 * Demonstrates:
 * - Event-driven service invocation
 * - Context assignment from events
 * - Invoke with input from context
 *
 * Ported from xstate/examples/workflow-event-based-service
 * Based on: https://github.com/serverlessworkflow/specification/tree/main/examples#event-based-service-invocation
 */
import { Option } from "effect"
import { setup, assign, fromPromise } from "../src/index.js"

/**
 * Patient information.
 */
export interface PatientInfo {
  /** The owner's name. */
  name: string
  /** The pet, as free text. */
  pet: string
  /** The reason for the visit. */
  reason: string
}

/**
 * Appointment information.
 */
export interface AppointmentInfo {
  /** The booking id; the mock always gives "1234". */
  appointmentId: string
  /** The appointment time as an ISO 8601 UTC string; the mock gives the time of booking. */
  appointmentDate: string
}

/**
 * Context for the vet appointment workflow.
 */
export interface VetAppointmentContext {
  /** The patient of the last MakeVetAppointment event; null before the first one. */
  patientInfo: PatientInfo | null
  /** The last booked appointment; null until the first booking finishes. A new request keeps the old value until it is booked. */
  appointmentInfo: AppointmentInfo | null
}

/**
 * Events for the vet appointment workflow.
 */
export type VetAppointmentEvent = {
  type: "MakeVetAppointment"
  patientInfo: PatientInfo
}

/**
 * Make appointment actor - simulates appointment booking.
 */
export const makeAppointmentActor = fromPromise<
  AppointmentInfo,
  { patientInfo: PatientInfo }
>(async ({ input }) => {
  console.log("Making vet appointment for", input.patientInfo)
  await new Promise((resolve) => setTimeout(resolve, 100))

  const appointmentInfo: AppointmentInfo = {
    appointmentId: "1234",
    appointmentDate: new Date().toISOString(),
  }

  console.log("Vet appointment made", appointmentInfo)
  return appointmentInfo
})

/**
 * Vet Appointment Workflow machine.
 *
 * Handles veterinary appointment scheduling:
 * - Waits for appointment request event
 * - Books the appointment asynchronously
 * - Returns to idle with appointment info
 */
export const vetAppointmentMachine = setup({
  types: {
    context: {} as VetAppointmentContext,
    events: {} as VetAppointmentEvent,
  },
  actors: {
    MakeAppointmentAction: makeAppointmentActor,
  },
}).createMachine({
  id: "VetAppointmentWorkflow",
  initial: "Idle",
  context: {
    patientInfo: null,
    appointmentInfo: null,
  },
  states: {
    Idle: {
      on: {
        MakeVetAppointment: {
          target: "MakeVetAppointmentState",
          actions: assign(({ event }) => ({
            patientInfo: event.patientInfo,
          })),
        },
      },
    },
    MakeVetAppointmentState: {
      invoke: {
        src: "MakeAppointmentAction",
        input: ({ context }) => ({
          patientInfo: context.patientInfo!,
        }),
        onDone: {
          target: "Idle",
          actions: assign(({ event }) => ({
            // A done event's output is an Option (D8)
            appointmentInfo: Option.getOrNull(event.output),
          })),
        },
      },
    },
  },
})
