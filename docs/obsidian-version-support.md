# Which Obsidian version does Markport run?

> Written in English on purpose, unlike most of `docs/` — the in-app failure message points
> users here, and not all of them read Hebrew.

**Short answer: Obsidian 1.12.7.** That is the newest version Markport runs, and the pin is
deliberate — not a lag in maintenance.

## If you point it at 1.13 or newer

The app will not start. You'll see this instead of the loading spinner:

> Obsidian 1.13.4 did not start. This version asks its host for a startup acknowledgement that
> Markport does not provide. The newest version known to work here is 1.12.7 — see the README.

Nothing is broken on your side and there is nothing to fix. Run
`node scripts/update-obsidian-mobile.js --version 1.12.7` to go back.

## What changed in 1.13

Obsidian 1.13 added a check at startup. Before it initialises, it asks the host environment for a
`terms` field, and expects the exact text of an acknowledgement stating that the user may not
distribute the Obsidian application in any form without explicit approval from the Obsidian team.

The channel is platform-dependent, and the acknowledgement sits on both sides — the host supplies
it, the renderer compares it against its own copy. Measured 2026-09-05 against both 1.13.4 builds:

| | Channel | If it doesn't match |
|---|---|---|
| Mobile bundle (what Markport runs) | `App.getInfo().terms` (Capacitor) | `throw new Error` |
| Desktop bundle | `ipcRenderer.sendSync("terms")` (Electron IPC) | `window.close()` |

```js
const EXPECTED_ACKNOWLEDGEMENT =
  "I understand and agree that I am not allowed to … granted by the Obsidian team.";

// capacitor
if ((await App.getInfo()).terms !== EXPECTED_ACKNOWLEDGEMENT) throw new Error();

// electron.js
if (ipcRenderer.sendSync("terms") !== EXPECTED_ACKNOWLEDGEMENT) window.close();
```

And this is the supplying side — what Obsidian's own official clients answer with. On both
platforms the string is stored in the native half of the client and handed to the renderer,
which then compares it against its own copy.

```js
// Desktop — the Electron main process, inside obsidian-1.13.4.asar
const Bt = "I understand and agree that I am not allowed to … granted by the Obsidian team.";

ipcMain.on("terms", t => { t.returnValue = Bt });
ipcMain.on("is-quitting", t => { t.returnValue = be });
ipcMain.on("version",     t => { t.returnValue = H  });
// …one handler per channel; "terms" is answered exactly like any other.
```

On Android the same string is compiled into the native layer — it is present in `classes.dex`
of the 1.13.4 APK, and reaches the renderer through Capacitor's `App.getInfo()`.

So the acknowledgement is not something the user types or accepts anywhere. It is a constant
that ships inside Obsidian's own client, on both halves of it.

On a real Android device, Obsidian's own native layer supplies it. Markport replaces that
native layer with browser shims, and those shims don't supply it — `capacitor-shim.js` ships
`terms` empty, and `shims/electron.js` answers the `terms` IPC channel with an empty string for
the same reason.

## Why we don't work around it

We could. The shim could return the string and the app would boot.

We don't, because the check isn't a bug or an API change we failed to keep up with — it's a
control Obsidian added deliberately, and its content is a statement about redistribution rights.
Having this project's code assert that acknowledgement on a user's behalf in order to get past it
is not something we're willing to ship. Obsidian is not open source; this is their application,
and it's their call to make.

To be explicit about what is in the code: `App.getInfo()` passes through whatever value the person
running the instance has provided in their own browser, and **ships empty**. Markport does not
contain the acknowledgement text and does not supply it. Out of the box, on 1.13+, the app does
not start — which is the intended behaviour.

### If you choose to run a newer version anyway

You are an adult with your own copy of Obsidian, and what you do on your own machine is your
decision. But be clear with yourself about what that decision is:

**Supplying that value is you making the declaration, personally.** Not this project, and not
whoever wrote the code — you. The acknowledgement is a statement that you understand you may not
distribute the Obsidian application in any form without explicit approval from the Obsidian team,
and that Obsidian is a registered trademark you may not use without their permission. If you
supply it, you are asserting that, and you are responsible for actually complying with it.

Two things follow, and they are not the same:

- **Running it privately, for yourself, against your own vault** — you are the only person
  involved, and the declaration is one you can honestly make.
- **Serving it to anyone else** — a public deployment, a shared link, a hosted instance for a team
  — is exactly what the acknowledgement says requires explicit approval. Do not do it on the
  strength of a flag you set in your own browser.

This project takes no position on your private use and provides no support for it. If it breaks,
that's yours too: the pin exists because 1.12.7 is what we test against, and nothing past the gate
has been verified on newer versions.

## What we measured before deciding

This matters, because "it doesn't work on 1.13" could easily have meant our shim layer had fallen
behind. It hasn't. Measured 2026-08-02, comparing 1.12.7 and 1.13.4:

| | 1.12.7 | 1.13.4 |
|---|---|---|
| Boots in the browser | Yes — vault chooser renders fully | No — stops during startup |
| `app.js` runtime errors | 0 | 4 |
| `native-bridge.js` (the Capacitor bridge) | — | **byte-for-byte identical** |
| Capacitor plugins referenced | 11 | the same 11 |
| Startup acknowledgement gates | — | exactly one |
| Our test suites | pass | pass |

The download-and-extract pipeline runs cleanly on 1.13.4, the shim contract didn't move, and no
new plugin surface appeared. `getManagedPolicy()` is new but wrapped in a `try`/`catch` inside
Obsidian's own code, so it isn't fatal.

Note this is static analysis plus a boot attempt — it establishes that the acknowledgement gate is
the only *hard* blocker, not that everything past it would behave correctly.

## What would change this

- Obsidian granting explicit permission for this use, which we'd rather ask for than route around.
- A future Obsidian release where the check no longer applies to this scenario.

Until then the pin stands. If you're reading this because you wanted a newer Obsidian in a
browser: that's a fair thing to want, and the place to raise it is with the Obsidian team.

## Related

- `AGENTS.md` — "Before you touch the bundle", and the zero-patches policy
- `docs/plans/restructure/ROADMAP.md` — cross-slice decision 10 and the full measurement record
- `src/client-mobile/boot.js` — the boot watchdog that produces the message above
