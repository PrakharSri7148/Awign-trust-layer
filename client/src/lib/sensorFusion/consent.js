// DRAFT wording for the visit-recording consent. It has NOT been reviewed by anyone responsible for privacy or legal: the
// retention period and the final text are the deployment owner's decision (Sensor-fusion/iteration-1.md D7, D8).
export const CONSENT_KEY = 'fusion.consent.v1'
export const CONSENT_TITLE = 'Record my approach to the site'
export const CONSENT_TEXT =
  'While this page is open, the app records your phone\'s location and movement (accelerometer and gyroscope summaries) for up to 10 minutes, and sends them with your submission to check that the visit is genuine. Location points are deleted after the retention period; scores and flags are kept. You can use the app without this, but the submission may be sent for review.'
// The one sentence that is always visible next to the start button (the full text is one tap away). Same draft status.
export const CONSENT_SHORT = 'Your location and phone movement are recorded for up to 10 minutes and sent with your submission. Optional.'
