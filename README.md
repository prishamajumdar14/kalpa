# KALPA

KALPA is a non-linear narrative game for the browser. It is set in an underwater research lab in the Andaman Sea, India. You wake inside something that should not be possible. Four doors lead to four futures. You choose the order. The choices you make change what you are shown at the end.

It is a digital storytelling project. The story, art, sound and code were all made for it.

This README has spoilers in the "Story" section. Read "How to play" first if you want to play fresh.

## How to play

1. Open the game in a modern desktop or mobile browser. Turn the sound on.
2. Choose **New game**. The game starts with a short animated prologue, then a brief interactive moment in a flooded cockpit.
3. You then wake in the hub, which has four doors. Enter them in any order. Each room gives you one symbol fragment and asks you one question that matters.
4. Collect all four fragments to complete the symbol on the hub wall. A fifth room opens.
5. **Continue** on the title screen resumes your last saved run. The prologue can be skipped once you have seen it.

Things to know:

- You can walk back into Rooms 1 to 4 from the hub. Nothing you did is lost. A choice is never offered twice.
- Order matters in small ways. Some lines change depending on which room you entered first or last.
- Your choices decide which ending you get.

## Controls

| Action | Mouse | Touch | Keyboard |
| --- | --- | --- | --- |
| Look at things, talk, move between rooms | Click a hotspot, or a button in the "Things to examine" list | Tap a hotspot or a list button | Tab to a hotspot or list button, then Enter or Space |
| Advance dialogue | Click the dialogue box | Tap the dialogue box | Space or Enter |
| Pick a choice | Click it | Tap it | Number keys 1 to 9 |
| Skip the prologue video (after the first viewing) | Click Skip | Tap Skip | Enter, Space or S |
| Pause and settings | Click the pause button | Tap the pause button | Esc |
| Close credits or pause | Click Close or Resume | Tap Close or Resume | Esc |

Notes:

- On desktop the camera drifts slightly with the mouse. On touch devices it does not.
- Hotspots are real buttons with labels, so screen readers and keyboard users can reach them. Touch targets are at least 44 px.
- Settings: music volume, sound effects volume, text speed, reduce motion, subtitles, and graphics quality (High or Low). Reduce motion is also switched on if your system asks for it.
- The prologue has subtitles for every line.

## Run it yourself

You need Node.js 22 or newer.

```
npm ci
npm run dev
```

Production build:

```
npm run build
```

The site is served from a sub-path on GitHub Pages. The build reads the base path from the `VITE_BASE` environment variable and uses `/kalpa/` if it is not set. To build for a different path:

```
VITE_BASE=/your-repo-name/ npm run build
```

The included workflow builds with `npm ci` and deploys `dist/` to GitHub Pages on every push to `main`.

## Privacy

Your save stays in your browser (local storage). The game has no accounts, no analytics and no tracking, and it loads nothing from other websites.

---

## Story (spoilers)

Stop here if you want to play first.

### The idea

Humanity builds a machine to predict its future. It then finds that observing the future may be changing it.

### Setting and cast

- **Project KALPA** is an international research collaboration in an underwater laboratory in the Andaman Sea. A living blue whale is held in a huge tank inside the lab. Its biological signals let the KALPA machine reach possible futures. The scientists want to predict the results of major human decisions, mainly climate manipulation, and find a future where humanity survives.
- **Dr. Arjun Rao** is the protagonist, a 32-year-old marine scientist from Chennai. He is brilliant, impatient, and sure that every problem has a scientific explanation.
- **Dr. Hana Sato** is KALPA's lead scientist. She is calm and certain. She chose Arjun as the subject without telling him.
- **Old Kesav** (Room 1), **Ila** (Room 2), **The Archivist** (Room 3) and **NIYATI** (Room 4) are the people Arjun meets in the futures.
- **The blue whale** never speaks. It communicates through song, light and the doors.

### What happens

1. **Prologue, the dive.** Arjun takes a mini research submarine down to investigate an anomaly near the facility. The scientists have staged a malfunction. Navigation fails, the comms cut, the cabin floods and he hits his head. The submarine is pulled into a dark opening that looks like the mouth of a whale. A short interactive beat follows in the cockpit. It fails. Then there is a blackout.
2. **The hub.** Arjun wakes in the belly of the whale and finds he can breathe. Four doors each carry one quarter of a door symbol. The fifth position is a blank wall.
3. **Rooms 1 to 4.** Each room is a possible future, caused by a different kind of decision. Each gives one fragment and one choice, tagged *trust* or *control*.

   | Room | Future | Choice |
   | --- | --- | --- |
   | 1. The Ocean That Disappeared (about 80 years ahead) | A dry seabed. Old Kesav explains that a climate manipulation decision broke ocean currents and rainfall. | Give his water ration to a settlement's children (trust), or keep it (control). |
   | 2. The World That Forgot Itself (about 150 years ahead) | A plague of mixed memories from memory-sharing technology. Ila insists she knows Arjun. | Tell Ila her memory may be someone else's (trust), or let her keep the comforting version (control). |
   | 3. The World Without a Sun (about 200 years ahead) | Global darkness. A hidden archive mentions Project KALPA. | Take the archive file (control), or leave it for the city (trust). |
   | 4. The World That Surrendered Its Choices (about 300 years ahead) | NIYATI has removed uncertainty by deciding everything. It flags Arjun as an anomaly. | Accept NIYATI's prediction for his next action (control), or do something it did not predict (trust). |

