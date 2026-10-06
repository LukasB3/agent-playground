# The disposable environment the coding agent runs in. It contains Claude Code
# and nothing else of value: no git, no credentials, no route to the internet.
FROM node:22-bookworm-slim

ARG CLAUDE_CODE_VERSION=2.1.289
RUN npm install --global @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
 && npm cache clean --force \
 && rm -rf /root/.npm /tmp/*

COPY system-prompt.md /opt/agent/system-prompt.md

ENV DISABLE_AUTOUPDATER=1 \
    DISABLE_TELEMETRY=1 \
    DISABLE_ERROR_REPORTING=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

USER node
WORKDIR /workspace

# The flags are fixed in the image so the orchestrator cannot be talked into
# loosening them: file tools only, no shell, no web, no MCP, no settings files.
ENTRYPOINT ["claude", "--print", "--restricted", \
  "--tools", "Read,Write,Edit,Glob,Grep", \
  "--permission-mode", "acceptEdits", \
  "--permission-prompts", "none", \
  "--strict-mcp-config", "--setting-sources", "", \
  "--no-session-persistence", \
  "--output-format", "stream-json", "--verbose", \
  "--append-system-prompt-file", "/opt/agent/system-prompt.md"]
