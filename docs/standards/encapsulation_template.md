# Encapsulation Template

Default reference for creating a new encapsulated piece in this repo.

## What counts as an encapsulated piece

An encapsulated piece is a folder-level ownership boundary with:
- colocated code
- a colocated `README.md`
- explicit ownership and non-ownership
- stable entrypoints for callers

## Default folder shape

Base pattern:

```text
feature_name/
  README.md
  route.ts
  service.ts
```

Optional additions:

```text
  types.ts
  queries.ts
  commands.ts
  adapters.ts
  *.test.ts
```

Use only the files the feature actually needs.

## Required README contents

Every encapsulated feature README should include:
- purpose
- owns
- does not own
- how to talk to it
- dependencies
- side effects

Optional:
- notes
- future extraction notes

## Default README starter

```md
# <feature_name>

Colocated README for the encapsulated <feature_name> feature.

## Purpose

## Owns

## Does not own

## How to talk to it

## Dependencies

## Side effects
```

## Route / service split guidance

When a feature is HTTP-exposed:

- `route.ts` owns HTTP parsing, method/path checks, auth/session transport usage, and status mapping
- `service.ts` owns reusable interface-facing behavior
- routes should call services rather than owning domain rules directly

Not every feature needs both files.

## What stays outside the feature

Do not force unrelated concerns into the feature folder.

Usually keep outside:
- deep domain ownership that belongs elsewhere
- unrelated storage ownership
- global host/process composition
- presentation systems the feature does not authoritatively own

## When to extract

Good extraction signals:
- a large mixed-responsibility file
- repeated call patterns
- a stable capability seam
- a clear ownership boundary
- a need for colocated documentation

## When not to extract yet

Delay extraction when:
- ownership is unclear
- multiple abstractions overlap heavily
- naming is still ambiguous
- the result would be file shuffling without a clearer boundary

## Migration pattern

Recommended sequence:

1. identify the seam
2. extract behavior without changing semantics
3. create the feature folder
4. add the colocated `README.md`
5. update imports to the feature folder
6. delete compatibility shims when unused
7. verify typecheck and runtime behavior

## Naming guidance

Prefer feature/capability names over role buckets.

Good long-term folder names:
- `target/`
- `place_query/`
- `action_submission/`
- `session_health/`

Avoid using these as the primary long-term ownership boundary:
- `routes/`
- `services/`
- `utils/`

Those can exist temporarily during migration, but feature folders are preferred.

## Current example

See:
- `src/interface_program/target/`
