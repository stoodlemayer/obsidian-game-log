import { App, Modal, Setting, Notice, TFile, FrontMatterCache } from 'obsidian';
import type { default as GameLogPlugin } from './main';

export class PlaythroughModal extends Modal {
    private plugin: GameLogPlugin;
    private gameFile: TFile;
    private gameFrontmatter: FrontMatterCache;
    private playthroughName = '';
    private mainObjective = '';

    constructor(app: App, plugin: GameLogPlugin, gameFile: TFile) {
        super(app);
        this.plugin = plugin;
        this.gameFile = gameFile;
        
        // Get game frontmatter
        const cache = this.app.metadataCache.getFileCache(gameFile);
        this.gameFrontmatter = cache?.frontmatter || {};
        
        if (!this.gameFrontmatter?.game_name) {
            throw new Error('Invalid game file - missing game_name in frontmatter');
        }
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        
        modalEl.style.cssText = `
            max-width: 500px;
            width: 90vw;
            min-height: 300px;
        `;
        
        contentEl.empty();
        contentEl.createEl('h2', { text: `New Playthrough - ${this.gameFrontmatter.game_name}` });
        
        // Playthrough name (required)
        new Setting(contentEl)
            .setName('Playthrough Name')
            .setDesc('Give this playthrough a unique name')
            .addText(text => text
                .setPlaceholder('e.g., First Run, Evil Character, Speedrun')
                .setValue(this.playthroughName)
                .onChange(value => {
                    this.playthroughName = value;
                    this.updateCreateButton();
                }));

        // Main objective (optional)
        new Setting(contentEl)
            .setName('Main Objective')
            .setDesc('What\'s your main goal for this playthrough? (optional)')
            .addTextArea(textArea => {
                textArea.setPlaceholder('e.g., Complete the main story, Find all collectibles, Try a stealth build');
                textArea.setValue(this.mainObjective);
                textArea.onChange(value => {
                    this.mainObjective = value;
                });
                textArea.inputEl.style.minHeight = '60px';
            });

        this.addActionButtons(contentEl);
        this.updateCreateButton();
    }

    private addActionButtons(containerEl: HTMLElement) {
        const buttonContainer = containerEl.createDiv('modal-button-container');
        buttonContainer.style.cssText = `
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid var(--background-modifier-border);
        `;

        const cancelButton = buttonContainer.createEl('button', {
            text: 'Cancel',
            cls: 'mod-cancel'
        });
        cancelButton.onclick = () => this.close();

        const createButton = buttonContainer.createEl('button', {
            text: 'Create Playthrough',
            cls: 'mod-cta'
        });
        createButton.id = 'create-playthrough-button';
        createButton.onclick = async () => {
            await this.createPlaythrough();
        };
    }

    private updateCreateButton() {
        const button = this.contentEl.querySelector('#create-playthrough-button') as HTMLButtonElement;
        if (button) {
            const isValid = this.playthroughName.trim().length > 0;
            button.disabled = !isValid;
            button.textContent = isValid ? 'Create Playthrough' : 'Please enter a playthrough name';
        }
    }

