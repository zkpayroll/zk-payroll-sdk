# Public proof input length

`parsePublicInputs` measures the raw payload before `JSON.parse`. An empty payload or one larger than 4096 bytes is rejected first. A parsed value must be an array of 1 to 64 field-element strings. Failures use `PublicInputLengthError` and do not include the payload.
