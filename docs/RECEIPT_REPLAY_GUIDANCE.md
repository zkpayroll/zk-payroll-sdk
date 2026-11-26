# Settlement receipt replay guidance

Settlement receipt handling must be idempotent: a repeated receipt must never
cause a second payroll settlement or a duplicate audit record. Consumers should
record a stable receipt identity and the settled transaction reference, then
treat matching replays as already processed.

## Safe outcomes

- A first-seen, well-formed receipt can proceed to settlement verification.
- A matching receipt identifier is an idempotent replay and should return an
  operational status without redisplaying protected receipt data.
- A reused transaction reference or a receipt identifier with conflicting
  fields requires review and must not trigger another settlement.

## Configuration and pause state

Replay-window settings should be validated as positive bounded integers before
being used by SDK clients. Error messages should explain the next operator
action while omitting payroll IDs, employee data, amounts, and transaction
values.

When a pause-state response is missing or unknown, client code should surface a
review-needed state rather than treating it as permission to submit a new
settlement.