    private sanitizeForFileSystem(name: string): string {
        return name
            .replace(/[<>:"/\\|?*]/g, '') // Remove invalid filename characters
            .replace(/\s+/g, ' ') // Normalize multiple spaces to single spaces
            .trim(); // Remove leading/trailing whitespace
    }

    private async createPlaythrough() {
        if (!this.playthroughName.trim()) {
            new Notice('Please enter a playthrough name');
            return;
        }

        try {
            const playthroughId = this.generatePlaythroughId();
            
            // Sanitize playthrough name for file system
            const safePlaythroughName = this.sanitizeForFileSystem(this.playthroughName);
            
            // Validate that we still have a name after sanitization
            if (!safePlaythroughName) {
                new Notice('Playthrough name contains only invalid characters. Please use a different name.');
                return;
            }
            
            // Check if sanitization changed the name and warn user
            if (safePlaythroughName !== this.playthroughName.trim()) {
                console.log(`Playthrough name sanitized from "${this.playthroughName}" to "${safePlaythroughName}"`);
            }
            
            // Create playthrough file using safe name for filename
            const playthroughContent = this.generatePlaythroughDashboard(playthroughId);
            const playthroughFileName = `${safePlaythroughName} - Dashboard.md`;
            
            // Use the sanitized game name for the folder path and the filename variable
            const safeGameName = this.sanitizeForFileSystem(this.gameFrontmatter.game_name as string);
            const playthroughPath = `${this.plugin.settings.gamesFolder}/${safeGameName}/Playthroughs/${playthroughFileName}`;
            
            const playthroughFile = await this.app.vault.create(playthroughPath, playthroughContent);
            
            // Update game overview status
            await this.updateGameOverviewStatus();
            
            new Notice(`🎯 Created playthrough: ${this.playthroughName}`);
            
            // Open the new playthrough dashboard
            await this.app.workspace.getLeaf().openFile(playthroughFile);
            
            this.close();
            
        } catch (error) {
            console.error('Error creating playthrough:', error);
            new Notice(`❌ Error creating playthrough: ${error.message}`);
        }
    }

    private generatePlaythroughId(): string {
        // Use sanitized name for the ID
        const sanitizedName = this.sanitizeForFileSystem(this.playthroughName);
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        return `${sanitizedName.replace(/\s+/g, '_')}_${randomSuffix}`;
    }

    private generatePlaythroughDashboard(playthroughId: string): string {
        const gameName = this.gameFrontmatter.game_name;
        const today = new Date().toISOString().split('T')[0];
        
        // Get image paths from game overview
        const heroImage = this.gameFrontmatter.hero_image || '';
        const headerImage = this.gameFrontmatter.header_image || '';
        const boxArtImage = this.gameFrontmatter.box_art_image || '';
        
        // Choose best image for dashboard (prefer hero, fallback to header, then box art)
        const dashboardImage = heroImage || headerImage || boxArtImage;

        return `---
game_name: "${gameName}"
playthrough_name: "${this.playthroughName}"
playthrough_id: "${playthroughId}"
main_objective: "${this.mainObjective}"
status: "Planned"
start_date: "${today}"
last_session: ""
total_sessions: 0
notes_from_last_session: ""
notes_for_next_session: ""
current_session_notes: ""
session_active: false
dashboard_image: "${dashboardImage}"
tags:
  - playthrough
  - ${gameName.toLowerCase().replace(/[^a-z0-9]/g, '-')}
---
\`\`\`meta-bind-button
style: primary
label: 🎮 Start Session
id: startSession
hidden: true
tooltip: Starts a new session and enables the autosave. Will update the Playthrough status to Active if it isn't Active already.
action:
   type: command
   command: game-log:start-gaming-session
\`\`\`
\`\`\`meta-bind-button
style: primary
label: 💾 End Session
id: endSession
hidden: true
tooltip: Ends the current session and saves the game log.
action:
   type: command
   command: game-log:end-gaming-session
\`\`\`
\`\`\`meta-bind-button
style: destructive
label: ✅ Complete Playthrough
id: completePlaythrough
hidden: true
tooltip: This will end the current playthrough and generate the Playthrough Report.
action:
   type: command
   command: game-log:complete-playthrough
\`\`\`
\`\`\`meta-bind-button
style: default
label: 📤 Share Notes
id: shareSession
hidden: true
tooltip: Copy session notes to clipboard for sharing on Discord, Reddit, or as plain text.
action:
   type: command
   command: game-log:share-session-notes
\`\`\`
${dashboardImage ? `\`VIEW[{dashboard_image}][image]\`` : ''}
# ${gameName} | ${this.playthroughName}

${this.mainObjective ? `**Main Objective**: ${this.mainObjective}` : ''}
**Status**: \`INPUT[inlineSelect(option(Planned), option(Active), option(Completed), option(On Hold), option(Dropped)):status]\` | **Last Session**: \`VIEW[{last_session}][text]\` | **Total Sessions**: \`VIEW[{total_sessions}]\`

\`BUTTON[startSession]\` \`BUTTON[endSession]\` \`BUTTON[shareSession]\`

---

## Notes from Last Session
\`VIEW[{notes_from_last_session}][text(renderMarkdown)]\`

---

## Current Session Notes

\`INPUT[textArea(placeholder(What happened this session? What are you working on? Note: Markdown formatting will render when saved.)):current_session_notes]\`

## Notes for Next Session

\`INPUT[textArea(placeholder(To-dos or reminders for next time. Note: Markdown formatting will render when saved.)):notes_for_next_session]\`

---

## Recent Sessions

\`\`\`dataview
TABLE WITHOUT ID
  link(file.link, "Session " + session_number) as "Session",
  session_date as "Date",
FROM "${this.plugin.settings.gamesFolder}/${gameName}/Sessions"
WHERE playthrough_id = "${playthroughId}"
AND !contains(file.name, "_current_session_")
SORT session_date DESC
LIMIT 10
\`\`\`

---

## Actions

\`BUTTON[completePlaythrough]\`

---

> [!info]- Session Status
> **Session Active**: \`VIEW[{session_active}]\`  
> **Last Auto-save**: \`VIEW[{last_autosave}][text]\`
`;
    }

    private async updateGameOverviewStatus() {
        try {
            await this.app.fileManager.processFrontMatter(this.gameFile, (fm) => {
                fm.total_playthroughs = (fm.total_playthroughs || 0) + 1;
                
                // Update status if this is the first playthrough
                if (fm.status === 'Not Started') {
                    fm.status = 'Planning';
                }
            });
        } catch (error) {
            console.error('Error updating game overview status:', error);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}