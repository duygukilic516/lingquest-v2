LingQuest v45 Append-Only Private Stats Package

This package fixes users appearing as solved/saved and later looking incomplete.
Stats backend is append-only:
- every user action is saved as its own private Blob event file
- later requests cannot overwrite earlier save/completion events
- admin reconstructs sessions from all events

Designed for PRIVATE Vercel Blob stores.

Upload CONTENTS to project root, then redeploy.
Check /api/health: it should show ok:true, access:'private', mode:'append-only'.
Admin: /admin.html or /admin.


Legacy stats compatibility:
api/events.js reads both new events-v45 append-only records and old sessions-v35/session records, so existing admin stats stay visible after the upgrade.
