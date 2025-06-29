import { ItemView, WorkspaceLeaf, TFile, TFolder, TAbstractFile } from 'obsidian';
import type { default as GameLogPlugin } from './main';

interface GameFrontmatter {
    game_name?: string;
    status?: string;
    store_platform?: string;
    total_playthroughs?: number;
    last_session?: string;
    current_playthrough?: string;
    total_hours?: number;
    rating?: string;
    // Add other properties as needed
}

export const GAME_LIBRARY_VIEW_TYPE = 'game-library-view';

export class GameLibraryView extends ItemView {
    plugin: GameLogPlugin;

    constructor(leaf: WorkspaceLeaf, plugin: GameLogPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return GAME_LIBRARY_VIEW_TYPE;
    }

    getDisplayText() {
        return 'Game Library';
    }

    getIcon() {
        return 'gamepad-2';
    }

    async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    
    // Header with title and create button
    const headerContainer = container.createDiv('game-library-header');
    headerContainer.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
        padding: 0 20px;
    `;
    
    headerContainer.createEl('h2', { text: 'Game Library' });
    
    // Create new game button
    const createButton = headerContainer.createEl('button', {
        text: '+ New Game',
        cls: 'mod-cta'
    });
    createButton.style.cssText = `
        padding: 8px 16px;
        cursor: pointer;
    `;
    createButton.onclick = () => {
        this.plugin.createNewGame();
    };

    // Create the library container
    const libraryContainer = container.createDiv('game-library-container');
    libraryContainer.style.cssText = `
        padding: 0 20px 20px 20px;
    `;

    // Load and display games
    await this.loadGames(libraryContainer);
}

    async loadGames(container: HTMLElement) {
        const gamesFolder = this.app.vault.getAbstractFileByPath(this.plugin.settings.gamesFolder);
        
        if (!gamesFolder || !(gamesFolder instanceof TFolder)) {
            container.createEl('p', { 
                text: 'No games found. Create your first game to get started!',
                cls: 'game-library-empty-state'
            });
            return;
        }

        // Collect all game overview files with their metadata
        const games: Array<{file: TFile, frontmatter: GameFrontmatter}> = [];
        
        for (const gameFolder of gamesFolder.children) {
            if (!(gameFolder instanceof TFolder)) continue;
            
            const overviewFile = gameFolder.children.find((file: TAbstractFile) => 
                file instanceof TFile && file.name.endsWith('Game Overview.md')
            );
            
            if (overviewFile instanceof TFile) {
                const metadata = this.app.metadataCache.getFileCache(overviewFile);
                const frontmatter = metadata?.frontmatter;
                if (frontmatter) {
                    games.push({ file: overviewFile, frontmatter });
                }
            }
        }
        
        // Sort games by priority: Playing > Planning > On Hold > Completed > Dropped > Not Started
        games.sort((a, b) => {
            // Define status priority (lower number = higher priority)
            const statusPriority: Record<string, number> = {
                'Playing': 1,
                'Planning': 2, 
                'Not Started': 3,
                'On Hold': 4,
                'Completed': 5,
                'Dropped': 6
            };
            
            const aStatus = a.frontmatter.status || 'Not Started';
            const bStatus = b.frontmatter.status || 'Not Started';
            
            const aPriority = statusPriority[aStatus] || 6;
            const bPriority = statusPriority[bStatus] || 6;
            
            // First priority: Status
            if (aPriority !== bPriority) {
                return aPriority - bPriority;
            }
            
            // Second priority: Within same status, sort by last session date (if exists)
            const aLastSession = a.frontmatter.last_session;
            const bLastSession = b.frontmatter.last_session;
            
            if (aLastSession && bLastSession) {
                return bLastSession.localeCompare(aLastSession); // Newest first
            } else if (aLastSession && !bLastSession) {
                return -1; // Games with sessions come first
            } else if (!aLastSession && bLastSession) {
                return 1;
            }
            
            // Third priority: Alphabetical by game name
            const aName = a.frontmatter.game_name || '';
            const bName = b.frontmatter.game_name || '';
            return aName.localeCompare(bName);
        });

        // Create grid container
        const gamesGrid = container.createDiv('games-grid');
        gamesGrid.style.cssText = `
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 20px;
            margin-top: 20px;
        `;

        // Create cards for sorted games
        for (const game of games) {
            await this.createGameCard(gamesGrid, game.file);
        }
    }

    async createGameCard(container: HTMLElement, gameFile: TFile) {
        const metadata = this.app.metadataCache.getFileCache(gameFile);
        const frontmatter = metadata?.frontmatter;
        
        if (!frontmatter) return;

        const gameCard = container.createDiv('game-card');
        gameCard.style.cssText = `
            background: var(--background-secondary);
            border: 1px solid var(--background-modifier-border);
            border-radius: 8px;
            overflow: hidden;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            flex-direction: column;
            position: relative;
        `;

        // Header image if available
        if (frontmatter.header_image) {
            const imageContainer = gameCard.createDiv('game-card-image');
            imageContainer.style.cssText = `
                width: 100%;
                height: 100px;
                background-size: cover;
                background-position: center;
                background-image: url("${this.app.vault.adapter.getResourcePath(frontmatter.header_image)}");
            `;
        }

        // Content container
        const contentContainer = gameCard.createDiv('game-card-content');
        contentContainer.style.cssText = `
            padding: 12px;
            flex: 1;
            display: flex;
            flex-direction: column;
        `;

        // Status indicator for active games
        if (frontmatter.status === 'Playing') {
            const activeIndicator = contentContainer.createDiv('active-indicator');
            activeIndicator.style.cssText = `
                position: absolute;
                top: 10px;
                right: 10px;
                width: 8px;
                height: 8px;
                background: var(--interactive-accent);
                border-radius: 50%;
            `;
        }

        // Game title
        const title = contentContainer.createEl('h3', { 
            text: frontmatter.game_name || 'Unknown Game',
            cls: 'game-card-title'
        });
        title.style.cssText = `
            margin: 0 0 6px 0;
            font-size: 1.1em;
        `;

        // Game info
        const info = contentContainer.createDiv('game-card-info');
            info.style.cssText = `
                flex: 1;
                font-size: 0.9em;
                color: var(--text-muted);
                line-height: 1.3;
            `;

        // Update the paragraph creation to have tighter spacing
        const infoParagraphs = [];
            infoParagraphs.push(info.createEl('p', { 
                text: `Status: ${frontmatter.status || 'Not Started'}`
            }));
            infoParagraphs.push(info.createEl('p', { 
                text: `Playthroughs: ${frontmatter.total_playthroughs || 0}`
            }));

        // Show last played date if available
            if (frontmatter.last_session) {
                infoParagraphs.push(info.createEl('p', { 
                    text: `Last played: ${frontmatter.last_session}`,
                    cls: 'game-last-played'
                }));
            }

        // Apply tight spacing to all paragraphs
        infoParagraphs.forEach(p => {
            p.style.margin = '2px 0';
        });

        // Click handler
        gameCard.onclick = () => {
            this.app.workspace.openLinkText(gameFile.path, '', false);
        };

        // Hover effects
        gameCard.onmouseenter = () => {
            gameCard.style.borderColor = 'var(--interactive-accent)';
            gameCard.style.transform = 'translateY(-2px)';
        };
        gameCard.onmouseleave = () => {
            gameCard.style.borderColor = 'var(--background-modifier-border)';
            gameCard.style.transform = '';
        };
    }

    // Refresh the library view
    async refresh() {
        const container = this.containerEl.children[1];
        const libraryContainer = container.querySelector('.game-library-container');
        
        if (libraryContainer) {
            libraryContainer.empty();
            await this.loadGames(libraryContainer as HTMLElement);
        }
    }

    // Set up file watchers
    onload() {
        // Refresh when files in the games folder change
        this.registerEvent(
            this.app.vault.on('create', (file) => {
                if (file.path.startsWith(this.plugin.settings.gamesFolder)) {
                    this.refresh();
                }
            })
        );
        
        this.registerEvent(
            this.app.vault.on('delete', (file) => {
                if (file.path.startsWith(this.plugin.settings.gamesFolder)) {
                    this.refresh();
                }
            })
        );
        
        this.registerEvent(
            this.app.vault.on('rename', (file, oldPath) => {
                if (file.path.startsWith(this.plugin.settings.gamesFolder) || 
                    oldPath.startsWith(this.plugin.settings.gamesFolder)) {
                    this.refresh();
                }
            })
        );
        
        // Refresh when metadata changes (for status updates, etc.)
        this.registerEvent(
            this.app.metadataCache.on('changed', (file) => {
                if (file.path.startsWith(this.plugin.settings.gamesFolder) && 
                    file.path.endsWith('Game Overview.md')) {
                    this.refresh();
                }
            })
        );
    }


    async onClose() {
        // Cleanup if needed
    }
}