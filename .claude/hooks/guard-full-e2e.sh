#!/usr/bin/env bash
# PreToolUse(Bash) guard — layer A enforcement (see docs/testing.md "When to run what").
#
# Denies a FULL-suite e2e run and redirects Claude to the single guarding spec:
#   blocked : npm run e2e | npm run check:all | (npx) playwright test   (no filter)
#   allowed : (npx) playwright test <name> | -g "<title>" | <file>.spec.ts | --workers=… only? no
#             i.e. any run carrying a filter (a -g/--grep or a positional spec) passes untouched.
#
# The ~9-min browser suite is CI's job, not a between-steps gate. To run the whole suite
# deliberately, run it yourself or disable this hook via /hooks. Reads the tool-call JSON on stdin.
#
# Runs on EVERY Bash call, so it FAILS OPEN: no `set -e`/`set -u` — any internal error falls through
# to a normal (allowed) permission flow rather than blocking an unrelated command.

input="$(cat 2>/dev/null || true)"
cmd="$(jq -r '.tool_input.command // ""' <<<"$input" 2>/dev/null || true)"
[ -z "$cmd" ] && exit 0

REDIRECT='Full e2e suite blocked by project policy (see docs/testing.md "When to run what"). The ~9-min browser suite belongs to CI, not a between-steps check. Run only the ONE spec guarding your change: `npx playwright test <name>` or `npx playwright test -g "<title>"`, or a unit run (`npm run test:related`). To run the whole suite deliberately, run it yourself or disable this hook via /hooks.'

deny() {
  jq -n --arg r "$REDIRECT" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 0
}

# `check:all` bundles the full e2e — always block.
if grep -Eq '(^|[^[:alnum:]_-])(npm|pnpm|yarn)[[:space:]]+run[[:space:]]+check:all([^[:alnum:]_-]|$)' <<<"$cmd"; then
  deny
fi

# Isolate the argument tail after a full-suite invocation (`npm run e2e` or `playwright test`).
if grep -Eq '(^|[^[:alnum:]_-])(npm|pnpm|yarn)[[:space:]]+run[[:space:]]+e2e([^[:alnum:]_-]|$)' <<<"$cmd"; then
  tail="$(sed -E 's/.*[[:space:]]run[[:space:]]+e2e//' <<<"$cmd")"
elif grep -Eq '(^|[^[:alnum:]_-])playwright[[:space:]]+test([^[:alnum:]_-]|$)' <<<"$cmd"; then
  tail="$(sed -E 's/.*playwright[[:space:]]+test//' <<<"$cmd")"
else
  exit 0   # not a full-suite candidate → normal permission flow
fi

# `--` (npm run e2e -- <args>) just forwards args; flatten it.
tail="$(sed -E 's/(^|[[:space:]])--([[:space:]]|$)/ /' <<<"$tail")"

# A -g/--grep filter means the run is targeted → allow.
if grep -Eq '(^|[[:space:]])(-g|--grep)([[:space:]]|=)' <<<"$tail"; then
  exit 0
fi

# Strip value-taking flags (space or = form), then any remaining flag tokens. A leftover bareword
# is a positional spec name/path → targeted → allow. Nothing left → full suite → deny.
stripped="$tail"
for f in --workers --shard --reporter --project --retries --timeout --repeat-each --max-failures -j; do
  stripped="$(sed -E "s/(^|[[:space:]])${f}=[^[:space:]]+//g; s/(^|[[:space:]])${f}[[:space:]]+[^[:space:]]+//g" <<<"$stripped")"
done
stripped="$(sed -E 's/(^|[[:space:]])-{1,2}[^[:space:]]+//g' <<<"$stripped")"
if grep -Eq '[^[:space:]]' <<<"$stripped"; then
  exit 0
fi

deny