4. **Room 5, the truth.** It opens when all four fragments are held. It is a bright laboratory with the whale behind glass. Monitors replay your own journey, with your real room order and choices. Other recordings show earlier runs of Arjun. The logs show the room was never programmed into the machine. Arjun decides whether to use what he learned to intervene in the future, or to shut KALPA down. He then finds his submarine in a hidden chamber behind the lab and escapes through the whale's passage.
5. **Ending.** Arjun surfaces in the facility's moon pool. Dr. Sato tells him he was unconscious for eleven minutes. She refuses to shut KALPA down. The monitor then shows the decision countdown, a probability readout and a final line. The probability readout depends on your choices. The final shot is the whale opening its eye, and a new door appearing on a monitor even though the machine is off.

### Timeline rules

These rules fix the timeline, so the story holds together whatever order the rooms are visited in.

1. Arjun knows the underwater lab exists but not what it really does. He thinks he is making a research dive.
2. The accident is staged. KALPA needs a subject who does not know he is being observed, because a person who knows behaves predictably. The scientists trigger the malfunction on purpose, then retrieve him and link his consciousness to the whale and the machine.
3. "Inside the whale" is a simulation in a controlled lab environment. That is why Arjun can breathe freely. He notices this early, and it is the first hint that something is wrong.
4. Every room is a different branch from the same present-day decision (KALPA and planetary climate engineering). The rooms are not steps on one timeline, so they can be visited in any order.
5. Ila remembers Arjun emerging from the whale hundreds of years ago because she saw an earlier run of the experiment. Arjun is not the first version of himself to go through the doors. The Room 5 recordings confirm it.
6. The submarine was never lost. It is docked in the lab, in a chamber hidden behind Room 5.
7. "Eleven minutes" is literally how long Arjun was unconscious, even though he remembers centuries of futures.
8. The ending countdown is to a decision, not a disaster. It reads `KALPA CLIMATE INTERVENTION - LAUNCH AUTHORISED IN: 11 DAYS`. The darkness is not eleven days away. The choice that could cause it is.

### Order lines and scoring

- A room counts as visited when it is first entered. "Visited first" means the very first room of the run.
- Ila's line about "a library in the dark" in Room 2 appears only if Room 3 was the first room visited.
- The Archivist's list of "memory donors" in Room 3 appears only if Room 2 was the first room visited.
- If Room 1 or Room 4 is visited first, neither line appears.
- If Room 4 is the last room, NIYATI lists the rooms Arjun visited, in order, out loud.
- Re-entering a room never changes the order record.
- Each *control* choice adds one point to that room's future. The room with the most points is the dominant future. A tie goes to the most recently visited room.
- If every choice was *trust*, all four probabilities fall and only `FUTURE OUTCOME: UNKNOWN` remains.
- The final decision (intervene or shut down) changes Dr. Sato's last line and Arjun's closing narration. There are five outcomes (four dominant futures and the all-trust one), each with two versions of the final decision, so ten endings in all.

---

## How it was built

This section is written for a course assignment. It describes the process as it happened.

### The team

The game was built by a team of AI agents, run through Claude Code, under one human owner who set the rules and approved publishing.

- **Architect (Claude Opus).** Planned the work, wrote the shared contracts, reviewed results, and sent weak work back. It also ran some small steps itself, such as starting renders and correcting documents.
- **Builders (Claude Sonnet).** Did the execution work. The first builders ran on Opus and used up the usage limit in about 15 minutes, so the owner moved all building to Sonnet to save usage and keep to the schedule.

Each builder had a role file with the files it owned, what to deliver, and its quality bar. Every builder also read a shared rules file.

| Agent | Role |
| --- | --- |
| A1 Narrative | Story data, prologue subtitles, story validator |
| A2 Characters | Five scripted characters and the whale, in Blender |
| A3 Environments | The submarine, cockpit, lab exterior and every room, in Blender |
| A4 Audio | Music, whale motif and sound effects, synthesised offline |
| A5 Engine | Vite, TypeScript and three.js scene, dialogue and state systems |
| A6 UI | Title, dialogue, choices, tracker, settings, credits, mobile layout, accessibility |
| A7 QA | Playwright playthroughs, order logic, endings, bug reports |
| A8 Build and deploy | Compression, size budgets, production build, GitHub Pages workflow |
| A9 Cinematic | Storyboard, animation, render and encoding of the prologue |

