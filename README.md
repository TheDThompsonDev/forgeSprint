# Sprint Review Generator

Phase 1 of a Forge app for product managers. When a Jira sprint closes, the app records a typed sprint snapshot: sprint details, the previous closed sprints, the issues, which issues were committed at the start, and the sprint, status, and flagged changelogs. The snapshot is stored in the Forge Key-Value Store. The leadership narrative, Confluence page, and slide deck are later phases and are not in this tree.

`forge create` did not run. The manifest `app.id` is a placeholder. See [Register the app](#register-the-app).

## What you can do in this version

- A sprint-closed trigger queues `{ jobId }` and returns. Collection runs in an async consumer.
- The consumer calls Jira as the app, retries 429 and 5xx responses, and saves one snapshot per sprint id.
- The Jira project page shows collection status for that project.
- Project settings has **Generate for last closed sprint**, so a demo does not have to close a sprint. It queues the same collector. It does not generate a narrative.

## Setup

Local development was checked with Node.js 22 and Forge CLI 15. The manifest runtime is `nodejs24.x`, which the Forge manifest reference recommends. Node.js 22 and 24 are both supported by the runtime.

```bash
npm install
npm test
forge lint
```

### Register the app

The Forge CLI on this machine could authenticate, and `forge developer-spaces list --json` returned no Developer Spaces. A new Forge app has to live in a Developer Space. Creating one assigns a billing admin and can ask for billing consent, and non-interactive `forge create` / `forge register` passes `--accept-terms`. That consent was not given here, so this code was scaffolded with a placeholder id:

`ari:cloud:ecosystem::app/00000000-0000-4000-8000-000000000000`

`forge lint` rejects an app id that is not a UUID. This value matches the UUID shape and is not an app Forge issued. `forge register` replaces it.

On your machine:

1. Install the CLI: `npm install -g @forge/cli`
2. Log in. Use the interactive command, and do not paste a token into chat:

   ```bash
   forge login
   ```

   On a machine with no keychain, the Forge docs say to export `FORGE_EMAIL` and `FORGE_API_TOKEN` and then run other Forge commands directly. Do not also run `forge login` when those variables are set.

3. Create a Developer Space in the [Developer Console](https://developer.atlassian.com/console/) (**Create Developer Space**). The CLI only has `forge developer-spaces list`. The interactive `forge register` prompt can also create a space. You may be asked for billing consent. That step is yours.
4. From this directory, register this tree so Forge writes a real app id into `manifest.yml`:

   ```bash
   forge register sprint-review-generator
   ```

   If you already know the space id and you intend to accept the Forge terms yourself:

   ```bash
   forge register sprint-review-generator --developer-space-id <developer-space-id> --accept-terms
   ```

   Do not run `forge register` a second time. A second registration mints a new app id and disconnects environments and storage from the first one.

`forge create` is the right command when you want the CLI to scaffold a new app from a template. It is the wrong command for this directory, because the source is already here. `forge register` is what the Forge docs say to run for an app that was not created with `forge create`.

This phase was not deployed or installed.

## Scopes

Only these three scopes are declared. Each one is required by a current API or module this phase calls.

| Scope | Why it is here |
| --- | --- |
| `read:jira-work` | Classic Jira scope. Sprint events list it as the classic scope for `avi:jira-software:closed:sprint`. The current OAuth scope on `POST /rest/api/3/search/jql`, `POST /rest/api/3/changelog/bulkfetch`, `GET /rest/api/3/issue/{issueIdOrKey}/changelog`, `GET /rest/api/3/field`, and `GET /rest/api/3/status` is `read:jira-work`. |
| `read:sprint:jira-software` | Granular scope listed on the sprint events page, and the OAuth scope on `GET /rest/agile/1.0/sprint/{sprintId}` and `GET /rest/agile/1.0/board/{boardId}/sprint`. Classic `read:jira-work` does not cover those Agile operations. |
| `storage:app` | Required by `@forge/kvs`. |

`GET /rest/agile/1.0/board` needs `read:board-scope:jira-software` plus another scope. Those scopes are not requested. The settings button finds the last closed sprint with JQL instead of listing boards.

No Confluence scopes are declared.

## How to test Phase 1

1. `npm test` checks pagination, retries, the snapshot shape, changelog filtering, and the manifest. It does not call Jira or Forge.
2. `forge lint` looks up the app id. Until `forge register` replaces the placeholder, it exits with `Your app could not be found`. The manifest itself was checked with `@forge/manifest` 13.8.0 `validate()`, which returned no errors. Run `forge lint` again after register.
3. After you register, deploy, and install the app on a Jira site (`forge deploy -e development`, then `forge install` for the Jira product), either:
   - close a sprint on a Scrum board in a project where the app is installed, or
   - open that project's **Project settings → Sprint review settings** and choose **Generate for last closed sprint**.
4. Sprint triggers can take up to 3 minutes to arrive. The consumer may then run for longer than a normal function because its timeout is 900 seconds.
5. `forge logs` should show a line like `Collected sprint <id>: <n> issues`. The log does not include issue summaries.
6. Open the project page **Sprint reviews**. The sprint should move from `queued` or `collecting` to `collected`, with issue and warning counts.
7. Close the same sprint's event again, or let Forge redeliver it. The trigger does not enqueue another job when that sprint is already `collected`, and the snapshot is stored under one key, `snapshot:sprint-<id>`.

The settings button forces a new collection for the same sprint id. It still writes that one key, so it does not create a second snapshot.

## Where the data lives

| Key | Value |
| --- | --- |
| `job:sprint-<id>` | Status, counts, and short warnings. No issue text. |
| `snapshot:sprint-<id>` | The `SprintSnapshot` object, or a manifest when the JSON is too large. |
| `snapshot:sprint-<id>:part:<n>` | Base64 parts when the snapshot is larger than 200,000 characters. The Key-Value Store limit is 240 KiB per value. |
| `project:<projectKey>` | Up to 25 sprint ids for the project page. |

A snapshot has `schemaVersion: 1` and includes the sprint, project, recent closed sprints, issues, committed issue ids, changelogs, and warnings.

## Doc disagreements

Where the handoff and the current Forge or Jira docs differ, the docs were followed.

1. **App id.** The handoff says to start with `forge create` and never hand-write `app.id`. `forge create` was not possible here: the CLI was authenticated, but there was no Developer Space, and creating one plus `--accept-terms` would accept Forge terms and billing consent. The id is an obvious placeholder, not a fake UUID. `forge register` is the documented command for a tree that was not created by `forge create`.
2. **Queue body.** `@forge/events` 2+ (this app uses 3.0.9) requires `queue.push({ body: { jobId } })`. A bare `{ jobId }` throws `Event body must be an object.` The consumer reads `event.body.jobId`. The platform also returns its own queue job id from `push`; the body id is the stable `sprint-<sprintId>` id.
3. **Consumer module.** Current docs use `consumer.function` for `@forge/events` 2+. The v1 `consumer.resolver` form is deprecated. `crossVersion` was not set. The consumer docs describe it as temporary and scheduled for removal after 21 November 2025.
4. **Timeouts.** A normal function, including the trigger and the UI resolver, stops after 25 seconds. An async consumer defaults to 55 seconds and can be raised to 900 with `timeoutSeconds` on a function that only the consumer uses. The consumer function is set to 900. The trigger only writes the job and enqueues it.
5. **`requestJira` context.** The handoff says a UI Kit resolver that calls `requestJira` without `asUser()` returns 401. The requestJira docs say `asApp()` works when the app has the scopes, bare `requestJira` is the unauthenticated client, and `asUser()` is only available in UI Kit modules. UI resolvers use `asUser()`. The trigger and consumer use `asApp()`.
6. **Classic and granular scopes.** The Jira scope page says to prefer classic scopes and to use granular scopes only when a classic scope cannot do the job. Sprint events list both `read:jira-work` and `read:sprint:jira-software`. The Agile sprint operations require the granular scope, and issue search and changelogs currently require the classic scope. Both stay, for those two different APIs.
7. **Issue search.** `POST /rest/api/3/search` is deprecated (CHANGE-2046). Collection uses `POST /rest/api/3/search/jql`, which returns `nextPageToken` and `isLast`.
8. **Board sprint pages.** `GET /rest/agile/1.0/board/{boardId}/sprint` pages with `startAt` and `isLast`, not a page token. Token pagination is used for issue search and for changelog bulkfetch.
9. **`statusCategory`.** It is not its own search field. The status object includes `statusCategory`, and the snapshot copies that onto each issue.
10. **Project on each issue.** The handoff's field list does not include `project`. The search requests it so the project page can find the snapshot. Listing boards to discover the project would need extra scopes.
11. **Key-Value Store versus Forge SQL.** The Forge docs index prefers Forge SQL for new relational designs. The storage docs describe the Key-Value Store as the fit for one JSON value addressed by a key. A sprint snapshot is that shape, and this phase was asked to use KVS and `storage:app`. Values over the 240 KiB limit are split into parts.
12. **Runtime.** The manifest reference recommends `nodejs24.x`. The app uses that.

## Assumptions the docs did not confirm

- The start day for `status WAS IN (...) ON "<day>"` is the `YYYY-MM-DD` prefix of the sprint `startDate` string Jira returns. That prefix is already in the offset Jira used. There is no separate site-timezone conversion.
- Story points are the field named `Story Points` or `Story point estimate`. A schema custom value containing `jsw-story-points` wins when several names match. That custom value is not in the Jira OpenAPI schema.
- Sprint and Flagged fields are the fields whose `clauseNames` contain `sprint` and `flagged`.
- The Sprint custom field value on an issue is an array of objects with `id`, `state`, `completeDate`, and sometimes `boardId`. That shape is not in the platform OpenAPI schema. The settings button depends on it. If it is wrong, the button reports that no closed sprint was found; closing a sprint still uses the trigger payload and `GET /rest/agile/1.0/sprint/{sprintId}`.
- A Jira project page's `extension.project.key` is the project key. That is what Atlassian's `forge-jql-editor-custom-ui` example reads. `extension.project.id` was not confirmed and is not required.
- Changelog bulkfetch is used first. HTTP 400, 404, 410, or 501 falls back to `GET /rest/api/3/issue/{issueIdOrKey}/changelog` with at most 4 concurrent issue requests. The concurrency number is a local limit, not a documented Jira limit.
- `Retry-After` is a number of seconds, as the Jira rate-limiting page says. Waits longer than 30 seconds are not slept inside the function. The consumer returns `InvocationError` with `FUNCTION_UPSTREAM_RATE_LIMITED` so Forge retries the event. `retryAfter` is capped at 900 seconds, which is the async-events maximum.
- Collection stops after 2,000 issues, 20 pages of closed sprints, or the changelog page caps in `src/collect/constants.js`. The snapshot then has `truncated: true` and a warning. Those caps are local safety limits.
- The committed-at-start JQL is skipped when it would be longer than 8,000 characters. A Jira maximum query length was not confirmed.
- Nested JSON `null` is avoided. The KVS docs say null is not a supported value.
- Changelog authors and assignees are stored as account ids only. Display names are not stored. `report:personal-data` is not requested because this phase does not call the privacy API.
- Re-delivery of a collected sprint does not enqueue again. A crash during collection can run the consumer again. Both writes use the same sprint key. Phase 1 does not publish a page, so a repeated collection does not create a second page.

## Layout

```
manifest.yml
src/index.js
src/triggers/sprintClosed.js
src/jobs/generateReview.js    # consumer: collect and save only
src/collect/
src/storage/
src/resolvers/ui.js
src/frontend/
test/phase1.test.js
HANDOFF.md
```

`src/compute`, narrative, Confluence, and Google Slides are intentionally absent.
