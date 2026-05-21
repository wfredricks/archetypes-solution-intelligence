# @solution-intelligence/identity 🖇️

**SI/I — bangauth wrapper enforcing Solution Intelligence's 5-role permission matrix.**

![version](https://img.shields.io/badge/version-0.1.0--pre-orange)
![status](https://img.shields.io/badge/status-Stage%201b%20scaffold-yellow)
![license](https://img.shields.io/badge/license-Apache--2.0-blue)

Part of [Solution Intelligence v0.1](https://github.com/wfredricks/solution-intelligence). This package is the identity and authorization boundary for SI: every state-changing operation in Studio, Graph, and Window is attributed to a logged-in operator through this layer, and every guarded route is gated by SI's 5-role matrix.

## Status

**Stage 1b scaffold — `0.1.0-pre`.** No functional code yet. The real identity layer lands in **Stage 6** of the SI v0.1 build (see [BUILD-PLAN.md](https://github.com/wfredricks/solution-intelligence/blob/main/BUILD-PLAN.md) in the bookend).

What is shipped today:

- The package builds (`npm run build`) and produces `dist/index.js`.
- The smoke test passes (`npm test`) — `VERSION === '0.1.0-pre'`.
- CI is green on Node 20.x and 22.x.

Treat this release as an *infrastructure receipt*: the toolchain, the CI matrix, and the governance layer are verified so Stage 6 can land real behavior without first having to debug scaffolding.

## Eventual role

`@solution-intelligence/identity` wraps [bangauth](https://github.com/wfredricks/bangauth) and binds it to SI's role model:

| Role | Powers |
|------|--------|
| **operator** | Provisions projects, invokes parsers, triggers analysts |
| **analyst** | Reads SIG, attaches findings, runs validation suites |
| **reviewer** | Approves or rejects findings; signs deliverables |
| **consumer** | Read-only access through SI/W role-scoped views |
| **admin** | Full surface; rare; audited heavily |

Every guarded API in SI ultimately calls into this package's role guard. Every state-changing call produces a chainblocks audit block attributed to the acting role and user (REQ-SI-NF-031, MODEL.md §3).

## Install

```bash
npm install @solution-intelligence/identity
```

> Not yet published to npm. Until Stage 7, this package is consumed as a `file:` dependency from sibling SI repos, or directly from the git remote.

## Development

```bash
npm install
npm run build
npm test
```

## Where this fits in SI

| Component | Role |
|-----------|------|
| **SI/I** *(this)* | Identity, authentication, 5-role authorization |
| **SI/S** Studio | Blackboard substrate + parser/analyst host |
| **SI/G** Graph | Durable graph adapter + chainblocks audit |
| **SI/W** Window | Consumer-facing role-scoped views |
| **SI/CLI** | Operator entrypoint (`si init`, `si add`, `si destroy`) |

See the [Solution Intelligence bookend](https://github.com/wfredricks/solution-intelligence) for the full architecture.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](./LICENSE).