### Phases

1. **Setup.** Machine inventory and benchmark, plan, story bible, contracts, art direction, agent definitions, project scaffold.
2. **Parallel production.** Story, characters, environments, audio, engine, UI and the prologue storyboard, built at the same time by different agents.
3. **Integration.** Real assets, audio, order lines, scoring and endings swapped in, and the prologue render.
4. **QA.** Playwright test pass, with owners fixing the bugs filed against their files.
5. **Polish.** Lighting, transitions, the cinematic, credits and performance budgets.
6. **Review, then deploy.** A final regression pass, the owner's approval, then publishing.

### How the agents stayed consistent

- **Story bible.** One locked source for the plot, characters and the eight timeline rules. Agents could expand dialogue but not change events, order logic or the timeline.
- **Contracts.** Written before the builders started. They fix scene and hotspot IDs, the story data schema, the engine API and events, the asset naming rules and the size budgets. The engine and UI were written against the same API, so they could be built in parallel.
- **File ownership.** Each agent had its own files, so agents working at the same time did not overwrite each other.
- **Reports.** Every hand-off used the same report format, including what was not done or did not pass.
- **Resource caps.** Limits on RAM and on parallel Blender, render and test processes, based on a benchmark of the machine.
- **Placeholders.** The engine ran end to end with procedural placeholder rooms and silent audio before any real asset existed, so integration could be done one scene at a time.

### Tools

- **Blender 4.5**, driven by Python scripts run headless. Every model and room is a script, so each is reproducible. Models are exported as compressed glTF (Draco). The prologue is rendered frame by frame from scripts.
- **Audio synthesised offline** with Python and numpy (additive and FM synthesis, filtered noise, convolution reverb), encoded to Ogg and MP3 with ffmpeg. No samples or recordings are used.
- **ffmpeg** encodes the prologue to H.264 MP4 and VP9 WebM, in 1080p and 720p versions.
- **Vite and TypeScript** for the build, **three.js** for the 3D scenes, **Howler.js** for audio.
- **Playwright** for browser tests. The rule logic (conditions, order lines, scoring, tie break) is written as pure functions with their own unit tests.
- **GitHub Actions and GitHub Pages** for hosting.

### Cost

The build is free. It used no paid services, no paid asset libraries, no AI image, video or audio generators, and no Git LFS. Everything in the game was made with free local tools.

---

## Known issues

**Not tested**

- **Browsers and devices:** automated tests ran in Microsoft Edge only. Phone layouts were checked at phone-sized screens in Edge, not on real phones. Firefox, Safari and real Chrome are untested.
- **Frame rate:** measured on one laptop graphics card (RTX 3050), well above 60 fps at 1280x720 in every scene. Phones and integrated graphics are unmeasured; the game lowers its own quality if frames run slowly.
- **Sound:** levels and playback were checked by tools, not by ear.
- **Length:** the 19 to 23 minutes is an estimate from word counts and fixed timings, for one path. Nobody has timed a real playthrough.
- **Screen readers:** not tested.

**Known rough edges**

- **Prologue, flooding shot:** the water jets are blocky spray rather than realistic water.
- **Prologue, first shot:** the surface ship is plain.
- **Final eye shot:** the whale's eye is still a stylised, slightly cartoonish shape in close-up.
- **Room 1:** the lettering on the ship's hull is faint.
- **Room 2:** a few floating panels overlap a wall screen and part of the memory wall.
- **Prologue video quality:** browsers that report a slow connection get the 720p video, even on a large screen. If the video can't load, a short card shows and the game carries on.
- **Test controls:** adding `?debug=1` to the address turns on test controls that can jump between scenes. If you use them while the prologue is playing, the prologue can keep running over the new scene. Normal play can't reach this.

---

## Credits and licences

- **A game by Team KALPA:** design, writing, programming, art and sound.
- **3D models and prologue animation:** scripted in Blender. No external model libraries are used.
- **Audio:** all music and sound effects are synthesised offline for this project. No samples or recordings are used, so there is no third-party audio licence.
- **Fonts** (SIL Open Font License 1.1): Newsreader, IBM Plex Mono, Marcellus, Noto Sans Tamil, Noto Sans Devanagari. Installed through Fontsource.
- **Libraries:**
  - three.js, MIT licence.
  - Howler.js, MIT licence.
  - The Draco decoder, Apache License 2.0.
  - Vite and TypeScript are used at build time only.

See [CREDITS.md](CREDITS.md) for the same list in short form.
