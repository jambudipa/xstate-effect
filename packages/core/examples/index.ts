/**
 * Examples Index
 *
 * Re-exports all example state machines.
 * Ported from the official XState examples repository.
 */

// ============================================================================
// Basic Examples
// ============================================================================

// Counter example - simple context mutations
export {
  counterMachine,
  type CounterContext,
  type CounterEvent,
} from "./counter.js"

// Toggle example - simple state transitions
export {
  toggleMachine,
  toggleWithCountMachine,
  type ToggleEvent,
  type ToggleWithCountContext,
  type ToggleWithCountEvent,
} from "./toggle.js"

// Stopwatch example - callback actors
export {
  stopwatchMachine,
  simpleStopwatchMachine,
  ticksActor,
  createTicksActor,
  type StopwatchContext,
  type StopwatchEvent,
} from "./stopwatch.js"

// Fetch example - promise actors
export {
  fetchMachine,
  simpleFetchMachine,
  createFetchMachine,
  fetchUserActor,
  createFetchActor,
  getGreeting,
  type FetchContext,
  type FetchEvent,
  type FetchResult,
  type Greeting,
} from "./fetch.js"

// ============================================================================
// 7GUIs Examples - https://eugenkiss.github.io/7guis/
// ============================================================================

// 7GUIs Counter
export { counterMachine as guisCounterMachine } from "./7guis-counter.js"

// 7GUIs Temperature Converter
export {
  temperatureMachine,
  type TemperatureContext,
  type TemperatureEvent,
} from "./7guis-temperature.js"

// 7GUIs Flight Booker
export {
  flightBookerMachine,
  bookerActor,
  TODAY,
  TOMORROW,
  type FlightData,
  type FlightBookerEvent,
} from "./7guis-flight-booker.js"

// ============================================================================
// Game Examples
// ============================================================================

// Tic-Tac-Toe
export {
  ticTacToeMachine,
  type Player,
  type Board,
  type TicTacToeContext,
  type TicTacToeEvent,
} from "./tic-tac-toe.js"

// Snake Game
export {
  snakeMachine,
  ticksActor as snakeTicksActor,
  createInitialContext as createSnakeContext,
  type Dir,
  type Point,
  type BodyPart,
  type Snake,
  type SnakeContext,
  type SnakeEvent,
} from "./snake-game.js"

// Tiles Puzzle Game
export {
  tilesMachine,
  swap,
  type Tile,
  type TilesContext,
  type TilesEvent,
} from "./tiles-game.js"

// Trivia Game
export {
  triviaMachine,
  loadHomePageCharactersActor,
  loadSingleCharacterActor,
  loadRandomCharactersActor,
  type Character,
  type TriviaContext,
  type TriviaEvent,
} from "./trivia-game.js"

// ============================================================================
// Timer Examples
// ============================================================================

// Timer (countdown)
export {
  timerMachine,
  ticksActor as timerTicksActor,
  type TimerContext,
  type TimerEvent,
} from "./timer.js"

// ============================================================================
// TodoMVC Example
// ============================================================================

export {
  todosMachine,
  type TodoItem,
  type TodosFilter,
  type TodosContext,
  type TodosEvent,
} from "./todomvc.js"

// ============================================================================
// Traffic Light Example
// ============================================================================

export {
  trafficLightMachine,
  type TrafficLightContext,
  type TrafficLightEvent,
} from "./traffic-light.js"

// ============================================================================
// Persistence Examples
// ============================================================================

// Donut Machine (used in persisted-donut-maker)
export { donutMachine, type DonutEvent } from "./donut-machine.js"

// Friends List (async loading with retry)
export {
  friendsListMachine,
  loadFriendsActor,
  type Friend,
  type FriendsListContext,
  type FriendsListEvent,
} from "./friends-list.js"

// ============================================================================
// MongoDB Credit Check Example
// ============================================================================

export {
  creditCheckMachine,
  checkBureauActor,
  checkReportsTableActor,
  verifyCredentialsActor,
  determineMiddleScoreActor,
  generateInterestRatesActor,
  type CreditProfile,
  type UserCredential,
  type CreditCheckEvent,
} from "./mongodb-credit-check.js"

// ============================================================================
// Workflow Examples (Serverless Workflow Specification patterns)
// ============================================================================

// Hello World
export { helloWorldMachine } from "./workflow-hello.js"

// Greeting with async
export {
  greetingMachine,
  greetingFunctionActor,
  type GreetingInput,
  type GreetingContext,
  type GreetingEvent,
} from "./workflow-greeting.js"

// Math Problem (batch processing)
export {
  mathProblemMachine,
  batchMathFunctionActor,
  type MathResult,
  type MathProblemContext,
  type MathProblemEvent,
} from "./workflow-math-problem.js"

// Parallel execution
export {
  parallelExecutionMachine,
  shortDelayActor,
  longDelayActor,
} from "./workflow-parallel.js"

// Async function with input
export {
  asyncFunctionMachine,
  sendEmailActor,
  type AsyncFunctionContext,
  type AsyncFunctionInput,
} from "./workflow-async-function.js"

// Event-based greeting
export {
  eventGreetingMachine,
  greetingFunctionActor as eventGreetingFunctionActor,
  type EventGreetingContext,
  type EventGreetingEvent,
} from "./workflow-event-greeting.js"

// Event-based transitions
export {
  eventBasedMachine,
  handleApprovedVisaActor,
  handleRejectedVisaActor,
  handleNoVisaDecisionActor,
  type EventBasedEvent,
} from "./workflow-event-based.js"

