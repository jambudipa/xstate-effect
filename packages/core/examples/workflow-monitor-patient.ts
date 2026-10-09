/**
 * Workflow Monitor Patient Vital Signs Example
 *
 * A workflow that monitors patient vitals and takes actions based on events.
 *
 * Demonstrates:
 * - Event-driven actions without state changes
 * - Named actions in implementations
 * - CloudEvent-style event payloads
 * - Input-based context
 *
 * Ported from xstate/examples/workflow-monitor-patient
 * Based on: https://github.com/serverlessworkflow/specification/tree/main/examples#monitor-patient-vital-signs-example
 */
import { setup } from "../src/index.js"

/**
 * Input type for the patient monitoring workflow.
 */
export interface PatientMonitorInput {
  /** The patient to monitor. Required: the context factory reads it without a check. */
  patientId: string
}

/**
 * Context type for the patient monitoring workflow.
 */
export interface PatientMonitorContext {
  /** The monitored patient from the input; every action names it. */
  patientId: string
}

/**
 * Base CloudEvent structure.
 */
interface CloudEventBase {
  /** The CloudEvent source; always "monitoringSource". */
  source: "monitoringSource"
  /** The CloudEvent id. */
  id: string
  /** The time of the reading, as a timestamp string. */
  time: string
  /** The patient the reading is for. The machine does not compare it with the monitored patient. */
  patientId: string
  /** The reading, as text; the actions do not read it. */
  data: { value: string }
}

/**
 * Events for the patient monitoring workflow.
 */
export type PatientMonitorEvent =
  | ({ type: "org.monitor.highBodyTemp" } & CloudEventBase)
  | ({ type: "org.monitor.highBloodPressure" } & CloudEventBase)
  | ({ type: "org.monitor.highRespirationRate" } & CloudEventBase)

/**
 * Patient monitoring workflow machine.
 *
 * This workflow:
 * 1. Monitors for vital sign events
 * 2. Takes appropriate action based on event type
 * 3. Continues monitoring indefinitely
 */
export const patientMonitorMachine = setup({
  types: {
    context: {} as PatientMonitorContext,
    events: {} as PatientMonitorEvent,
  },
  actions: {
    sendTylenolOrder: ({ context }) => {
      // Action: Send Tylenol order for high body temp
      console.log("Sending Tylenol order for patient:", context.patientId)
    },
    callNurse: ({ context }) => {
      // Action: Call nurse for high blood pressure
      console.log("Calling nurse for patient:", context.patientId)
    },
    callPulmonologist: ({ context }) => {
      // Action: Call pulmonologist for high respiration rate
      console.log("Calling pulmonologist for patient:", context.patientId)
    },
  },
}).createMachine({
  id: "patientVitalsWorkflow",
  initial: "MonitorVitals",
  context: ({ input }) => ({
    patientId: (input as PatientMonitorInput).patientId,
  }),
  states: {
    MonitorVitals: {
      on: {
        "org.monitor.highBodyTemp": {
          actions: "sendTylenolOrder",
        },
        "org.monitor.highBloodPressure": {
          actions: "callNurse",
        },
        "org.monitor.highRespirationRate": {
          actions: "callPulmonologist",
        },
      },
    },
  },
})
