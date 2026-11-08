# Ideas to look into later

Ideas the owner wants kept for a future session. They are not in the current scope. Do not build them without the owner's approval.

**What belongs here:** approved "later" ideas with enough context to pick them up.
**What does not belong here:** work that is planned now (the issue tracker) and technical debt ([TECH_DEBT.md](TECH_DEBT.md)).

## Settings sidebar layout

Recorded 2026-11-08.

- Mockup: [ideas/settings-sidebar-mockup.html](ideas/settings-sidebar-mockup.html). It is a single file with invented values. Open it in a browser; it makes no network requests.
- Layout: a left sidebar with the groups "Settings" (This device, Desktop) and "Information" (About). One panel shows at a time on the right. The links `#device`, `#desktop` and `#about` open a panel directly. Controls sit in cards. About is a plain panel with a "Copy address" button next to the LAN address.
- Why it was not chosen: Settings has two tabs for now (Settings and About). With only three short sections, a sidebar adds a click and width without adding anything.
- When it becomes worth it: when Settings grows many sections, or when HomeStream gains central device management (see the next idea). A sidebar that lists "This device" and the other devices would fit then.

## Manage other devices from one place

Recorded 2026-11-08.

- The idea: see and change the settings of other devices from the PC. For example rename the TV, or turn its spoiler protection on or off.
- Today every device keeps its own settings (browser and desktop app: local storage, TV: DataStore). There are no accounts, so devices are the only "who".
- What it would need: per-device settings stored on the server, and a list of devices in the UI. This is a product decision for the owner.
