LingQuest v43 Fresh Live Stats Package

Upload the CONTENTS of this folder to the root of a NEW Vercel project.

Required root structure:
index.html
admin.html
package.json
vercel.json
api/track.js
api/events.js
api/clear.js
api/health.js

After uploading:
1. Create/connect a Vercel Blob store to this exact project.
2. Confirm the project has BLOB_READ_WRITE_TOKEN in Environment Variables.
3. Redeploy after connecting Blob.
4. Open /api/health. It should return ok:true and writeTest:true.
5. Open the demo and solve one flow.
6. Open /admin.html. Stats auto-refresh every 3 seconds.

Important:
- Do not upload the outer ZIP folder as a subfolder. The files above must be at project root.
- If /api/track opened directly shows "Method not allowed", that is normal because it only accepts POST.
- If /api/health returns missing token, reconnect Blob and redeploy.
