Dialogue could not set up a live preview of this repository automatically.
Help fix `.dialogue/preview.json`, the file that tells Dialogue how to serve
the preview (its format is described in {{setupPromptPath}}). The last
attempt failed like this:

{{failure}}

The full setup log is at {{logPath}}. Investigate, fix the recipe (or
whatever in the project prevents it from running), and tell me in plain
language what was wrong. Use dialogue_preview for status or queue install/start/restart/stop, then
finish your reply. Dialogue re-checks after your worker releases its reservation.
Never start a development server or install dependencies inside the agent worker. Do not commit; I will use the COMMIT button when it works.
