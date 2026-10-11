# Recording a demo

A short recording is the best thing the README can open with. This is a script that shows the point of the mod (a wrong assumption and what rests on it) without depending on the agent happening to guess wrong.

1. Use a wide terminal (at least 144 columns) with a dark theme and `palette: default` (or a named palette that matches your terminal theme). Start a fresh session in a small scratch project: `claude`, then `/ledger` if the pane is not open.
2. Paste this prompt:

   > Plan, but do not implement yet, how you would add OAuth login to this API. Use the intent ledger: log the goal, your plan steps, and the assumptions you are making (low, medium or high confidence). Link each assumption to the step that depends on it with `of`, and link sub-steps to their parent step.

3. When the pane has a goal, steps and a few assumptions, press `ctrl+x tab` to focus it, press an assumption that a step depends on, and choose **✗ wrong (drafts a reply)**. The structure tree marks everything above and below it with `⚠`, the health strip shows `✗ 1`, and a reply is drafted in the prompt box.
4. Finish and send the reply so the agent reconciles its plan (it is told about your mark once, in its next ledger result).

Capture the session as a GIF or MP4: macOS screen recording and a cropper, or a terminal recorder such as asciinema with `agg` (untested here). Keep it under about 20 seconds and save it as `docs/demo.gif`; put a still of the same moment at `docs/pane-terminal.png` for the top of the README.
