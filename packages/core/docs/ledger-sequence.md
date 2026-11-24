# Ledger sequence conversion

`toLedgerSequence` accepts a safe integer, a non-negative decimal string, or a bigint, and returns a number in `0..=4294967295`. Fractions, leading zeroes, signs, and values above the Soroban ledger maximum throw `LedgerSequenceError`. The rejected value is not copied into the error.
