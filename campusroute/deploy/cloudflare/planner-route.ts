// The planner itself: one self-contained page (markup, styles and the whole
// planning engine) served as-is. It is built from the CampusRoute sources by
// `npm run build:single` and copied in as src/planner-page.html, so the hosted
// app and the repo stay the same program.

import { createFileRoute } from "@tanstack/react-router";
import plannerPage from "../planner-page.html?raw";

export const Route = createFileRoute("/planner")({
  server: {
    handlers: {
      GET: async () =>
        new Response(plannerPage, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            // The page carries the plan engine; plans themselves are fetched
            // separately and are never cached.
            "Cache-Control": "public, max-age=300, must-revalidate",
          },
        }),
    },
  },
});
