# Semgrep findings reviewed on 2026-11-08

Source: [main scan 42487302669](https://github.com/anpuuuuu/apgo-theme/actions/runs/42487302669), commit `6991a9416f257c9c6ee9c5f7dd0c7e223ccc2cac`. Line numbers below refer to that scan, before these edits.

The two storefront findings carry static video play/pause commands, not customer details. They still use an unnecessarily broad messaging boundary, so both are fixed. The other fourteen findings are in developer-run QA scripts, not theme assets shipped to customers. Their data sources and dispositions are recorded individually below. None establishes an exploitable storefront path-traversal, SSRF, or regex-denial-of-service vulnerability.

| # | Original location | Rule | Assessment and action |
|---|---|---|---|
| 1 | `assets/media.js:99` | wildcard-postmessage-configuration | Play command used `*`. Send only to the exact HTTPS origin of a recognized YouTube/Vimeo iframe. Reject other hosts, ports, credentials and provider mismatches. |
| 2 | `assets/media.js:120` | wildcard-postmessage-configuration | Pause command used `*`. Uses the same validated messaging boundary as play. |
| 3 | `qa/aurora-pwp.js:21` | path-join-resolve-traversal | Local fixture reader, used by intercepted `/assets/` requests and literal snippet reads. No storefront server exposure. Add realpath-based repository confinement, including symlinks, then annotate the validated path resolution only. |
| 4 | `qa/cart-row-removal.js:14` | path-join-resolve-traversal | Same local fixture pattern. Add realpath confinement; preserve the two literal-file baseline reads through `execFileSync` argument arrays. Annotate only the validated resolution. |
| 5 | `qa/devices.js:59` | path-join-resolve-traversal | Screenshot directory is passed only by `runDevice`, whose device ID is an own key of the fixed `DEVICES` table; filename is literal. False positive; annotate this line. |
| 6 | `qa/devices.js:67` | path-join-resolve-traversal | Same directory provenance and literal checkout screenshot name. False positive; annotate this line. |
| 7 | `qa/devices.js:81` | path-join-resolve-traversal | CLI device selection was already checked against `DEVICES`. Make the check reject inherited keys and also enforce it at `runDevice` entry. Annotate the resulting fixed-key output path. |
| 8 | `qa/devices.js:95` | path-join-resolve-traversal | Screenshot uses the validated device directory and `pg.id` from the literal `PAGES` table, not page content. False positive; annotate this line. |
| 9 | `qa/devices.js:102` | path-join-resolve-traversal | Same as #8 with literal `-scrolled.png` suffix. False positive; annotate this line. |
| 10 | `qa/lib.js:60` | playwright-evaluate-arg-injection | Playwright executes a fixed callback; its arguments are serialized data, not JS source. All current callers use literal cart paths. Add an explicit three-route allowlist before evaluation; annotate the data-only call. This is a browser fetch in a QA session, not a server-side fetch. |
| 11 | `qa/sale-1111.js:48` | detect-non-literal-regexp | `wordsSrc` was the source of a fixed regex in the same file, never customer input. Use that regex literal directly in the browser callback, eliminating the dynamic construction and finding. |
| 12 | `qa/sale-1111.js:109` | path-join-resolve-traversal | Output name used developer-controlled environment selections. Enforce own keys of `DEVICES` and the intended MY/SG market allowlist before opening a browser. Annotate this validated output path. |
| 13 | `qa/static.js:20` | path-join-resolve-traversal | `dir` starts in literal theme-directory lists and recurses through local filesystem entries. No request/URL/env input reaches it. False positive; annotate this line. |
| 14 | `qa/static.js:23` (first result) | path-join-resolve-traversal | `dir` has the same repository-walk provenance as #13. False positive; annotate the join. |
| 15 | `qa/static.js:23` (second result) | path-join-resolve-traversal | Same join, second rule match for `d.name`, a single local Dirent name. The same annotation covers this duplicate. |
| 16 | `qa/static.js:28` | path-join-resolve-traversal | `read` is only called with paths returned by the repository walker. No external caller or request handler. False positive; annotate this line. |

Annotations use exact rule IDs immediately at the reviewed lines. They do not exclude QA files, paths, or rules globally. New occurrences remain scanned. Tests in `qa/semgrep-regression.js`, included in `qa/security.js`, exercise the actual media class and fixture readers plus the cart helper's accepted/rejected targets. They make no storefront or third-party requests.

PR and main Semgrep jobs now both scan the full tree. The previous PR-only baseline hid old findings until the main push; that inconsistency is removed. Gitleaks retains its existing history-range behavior.

References: [HTML messaging target origins](https://html.spec.whatwg.org/dev/web-messaging.html), [Semgrep inline finding annotations](https://semgrep.dev/docs/ignoring-files-folders-code#ignore-code-through-nosemgrep).
