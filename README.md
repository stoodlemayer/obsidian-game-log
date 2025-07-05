# Obsidian Game Log - Obsidian Plugin (v0.8)

Obsidian Game Log is a system designed to help gamers track gaming sessions, playthroughs, and completion statistics. The lodestar for this plugin is that the core functionality should be as simple as possible, handling many of the tedious or repetitive tasks automatically so you can focus solely on writing and creating the log. Even as features are added that will give users the tools necessary to include a granular level of detail, those tools will never be required. This system will only be as complex as the user wants it to be.

This plugin is overkill if you are looking to create a comprehensive catalog of every game you own. I recommend checking out [Obsidian Game Search](https://github.com/CMorooney/obsidian-game-search-plugin) if that's what you're looking for.

## Features

- **Smart Session Management** - Auto-save prevents lost notes during gaming hyperfocus
- **Multi-Playthrough Tracking** - Manage multiple playthroughs per game
- **Completion Summaries** - Detailed reports after completing a playthrough
- **Device & Store Management** - Track where you own/play each game
- **Intelligent Status System** - Games automatically update status based on playthrough states

## Installation (Beta)

This plugin is currently in beta. To install:

1. Download the latest release files
2. Copy to `.obsidian/plugins/game-log/`  
3. Enable in Community Plugins settings

## Quick Start

1. Install and enable the plugin
2. Go to Settings → Game Log to configure your gaming devices
3. Click the Game Controller icon in the ribbon
4. Click "+ New Game" to add your first game
5. Start logging your gaming sessions!

Detailed guides are included below.

## Current Requirements

- **Meta Bind Plugin** (required) - Enables interactive buttons and inputs and session logs
- **Dataview Plugin** (recommended) - Powers game library views (will be replaced with Obsidian Bases in 0.9)

## Settings
After installing Obsidian Game Log and enabling it in Community Plugins, go to 'Game Log' settings. If you'd like, you can update the folder name Obsidian Game Log will use from the default "Games". You can also add a RAWG API key, which will enable Obsidian Game Log to pull and automatically add information during game creation (this feature was inspired by [Obsidian Game Search](https://github.com/CMorooney/obsidian-game-search-plugin)).

The settings screen is the primary interface you'll use for device management and creation. 

### Device Management
Obsidian has two modes for device management, Basic (the default) and Advanced Device Management. For most users, the default will be more than enough, but if you want to include more detailed information or add custom devices. Users can switch between the two modes and the system will retain the information for each device.

To add a device in Advanced Device Management:
1. Enable Advanced Device Management in the 'Platforms' section of the 'Settings' screen.
2. The 'Platforms' section will be replaced by 'Your Gaming Devices'. Click the "Add Device" button at the top of the 'Your Gaming Devices' section, above the list of devices.
3. A device creation modal window will open up. From here, you can add a Console, Computer, Handheld Device, Mobile Device, Retro Platform, and Other (for custom devices).
4. Alternatively, you can use the Quick Add options for common devices under the list of current devices.

### Store Management
For Computers, you can customize which stores you want to use during Game Creation. You can choose which ones you want to add from a list of popular/common stores or add a custom one. The list can be reordered by clicking and dragging stores around, and the system will prioritize the top store. Devices added in Advanced Device Management, such as a Steam Deck or MacBook, will automatically filter out stores that aren't available on the platform.

### Subscription Management
If you subscribe to a service like Game Pass, you can toggle subscriptions on and off in the 'Subscription Services' section of 'Settings'. The list of available services will update automatically based on the devices you add.

## Game Creation
1. Click the Game Controller icon in the ribbon to open the Game Library, which will open in the right-hand sidebar. At the top, click the "+ New Game" button. Or you can open the Command Palette (⌘/Ctrl+P) and search for the "Game Log: Add New Game" command.
2. A modal window will open up. In here, you can add the game name, the genre, a description, and select which device you will play the game on. If you have added a RAWG API key in 'Settings', Obsidian Game Log will search their database and automatically fill in the information about the game. It will even filter out devices if the game isn't available on their platform.
3. Did you purchase a PC game from a store you never plan to use again? Don't worry about adding it in 'Settings'! Click the "Add Store" button in device selection, type in the store's name, and the store will be added to the Game's Overview note.
4. If RAWG is enabled, Box Art, headers, and the logo will be pulled automatically from Steam. You can also add custom images. Obsidian Game Log expects these images to match the dimensions used by Steam, making it easy to add artwork from places like [SteamGridDB](https://www.steamgriddb.com). If an image doesn't match those dimensions or if two or images meet the requirements for one of the image types, you'll be prompted to sort them out.
5. After you click "Create Game", you'll be taken to the Game Overview screen.

## Playthrough Creation
The Game Overview note is where you can view information about different playthroughs for a single game. It is also where you can add a new playthrough.

1. Under the Actions heading, click the "New Playthrough" button.
2. A modal window will open up. Here, you can name the Playthrough and include an optional objective.
3. Clicking "Create Playthrough" will create and open the Playthrough Dashboard.

## Session Logging
The Playthrough Dashboard will be the screen where you'll spend the most time. Whether you are writing a log at the end of a session or updating it as you play, this is where you will do it.

1. Click the "Start Session" button to begin and enable the autosave.
2. Add your notes.
3. Click the "End Session" button when you finish.

That's it. Once you click End Session, a Session Log will be created automatically using your notes. The Notes for Next Session will automatically become the Notes from Last Session. And if you forgot to start a session, don't fret, the system will take care of you. If you've written notes and failed to start a session, you will be prompted to start (and end) a session when you click the "End Session" button.

If you click the "Share Notes" button, a modal window will open up. It will automatically add the Notes from your current session, or if no session is added, it will pull notes from the most recent session. You can share the notes as plain text or in Markdown format. The notes will be saved to your clipboard, enabling you to quickly share them with friends as either a text message or via Discord.

## Future Plans

- **Localization support** (0.8.x)
- **Advanced Device Management updates** (0.8.x) - Custom retro systems and emulation support
- **Playthrough Recaps** (0.8.x) - AI-powered summaries of long-dormant playthroughs
- **Obsidian Game Search plugin support** (0.9b) - Integration with existing game catalogs, enabling custom templates
- **Modular Element System** (0.9b) - Character sheets, quest tracking, timers, and more

## Known Bugs/Issues
None currently reported. [Please report any issues you encounter](https://github.com/stoodlemayer/obsidian-game-log/issues).

## Support

If you have any feedback about how the plugin functions or if there are features you'd like to see, please reach out. This project is only possible thanks to excessive use of Anthropic's Claude AI for coding. If you are an experienced developer and have ideas for how the code can be improved, let me know!

Report issues: [GitHub Issues](https://github.com/stoodlemayer/obsidian-game-log/issues)


