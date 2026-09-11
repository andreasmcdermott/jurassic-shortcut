# Jurassic Shortcut

A real 3D Shortcut workspace navigator inspired by Silicon Graphics' **fsn**, the Unix file browser in *Jurassic Park*. Built with Three.js, Vite, and a local Express server. Read-only and intended for a local demo.

## Run it

Install Node.js 22 or newer, then run:

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:1993**. The fictional Isla Nublar workspace is available immediately, with 4 objectives, 16 epics, 144 stories, and 432 tasks. No API token or internet connection is required for demo mode after installation.

For a built version:

```sh
npm run build
npm start
```

Both commands serve the same address. Stop the dev server before running the built version. Set `PORT` to use another port.

## Connect Shortcut

An invalid token triggers a Dennis Nedry rejection screen with a finger-wag animation and “Ah ah ah! You didn't say the magic word!” Choose **Try another token** to retry. Network and other API errors retain their normal messages. The animation respects reduced-motion preferences.

Choose **Connect Shortcut…** and paste a token from [Shortcut's API token settings](https://app.shortcut.com/settings/account/api-tokens). The token uses your existing Shortcut access. This app only exposes allowlisted read operations; it cannot change your workspace.

Tokens remain in the Node process's memory. The browser receives an opaque, HttpOnly, SameSite cookie, and clears the token input after connecting or closing the dialog. Tokens are never stored in localStorage, files, or source code. Sessions expire after eight hours or when the server stops. Choose **workspace root**, clear the selection, and use **Disconnect & return to demo** to remove the token from the server.

The server binds to loopback and rejects foreign origins for API requests. Keep it local; this is not a hosted, multi-user service.

## Navigate

- Click a block or platform to inspect it. Double-click to enter.
- Drag to orbit, right-drag to pan, and scroll to zoom. Touch supports orbit, pinch, and pan.
- Use arrow keys to select nearby sibling objects in screen directions. With no selection, the first arrow key selects the object closest to the center of the view. At an edge, selection stays put. Navigation uses objects rendered on the current page.
- Press **F** to fly to the selected object, including a selected search result. Press **Enter** with the 3D view focused to open the selection.
- Focus the 3D view and use WASD to fly; Q and E move down and up. Arrow keys select objects instead of moving the camera. Shortcuts leave text fields, sliders, dialogs, and modified browser shortcuts alone.
- **Bird's eye**, **front view**, **Tilt**, and **Height** adjust the camera. **Reset** frames the current directory.
- **Alt+B** goes back; **Alt+R** resets the camera; **/** focuses search.
- The directory list supports keyboard selection and Enter to open. **Fly to object** finds a selected search result in its directory.
- **Marks** keep locations for the current session. The path bar navigates to ancestors.
- **1993 pixels** lowers render resolution and adds subtle scanlines.

Platforms represent objective and epic directories. Colored blocks represent their contents. Color indicates time since the last update, using the age legend. Story block height reflects its estimate. The translucent beam marks the selected object. It glides between selections over 320 ms with a gentle start and stop. Rapid selections redirect it from its current position; background loading does not restart the motion. The first selection in a new directory appears in place. Reduced-motion preferences disable the glide. Camera flight remains a separate action on F. The overview renders the same 3D scene from above and includes a camera marker.

The three antennas count the platform’s direct, loaded, non-archived contents. Objectives count epics; epics count stories. Blue means unstarted, amber means in progress, and green means completed. Heights are proportional within each platform, with its largest status count at full height. Compare the three antennas on one platform; heights do not compare absolute totals across platforms. A bare gray socket means zero loaded items in that status. The inspector shows exact counts and flags partially loaded directories or unknown statuses. Counts include all loaded children, beyond the 24-block preview and 64-item page. Custom story column names use their underlying Shortcut workflow types.

## Loading and limits

The app uses the [Shortcut REST API v3](https://developer.shortcut.com/api/rest/v3). It loads objectives, paginated epics, workflow states, and members first. Two background workers then fetch story lists for each active epic. Opening an epic prioritizes its request. Selecting or opening a story loads its full description and tasks. Duplicate requests share the same promise. The local proxy spaces requests below Shortcut's 200-per-minute limit and retries rate-limited responses.

Epics can appear under multiple objectives. Legacy `milestone_id` relationships are supported. Epics without objectives and stories without epics have separate folders. Archived entities are omitted from the navigable directories. Search covers loaded data, and workspace totals count only loaded, non-archived records.

Shortcut limits a search to 1,000 results. The unassigned-story folder therefore loads at most 1,000 stories and reports when this cap applies. Stories in epics use the epic story endpoint, avoiding the search cap. Tasks load on demand instead of requiring a request for every story in a large workspace.

Directories render 64 objects per page, with at most 24 preview blocks per platform. All loaded data remains searchable. Three.js instances the colored boxes, keeping draw calls low even when a page contains many preview blocks. Background loading preserves the camera position; use Reset after a large directory has finished growing.

If a directory fails to load, select it and choose **Retry loading**. Use **Refresh from Shortcut** to retry failed workspace metadata or the unassigned-story search. Switching workspaces cancels the previous loader and replaces the visible data. Refreshing the page resumes a valid session and restores cached data.

Sub-tasks are Shortcut story checklist tasks. Linked stories are separate story records, not checklist tasks. Descriptions display as plain text; Markdown and embedded HTML are not rendered. Shortcut links open in another tab. Demo entities have no real Shortcut links.

## Local cache

The server saves successful Shortcut data responses incrementally as compressed files in `.shortcut-cache/` inside this project. This folder is ignored by Git. Files use owner-only permissions and atomic replacement. Tokens, session cookies, and request headers are not saved. Each workspace, member, and token combination has a separate cache, identified by a SHA-256 digest. Changing tokens starts a separate cache.

On page reload or reconnect, the app restores the cached hierarchy, completed epic loads, and any story details and tasks already fetched. It only requests missing directories or details from Shortcut. Incomplete initial loads resume instead of starting over. Corrupt cache entries are skipped and fetched again.

Cached data has no automatic expiry. Choose **Refresh from Shortcut** above the field to discard the current cache and fetch current data, including removals and status changes. The cache bar shows the most recent cache write, which is not a guarantee that every cached record is that recent. Refreshing affects only local data and does not write to Shortcut.

After a Node server restart, enter your API token again. The server makes one live identity request to validate the token, then reuses cached workspace data. Tokens intentionally remain memory-only, so a new authenticated session still requires a connection to Shortcut. Existing sessions can browse already cached data while offline.

The first run with caching enabled must populate the cache. Disconnecting removes the token but retains the data cache for your next connection. To erase all locally cached workspace data, stop the server and delete the `.shortcut-cache/` folder.

## Verify

```sh
npm test
npm run build
```

Tests cover hierarchy assembly, multi-objective epics, incremental loading, pagination, lazy tasks, retries, canceled loads, token sessions, origin checks, the read-only proxy, and ray-picking real 3D block geometry. Cache tests verify persistence across server instances, credential isolation, corrupt-file recovery, refresh behavior, and restoring loaded tasks without refetching. Live API behavior requires a real workspace token.

The page optionally exposes directory reading and navigation through WebMCP where the browser supports it. Native WebMCP and visual browser validation were not exercised during implementation.

## Source

- `src/world.js`: Three.js scene, geometry, instancing, cameras, picking, and movement.
- `src/main.js` and `src/style.css`: workstation interface and navigation.
- `src/data.js`: hierarchy model and fictional demo workspace.
- `src/loader.js`: incremental Shortcut loader.
- `server/shortcut.js`: session handling and read-only API proxy.
- `server/cache.js`: incremental disk cache and refresh invalidation.

An unofficial fan project. It is not affiliated with Shortcut, Silicon Graphics, or the Jurassic Park franchise.