// Async subflow (machine as actor)
export {
  asyncSubflowMachine,
  onboardingMachine,
  promptActor,
  type OnboardingContext,
  type OnboardingEvent,
} from "./workflow-async-subflow.js"

// Applicant request (guards)
export {
  applicantRequestMachine,
  startApplicationActor,
  sendRejectionEmailActor,
  type Applicant,
  type ApplicantRequestInput,
  type ApplicantRequestContext,
  type ApplicantRequestEvent,
} from "./workflow-applicant-request.js"

// Credit check workflow (its machine and rejection actor share names with other examples)
export {
  creditCheckMachine as workflowCreditCheckMachine,
  callCreditCheckMicroserviceActor,
  startApplicationWorkflowActor,
  sendRejectionEmailActor as creditCheckRejectionEmailActor,
  type Customer,
  type CreditCheckResult,
  type CreditCheckInput,
  type CreditCheckContext,
} from "./workflow-credit-check.js"

// Monitor job (polling)
export {
  monitorJobMachine,
  submitJobActor,
  checkJobStatusActor,
  reportJobSucceededActor,
  reportJobFailedActor,
  type Job,
  type MonitorJobInput,
  type MonitorJobContext,
} from "./workflow-monitor-job.js"

// Book lending
export {
  bookLendingMachine,
  getBookStatusActor,
  sendStatusToLenderActor,
  requestHoldActor,
  cancelHoldActor,
  checkOutBookActor,
  notifyLenderActor,
  type Lender,
  type Book,
  type BookLendingContext,
  type BookLendingEvent,
} from "./workflow-book-lending.js"

// Check inbox (scheduled)
export {
  checkInboxMachine,
  scheduleActor,
  checkInboxFunctionActor,
  sendTextsFunctionActor,
  type Message,
  type CheckInboxContext,
  type CheckInboxEvent,
} from "./workflow-check-inbox.js"

// Car vitals (parallel monitoring)
export {
  carVitalsMachine,
  vitalsCheckMachine,
  checkTirePressureActor,
  checkOilPressureActor,
  checkCoolantLevelActor,
  checkBatteryActor,
  type VitalReading,
  type VitalsCheckContext,
  type CarVitalsEvent,
} from "./workflow-car-vitals.js"

// Filling water (loop with guard)
export {
  fillingWaterMachine,
  autoFillingWaterMachine,
  type FillingWaterInput,
  type FillingWaterContext,
  type FillingWaterEvent,
} from "./workflow-filling-water.js"

// Monitor patient
export {
  patientMonitorMachine,
  type PatientMonitorInput,
  type PatientMonitorContext,
  type PatientMonitorEvent,
} from "./workflow-monitor-patient.js"

// Accumulate room readings
export {
  roomReadingsMachine,
  produceReportActor,
  type RoomReadingsContext,
  type RoomReadingsEvent,
} from "./workflow-accumulate-room-readings.js"

// Car auction bids
export {
  carAuctionMachine,
  type Bid,
  type CarAuctionContext,
  type CarAuctionEvent,
} from "./workflow-car-auction-bids.js"

// Provision orders
export {
  provisionOrdersMachine,
  provisionOrderFunctionActor,
  applyOrderWorkflowActor,
  handleMissingIdExceptionActor,
  handleMissingItemExceptionActor,
  handleMissingQuantityExceptionActor,
  type Order,
  type ProvisionOrdersInput,
  type ProvisionOrdersContext,
} from "./workflow-provision-orders.js"

// New patient onboarding
export {
  patientOnboardingMachine,
  storeNewPatientInfoActor,
  assignDoctorActor,
  scheduleApptActor,
  type Patient,
  type PatientOnboardingContext,
  type PatientOnboardingEvent,
} from "./workflow-new-patient-onboarding.js"

// Reusing functions (child machines)
export {
  paymentConfirmationMachine,
  parentPaymentMachine,
  checkFundsActor,
  sendSuccessEmailActor,
  sendInsufficientFundsEmailActor,
  type PaymentReceivedEvent,
  type PaymentConfirmationContext,
} from "./workflow-reusing-functions.js"

// Finalize college application
export {
  collegeAppMachine,
  finalizeApplicationFunctionActor,
  type CollegeAppInput,
  type CollegeAppContext,
  type CollegeAppEvent,
} from "./workflow-finalize-college-app.js"

// Send CloudEvent (its Order type shares a name with the provision-orders example)
export {
  sendCloudEventMachine,
  provisionOrdersFunctionActor,
  type Order as CloudEventOrder,
  type ProvisionedOrder,
  type SendCloudEventInput,
  type SendCloudEventContext,
} from "./workflow-send-cloudevent.js"

// Purchase order deadline
export {
  purchaseOrderMachine,
  cancelOrderActor,
  type PurchaseOrderEvent,
} from "./workflow-purchase-order-deadline.js"

// Event-based service (vet appointment)
export {
  vetAppointmentMachine,
  makeAppointmentActor,
  type PatientInfo as VetPatientInfo,
  type AppointmentInfo,
  type VetAppointmentContext,
  type VetAppointmentEvent,
} from "./workflow-event-based-service.js"

// Media scanner
export {
  mediaScannerMachine,
  scanLibraryActor,
  checkFilePermissionsActor,
  evaluateFilesActor,
  moveFilesActor,
  type MediaScannerContext,
  type MediaScannerInput,
  type MediaScannerEvent,
} from "./workflow-media-scanner.js"
