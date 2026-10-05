# Threat model

## Assumptions

- Every prompt is written by an attacker.
- The model follows the attacker's instructions completely. The system prompt is a quality measure, not a control.
- The attacker knows this repository.

The goal is that under these assumptions the attacker gains nothing beyond a static page that passed the checker.

## What is worth protecting

| Asset | Where it lives | Who can read it |
| --- | --- | --- |
| Anthropic API key | `/etc/agent-playground/proxy.env`, environment of the proxy container | root |
| Deploy key for the apps repository | `/etc/agent-playground/deploy_key` | orchestrator user |
| The host | | |
| Visitors of published apps | their browsers | |
| The budget | Anthropic workspace | |

## Trust boundaries

1. **Internet → orchestrator API.** Untrusted HTTP. Input is a prompt of limited length and a captcha token, validated with a schema. Job ids in URLs must match a fixed pattern before they touch the database.
2. **Orchestrator → sandbox.** The orchestrator passes exactly three things into the container: the prompt on stdin, a job token in the environment, and an empty workspace with the bundled libraries. The command line is fixed in the image.
3. **Sandbox → key proxy.** The only network path out of the sandbox. The proxy treats the container as hostile.
4. **Sandbox → orchestrator (the workspace).** Whatever the agent wrote is hostile data. It is read by the checker and never executed on the server.
5. **Orchestrator → GitHub.** Git runs with a deploy key scoped to one repository and a pinned host key.
6. **Published app → visitor.** The app runs in the visitor's browser under a policy the agent cannot change.

## Threats and controls

### The hijacked agent tries to act on the server

- It has no tool that executes anything. Claude Code runs with `--restricted` and a fixed list of file tools, set in the image's entrypoint.
- File tools are confined to the workspace. Even without that, the container's root filesystem is read-only and holds nothing of value.
- The container runs as an unprivileged user with all capabilities dropped, `no-new-privileges`, and limits on memory, CPU and process count.
- The sandbox network is an internal Docker network without a host-side gateway address. From inside, the internet, the host's own services and the cloud metadata address are unreachable. This was verified by probing from a container, and the first version failed that probe: the host's SSH port answered on the bridge gateway until the gateway was removed.
- A job that exceeds its time limit is killed, and the container is removed after every job.

### The hijacked agent tries to steal or abuse the API key

- The key is not in the container. The agent holds a token of the form `pgj1.<job>.<expiry>.<hmac>` that only the proxy accepts and that expires with the job.
- If the agent writes that token into the app, the checker rejects the app. Outside the sandbox network the token is useless anyway, because the proxy is not reachable from anywhere else.
- The proxy forwards only `POST /v1/messages`, only for allowed models, with `max_tokens` capped, and stops forwarding once a job has used its request or output-token budget.
- The proxy refuses requests that declare server-side tools or MCP servers. Without this, code running in the container could ask Anthropic's servers to fetch URLs on its behalf.
- The proxy forwards four request headers and nothing else, and is built from Node built-ins only.

### The hijacked agent tries to publish something harmful

The checker is plain code and decides alone. It rejects:

- anything that is not a regular `.html`, `.css`, `.js`, `.json` or `.txt` file with a plain name, within the size limits;
- files that contain known credential formats, a job token or one of the server's own secrets;
- inline scripts and event handlers, scripts and resources from other origins, absolute or parent-relative URLs, `javascript:` URLs, references to files that do not exist;
- `<iframe>`, `<object>`, `<embed>`, `<base>`, meta refresh, preconnect and prefetch hints;
- forms with a target, password fields and fields that ask for card data or credentials;
- external URLs in CSS and in scripts.

HTML that passes is parsed and written out again with three additions at the very top of `<head>`: a Content Security Policy, a job marker and a no-referrer policy. A badge marking the page as AI-generated is appended to `<body>`. An existing policy from the agent is dropped.

The policy is the actual enforcement. With `connect-src 'none'`, `form-action 'none'` and `script-src 'self'`, a page cannot send data anywhere or load code from elsewhere, whatever its scripts try. The checks before it exist so that a rejected app fails loudly with a reason instead of being published broken.

### The attacker targets the pipeline itself

- **Command injection.** The prompt is never part of a command line, a path or a commit message. Subprocesses (`docker`, `git`) are started with argument arrays. The only request-derived value used in paths is the job id, which the server generates from random bytes.
- **Path tricks in the workspace.** Symlinks, special files, dotfiles, odd names and deep nesting are rejected before any content is read. Output paths are built from names that passed a strict pattern.
- **Tampering with bundled libraries.** The agent's copy of `lib/` is ignored. Referenced libraries are published from the pristine copies on the server.
- **Leaking internals through errors.** Visitors see fixed messages. Details go to the server log.

### The attacker targets the budget or the service

- Turnstile in front of job creation, verified on the server.
- Three jobs per visitor per hour (IPv6 visitors are counted per /64), ten per hour and thirty per day overall, a queue of ten.
- One job at a time, each with a hard timeout and a token budget.
- A monthly spend limit on the Anthropic workspace as the outer bound.
- Visitor addresses are stored only as keyed hashes.

## Known trade-offs

- **The orchestrator can use Docker.** It starts containers through the Docker socket, which is equivalent to root on the host. The orchestrator is trusted code and handles the prompt only as data, but a bug in it would be serious. A narrower design would move container start-up into a small root-owned launcher that accepts nothing but a job id.
- **Navigation cannot be blocked.** No browser policy stops a script from redirecting the top-level page. The checker rejects scripts that contain external URLs, but an obfuscated one would pass. The page could then send the visitor to another site, without being able to read or submit anything first.
- **Shared origin on github.io.** All published apps share one origin with each other and with other project pages of the same account. They can read each other's local storage. Nothing sensitive may ever be hosted on that origin.
- **The checker is not a content filter.** It enforces what a page can do, not what it says. Offensive text passes. The badge, the captcha and the ability to delete an app are the answer to that.
- **Policy as a meta tag.** GitHub Pages cannot send response headers, so the policy is delivered in the document. `frame-ancestors` is not available that way, so apps can be framed by other sites.
