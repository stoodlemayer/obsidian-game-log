import { App, Modal, Setting, Notice, requestUrl, setIcon, TFile } from 'obsidian';
import type { default as GameLogPlugin } from './main';
import type { UserDevice, DeviceType } from './main';
import { KeyboardNavigationHelper } from './keyboardNavigation';

interface GameData {
    name: string;
    platforms: string[]; // Device IDs
    genre: string;
    description: string;
    rawgId?: string;
    steamAppId?: string;
    deviceStores: Record<string, string[]>; // deviceId -> selected stores
    subscriptionServices: string[]; // Which subscriptions provide this game
}

interface RawgGame {
    id: number;
    name: string;
    genres: Array<{name: string}>;
    description_raw?: string;
    background_image?: string;
    platforms?: Array<{platform: {name: string}}>;
    released?: string;
}

interface RawgGameDetails {
    id: number;
    name: string;
    description?: string;
    genres?: Array<{name: string}>;
    platforms?: Array<{platform: {name: string}}>;
    background_image?: string;
}

export class GameCreationModal extends Modal {
    private plugin: GameLogPlugin;
    private gameData: GameData;
    private searchResults: RawgGame[] = [];
    private searchTimeout: NodeJS.Timeout | null = null;
    private selectedGame: RawgGame | null = null;
    private searchDropdown: HTMLElement | null = null;
    private isSearching = false;
    private searchKeyboardNav: KeyboardNavigationHelper | null = null;

    constructor(app: App, plugin: GameLogPlugin) {
        super(app);
        this.plugin = plugin;
        
        this.shouldRestoreSelection = false;
        
        this.gameData = {
            name: '',
            platforms: [],
            genre: '',
            description: '',
            deviceStores: {},
            subscriptionServices: []
        };
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        
        modalEl.style.cssText = `
            max-width: 600px;
            width: 90vw;
            min-height: 400px;
        `;
        
        modalEl.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        
        contentEl.empty();
        contentEl.createEl('h2', { text: 'Create New Game' });
        
        if (this.plugin.settings.rawgApiKey) {
            this.buildRawgModal();
        } else {
            this.buildManualModal();
        }
    }

    private buildRawgModal() {
        const { contentEl } = this;
        
        this.addGameSearchSection(contentEl);
        this.addGamePreviewSection(contentEl);
        this.addEditableFields(contentEl);
        this.addDeviceSelection(contentEl);
        this.addImageSection(contentEl);
        this.addActionButtons(contentEl);
    }

    private buildManualModal() {
        const { contentEl } = this;
        
        new Setting(contentEl)
            .setName('Game Name')
            .setDesc('What game are you adding?')
            .addText(text => text
                .setPlaceholder('Enter game name...')
                .setValue(this.gameData.name)
                .onChange(value => {
                    this.gameData.name = value;
                    this.updateCreateButton();
                }));
        
        this.addEditableFields(contentEl);
        this.addDeviceSelection(contentEl);
        this.addImageSection(contentEl);
        this.addActionButtons(contentEl);
    }

    private addGameSearchSection(containerEl: HTMLElement) {
        const searchContainer = containerEl.createDiv('game-search-container');
        searchContainer.style.cssText = `
            position: relative;
            margin-bottom: 20px;
        `;

        new Setting(searchContainer)
            .setName('Search for Game')
            .setDesc('Start typing to search RAWG database or enter manually')
            .addText(text => {
                const searchInput = text.inputEl;
                searchInput.style.cssText = `
                    width: 100%;
                    position: relative;
                    z-index: 10;
                `;
                
                text.setPlaceholder('Enter game name...')
                    .onChange(async (value) => {
                        this.gameData.name = value;
                        this.updateCreateButton();
                        
                        if (this.searchTimeout) {
                            clearTimeout(this.searchTimeout);
                        }
                        
                        if (value.length >= 2) {
                            this.isSearching = true;
                            this.showSearchLoadingState();
                            
                            this.searchTimeout = setTimeout(async () => {
                                await this.searchRawg(value);
                                this.showSearchDropdown(searchContainer);
                                this.isSearching = false;
                            }, 200);
                        } else {
                            this.hideSearchDropdown();
                            this.clearSelectedGame();
                        }
                    });
                
                searchInput.addEventListener('keydown', (e) => {
                    this.handleSearchKeydown(e);
                });
                
                searchInput.addEventListener('blur', () => {
                    setTimeout(() => {
                        this.hideSearchDropdown();
                    }, 150);
                });
            });
    }

    private addGamePreviewSection(containerEl: HTMLElement) {
        const previewSection = containerEl.createDiv('game-preview-section');
        previewSection.style.cssText = `
            min-height: 120px;
            margin-bottom: 20px;
            padding: 15px;
            border: 1px solid var(--background-modifier-border);
            border-radius: 8px;
            background: var(--background-secondary);
            position: relative;
        `;
        
        const placeholder = previewSection.createDiv('preview-placeholder');
        placeholder.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            height: 90px;
            color: var(--text-muted);
            font-style: italic;
        `;
        placeholder.textContent = 'Search and select a game above, or enter details manually';
        
        previewSection.setAttribute('data-state', 'empty');
    }

    private addEditableFields(containerEl: HTMLElement) {
        new Setting(containerEl)
            .setName('Genre')
            .setDesc('Game genre(s) - separate multiple with commas')
            .addText(text => text
                .setPlaceholder('e.g., RPG, Action, Adventure')
                .setValue(this.gameData.genre)
                .onChange(value => {
                    this.gameData.genre = value;
                }));

        new Setting(containerEl)
            .setName('Description')
            .setDesc('Brief description of the game (optional)')
            .addTextArea(textArea => {
                textArea.setPlaceholder('Enter a brief description...');
                textArea.setValue(this.gameData.description);
                textArea.onChange(value => {
                    this.gameData.description = value;
                });
                textArea.inputEl.style.minHeight = '80px';
            });
    }

    private addDeviceSelection(containerEl: HTMLElement) {
        const activeDevices = this.plugin.getActiveDevices();
        
        if (activeDevices.length === 0) {
            // No devices configured - show helpful message
            const noDevicesContainer = containerEl.createDiv('no-devices-container');
            noDevicesContainer.style.cssText = `
                padding: 20px;
                text-align: center;
                background: var(--background-secondary);
                border-radius: 8px;
                margin: 15px 0;
            `;
            
            noDevicesContainer.createEl('h4', { text: '🎮 No Gaming Devices Configured' });
            noDevicesContainer.createEl('p', { 
                text: 'Please configure your gaming platforms in the plugin settings first.',
                cls: 'setting-item-description'
            });
            
            const settingsButton = noDevicesContainer.createEl('button', {
                text: 'Open Settings',
                cls: 'mod-cta'
            });

            settingsButton.onclick = () => {
                this.close();
                // Open the settings modal - this is the proper way in Obsidian
                // @ts-ignore - Obsidian internal API
                this.app.setting.open();
                // Unfortunately, we can't directly navigate to our plugin tab via API
                // The user will need to find the "Game Log" tab manually
            };
            return;
        }

        const deviceContainer = containerEl.createDiv('device-selection-container');
        
        // Show different headers based on device count
        if (activeDevices.length === 1) {
            deviceContainer.createEl('h4', { text: 'Store Selection' });
            deviceContainer.createEl('p', { 
                text: `Select where you'll get this game on ${activeDevices[0].name}:`,
                cls: 'setting-item-description' 
            });
            
            // Auto-select the single device
            this.gameData.platforms = [activeDevices[0].id];
            this.gameData.deviceStores[activeDevices[0].id] = [];
        } else {
            deviceContainer.createEl('h4', { text: 'Gaming Devices & Stores' });
            deviceContainer.createEl('p', { 
                text: 'Where will you play this game? Select devices and choose stores for each.',
                cls: 'setting-item-description' 
            });
            
            this.addDeviceButtons(deviceContainer);
        }

        // Store selection area (always shown)
        const storeContainer = deviceContainer.createDiv('store-selection-area');
        storeContainer.style.marginTop = '15px';
        
        this.updateStoreSelection(storeContainer);
    }

    private addDeviceButtons(containerEl: HTMLElement) {
        const activeDevices = this.plugin.getActiveDevices();
        
        const devicesContainer = containerEl.createDiv('devices-container');
        devicesContainer.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            justify-content: center;
            margin: 15px 0;
        `;

        activeDevices.forEach(device => {
            this.createDeviceButton(devicesContainer, device);
        });
    }

    private createDeviceButton(container: HTMLElement, device: UserDevice) {
        const button = container.createEl('button');
        const isSelected = this.gameData.platforms.includes(device.id);
        
        button.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px 16px;
            border: 2px solid ${isSelected ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};
            border-radius: 8px;
            background: ${isSelected ? 'var(--interactive-accent)' : 'var(--background-primary)'};
            color: ${isSelected ? 'var(--text-on-accent)' : 'var(--text-normal)'};
            cursor: pointer;
            transition: all 0.2s ease;
            font-weight: ${isSelected ? '600' : '500'};
        `;
        
        // Device icon
        const iconName = this.getDeviceIcon(device.type);
        const iconContainer = button.createSpan();
        iconContainer.style.cssText = `
            display: flex;
            align-items: center;
            width: 18px;
            height: 18px;
        `;
        setIcon(iconContainer, iconName);
        
        // Device name
        button.createSpan({ text: device.name });
        
        // Store reference
        button.setAttribute('data-device-id', device.id);
        
        button.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const currentlySelected = this.gameData.platforms.includes(device.id);
    
            if (currentlySelected) {
                // Remove device
                this.gameData.platforms = this.gameData.platforms.filter(p => p !== device.id);
                delete this.gameData.deviceStores[device.id];
            } else {
                // Add device
                this.gameData.platforms.push(device.id);
                // Initialize with empty store selection
                this.gameData.deviceStores[device.id] = [];
            }
            
            this.refreshDeviceButton(button, device);
            this.updateCreateButton();
            
            // Update store selection
            const storeContainer = container.parentElement?.querySelector('.store-selection-area') as HTMLElement;
            if (storeContainer) {
                this.updateStoreSelection(storeContainer);
            }
        };
        
        // Hover effects
        button.addEventListener('mouseenter', () => {
            if (!this.gameData.platforms.includes(device.id)) {
                button.style.borderColor = 'var(--interactive-accent)';
                button.style.background = 'var(--background-modifier-hover)';
            }
        });
        
        button.addEventListener('mouseleave', () => {
            if (!this.gameData.platforms.includes(device.id)) {
                button.style.borderColor = 'var(--background-modifier-border)';
                button.style.background = 'var(--background-primary)';
            }
        });
    }

    private refreshDeviceButton(button: HTMLElement, device: UserDevice) {
        const isSelected = this.gameData.platforms.includes(device.id);
        
        button.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px 16px;
            border: 2px solid ${isSelected ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};
            border-radius: 8px;
            background: ${isSelected ? 'var(--interactive-accent)' : 'var(--background-primary)'};
            color: ${isSelected ? 'var(--text-on-accent)' : 'var(--text-normal)'};
            cursor: pointer;
            transition: all 0.2s ease;
            font-weight: ${isSelected ? '600' : '500'};
        `;
    }

    private updateStoreSelection(container: HTMLElement) {
        container.empty();
        
        // Get devices to show stores for
        let devicesToShow: UserDevice[] = [];
        
        if (this.gameData.platforms.length === 0) {
            // No devices selected - show message for multi-device setups
            const activeDevices = this.plugin.getActiveDevices();
            
            if (activeDevices.length > 1) {
                container.createEl('p', {
                    text: 'Select devices above to choose stores.',
                    cls: 'setting-item-description',
                    attr: { style: 'text-align: center; color: var(--text-muted); font-style: italic;' }
                });
            }
            return;
        } else {
            // Get selected devices
            devicesToShow = this.plugin.settings.userDevices.filter(d => 
                this.gameData.platforms.includes(d.id)
            );
        }
        
        devicesToShow.forEach(device => {
            // Show device name only if multiple devices
            if (devicesToShow.length > 1) {
                container.createEl('h5', { 
                    text: `${device.name} - Select Stores:`,
                    attr: { style: 'margin: 15px 0 8px 0; color: var(--text-muted); font-size: 0.9em;' }
                });
            }
            
            this.addStoreSelectionRow(container, device);
            this.addSelectedStoresSummary(container, device);
        });
    }

    private addStoreSelectionRow(container: HTMLElement, device: UserDevice) {
        const selectionRow = container.createDiv('store-selection-row');
        selectionRow.style.cssText = `
            display: flex;
            gap: 15px;
            align-items: flex-start;
            margin-bottom: 8px;
        `;
        
        // Left side: Store buttons (available stores + subscriptions)
        const buttonsContainer = selectionRow.createDiv('store-buttons-container');
        buttonsContainer.style.cssText = `
            flex: 1;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            min-height: 40px;
        `;
        
        // Add store buttons
        this.addStoreButtons(buttonsContainer, device);
        
        // Add subscription buttons
        this.addSubscriptionButtons(buttonsContainer, device);
        
        // Right side: Search field for additional stores
        const searchContainer = selectionRow.createDiv('search-container');
        searchContainer.style.cssText = `
            width: 200px;
            position: relative;
        `;
        
        this.addStoreSearchField(searchContainer, device);
    }

    private addStoreButtons(container: HTMLElement, device: UserDevice) {
        // Show only compatible stores as buttons
        const allAvailableStores = device.availableStores || [];
        const storesToShow = allAvailableStores.filter(store => 
            this.plugin.validateStoreDeviceCombination(store, device)
        );
        
        storesToShow.forEach((store: string) => {
            const isSelected = this.gameData.deviceStores[device.id]?.includes(store) || false;
            
            const storeButton = container.createEl('button', { text: store });
            storeButton.style.cssText = `
                padding: 6px 12px;
                border: 2px solid ${isSelected ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};
                border-radius: 6px;
                background: ${isSelected ? 'var(--interactive-accent)' : 'var(--background-secondary)'};
                color: ${isSelected ? 'var(--text-on-accent)' : 'var(--text-normal)'};
                cursor: pointer;
                font-size: 0.85em;
                transition: all 0.2s ease;
                white-space: nowrap;
            `;
            
            storeButton.onclick = (e) => {
                e.preventDefault();
                this.toggleStoreForDevice(device.id, store);
                this.refreshStoreButton(storeButton, device.id, store);
                this.updateCreateButton();
                this.refreshSelectedStoresSummary(container.parentElement as HTMLElement, device);
            };
        });
    }

    private addSubscriptionButtons(container: HTMLElement, device: UserDevice) {
        // Get subscriptions relevant to this device
        const relevantSubs = device.enabledSubscriptions.filter((sub: string) => 
            this.plugin.settings.enabledSubscriptions[sub]
        );
        
        relevantSubs.forEach((service: string) => {
            const isSelected = this.gameData.subscriptionServices.includes(service);
            
            const subButton = container.createEl('button', { text: service });
            subButton.style.cssText = `
                padding: 6px 12px;
                border: 2px solid ${isSelected ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};
                border-radius: 6px;
                background: ${isSelected ? 'var(--interactive-accent)' : 'var(--background-secondary)'};
                color: ${isSelected ? 'var(--text-on-accent)' : 'var(--text-normal)'};
                cursor: pointer;
                font-size: 0.85em;
                font-style: italic;
                transition: all 0.2s ease;
                white-space: nowrap;
            `;
            
            subButton.onclick = (e) => {
                e.preventDefault();
                
                const subIndex = this.gameData.subscriptionServices.indexOf(service);
                
                if (subIndex >= 0) {
                    this.gameData.subscriptionServices.splice(subIndex, 1);
                } else {
                    this.gameData.subscriptionServices.push(service);
                }
                
                this.refreshSubscriptionButton(subButton, service);
                this.updateCreateButton();
            };
        });
    }

    private toggleStoreForDevice(deviceId: string, store: string) {
        if (!this.gameData.deviceStores[deviceId]) {
            this.gameData.deviceStores[deviceId] = [];
        }
        
        const storeIndex = this.gameData.deviceStores[deviceId].indexOf(store);
        
        if (storeIndex >= 0) {
            this.gameData.deviceStores[deviceId].splice(storeIndex, 1);
        } else {
            this.gameData.deviceStores[deviceId].push(store);
        }
    }

    private refreshStoreButton(button: HTMLElement, deviceId: string, store: string) {
        const isSelected = this.gameData.deviceStores[deviceId]?.includes(store) || false;
        
        button.style.cssText = `
            padding: 6px 12px;
            border: 2px solid ${isSelected ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};
            border-radius: 6px;
            background: ${isSelected ? 'var(--interactive-accent)' : 'var(--background-secondary)'};
            color: ${isSelected ? 'var(--text-on-accent)' : 'var(--text-normal)'};
            cursor: pointer;
            font-size: 0.85em;
            transition: all 0.2s ease;
            white-space: nowrap;
        `;
    }

    private refreshSubscriptionButton(button: HTMLElement, service: string) {
        const isSelected = this.gameData.subscriptionServices.includes(service);
        
        button.style.cssText = `
            padding: 6px 12px;
            border: 2px solid ${isSelected ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};
            border-radius: 6px;
            background: ${isSelected ? 'var(--interactive-accent)' : 'var(--background-secondary)'};
            color: ${isSelected ? 'var(--text-on-accent)' : 'var(--text-normal)'};
            cursor: pointer;
            font-size: 0.85em;
            font-style: italic;
            transition: all 0.2s ease;
            white-space: nowrap;
        `;
    }

    private addStoreSearchField(container: HTMLElement, device: UserDevice) {
        // Store search input
        const storeInput = container.createEl('input');
        storeInput.type = 'text';
        storeInput.placeholder = 'Add other stores...';
        storeInput.style.cssText = `
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--background-modifier-border);
            border-radius: 6px;
            background: var(--background-primary);
            font-size: 0.9em;
        `;
        
        // Store search dropdown
        let storeDropdown: HTMLElement | null = null;
        
        const showStoreDropdown = (query: string) => {
            // Hide existing dropdown
            if (storeDropdown) {
                storeDropdown.remove();
                storeDropdown = null;
            }
            
            if (query.trim().length === 0) return;
            
            // Get predefined stores that are compatible with this device
            const allPredefinedStores = [
                'Steam', 'Epic Games Store', 'GOG', 'Xbox App', 
                'Origin/EA App', 'Ubisoft Connect', 'Battle.net', 'Itch.io',
                'Humble Store', 'PlayStation Store', 'Xbox Store', 'Nintendo eShop'
            ];
            
            // Filter stores: must match query, be compatible, and not already selected/available
            const selectedStores = this.gameData.deviceStores[device.id] || [];
            const availableStores = device.availableStores || [];
            const filteredStores = allPredefinedStores.filter((store: string) => 
                store.toLowerCase().includes(query.toLowerCase()) &&
                !selectedStores.includes(store) &&
                !availableStores.includes(store) &&
                this.plugin.validateStoreDeviceCombination(store, device)
            );
            
            // Create dropdown
            storeDropdown = container.createDiv('store-dropdown');
            storeDropdown.style.cssText = `
                position: absolute;
                top: 100%;
                left: 0;
                right: 0;
                background: var(--background-primary);
                border: 1px solid var(--background-modifier-border);
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                z-index: 1000;
                max-height: 150px;
                overflow-y: auto;
            `;
            
            // Add filtered predefined stores
            filteredStores.forEach((store: string) => {
                if (!storeDropdown) return;
                const storeItem = storeDropdown.createDiv('store-item');
                storeItem.style.cssText = `
                    padding: 8px 12px;
                    cursor: pointer;
                    border-bottom: 1px solid var(--background-modifier-border);
                    transition: background-color 0.2s;
                `;
                storeItem.textContent = store;
                
                storeItem.addEventListener('click', () => {
                    this.addStoreToDevice(device.id, store);
                    storeInput.value = '';
                    if (storeDropdown) {
                        storeDropdown.remove();
                        storeDropdown = null;
                    }
                    this.refreshSelectedStoresSummary(container.parentElement?.parentElement as HTMLElement, device);
                    this.updateCreateButton();
                });
                
                storeItem.addEventListener('mouseenter', () => {
                    storeItem.style.backgroundColor = 'var(--background-modifier-hover)';
                });
                storeItem.addEventListener('mouseleave', () => {
                    storeItem.style.backgroundColor = '';
                });
            });
            
            // Always show custom option if query has content
            if (query.trim()) {
                if (!storeDropdown) return;
                const customItem = storeDropdown.createDiv('store-item');
                customItem.style.cssText = `
                    padding: 8px 12px;
                    cursor: pointer;
                    border-top: 1px solid var(--background-modifier-border);
                    background: var(--background-secondary);
                    font-style: italic;
                `;
                customItem.textContent = `Add custom: "${query}"`;
                
                customItem.addEventListener('click', () => {
                    this.addStoreToDevice(device.id, query);
                    storeInput.value = '';
                    if (storeDropdown) {
                        storeDropdown.remove();
                        storeDropdown = null;
                    }
                    this.refreshSelectedStoresSummary(container.parentElement?.parentElement as HTMLElement, device);
                    this.updateCreateButton();
                });
                
                customItem.addEventListener('mouseenter', () => {
                    customItem.style.backgroundColor = 'var(--background-modifier-hover)';
                });
                customItem.addEventListener('mouseleave', () => {
                    customItem.style.backgroundColor = '';
                });
            }
        };
        
        // Store input handlers
        storeInput.addEventListener('input', (e) => {
            const query = (e.target as HTMLInputElement).value;
            showStoreDropdown(query);
        });
        
        storeInput.addEventListener('blur', () => {
            setTimeout(() => {
                if (storeDropdown) {
                    storeDropdown.remove();
                    storeDropdown = null;
                }
            }, 150);
        });
        
        storeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && storeDropdown) {
                storeDropdown.remove();
                storeDropdown = null;
                storeInput.blur();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const query = storeInput.value.trim();
                if (query) {
                    this.addStoreToDevice(device.id, query);
                    storeInput.value = '';
                    if (storeDropdown) {
                        storeDropdown.remove();
                        storeDropdown = null;
                    }
                    this.refreshSelectedStoresSummary(container.parentElement?.parentElement as HTMLElement, device);
                    this.updateCreateButton();
                }
            }
        });
    }

    private addSelectedStoresSummary(container: HTMLElement, device: UserDevice) {
        const summaryContainer = container.createDiv('selected-stores-summary');
        summaryContainer.setAttribute('data-device-id', device.id);
        summaryContainer.style.cssText = `
            font-size: 0.85em;
            color: var(--text-muted);
            margin-bottom: 10px;
            padding: 6px 8px;
            background: var(--background-modifier-form-field);
            border-radius: 4px;
            min-height: 16px;
        `;
        
        this.refreshSelectedStoresSummary(container, device);
    }

    private refreshSelectedStoresSummary(container: HTMLElement, device: UserDevice) {
        const summaryContainer = container.querySelector(`[data-device-id="${device.id}"]`) as HTMLElement;
        if (!summaryContainer) return;
        
        const deviceStores = this.gameData.deviceStores[device.id] || [];
        const deviceSubscriptions = this.gameData.subscriptionServices.filter((sub: string) => 
            device.enabledSubscriptions && device.enabledSubscriptions.includes(sub)
        );
        
        const allSelections = [...deviceStores, ...deviceSubscriptions];
        
        if (allSelections.length === 0) {
            summaryContainer.textContent = 'No stores or subscriptions selected for this device';
        } else {
            const storeText = deviceStores.length > 0 ? `Stores: ${deviceStores.join(', ')}` : '';
            const subText = deviceSubscriptions.length > 0 ? `Subscriptions: ${deviceSubscriptions.join(', ')}` : '';
            const parts = [storeText, subText].filter(part => part);
            summaryContainer.textContent = parts.join(' • ');
        }
    }

    private addStoreToDevice(deviceId: string, store: string) {
        if (!this.gameData.deviceStores[deviceId]) {
            this.gameData.deviceStores[deviceId] = [];
        }
        if (!this.gameData.deviceStores[deviceId].includes(store)) {
            this.gameData.deviceStores[deviceId].push(store);
        }
}

    private getDeviceIcon(deviceType: DeviceType): string {
        const iconMap: Record<DeviceType, string> = {
            'computer': 'monitor',
            'handheld': 'smartphone',
            'console': 'gamepad-2',
            'hybrid': 'tablet',
            'mobile': 'smartphone',
            'custom': 'joystick'
        };
        return iconMap[deviceType] || 'joystick';
    }

    private updateCreateButton() {
        const button = this.contentEl.querySelector('#create-game-button') as HTMLButtonElement;
        if (button) {
            // Check if we have name and at least one device with stores OR subscriptions
            const hasValidDeviceStores = Object.values(this.gameData.deviceStores).some(stores => stores.length > 0);
            const hasSubscriptions = this.gameData.subscriptionServices.length > 0;
            const isValid = this.gameData.name.trim() && (hasValidDeviceStores || hasSubscriptions);
            
            button.disabled = !isValid;
            button.textContent = isValid ? 'Create Game' : 'Please complete required fields';
        }
    }

    // Keep all the RAWG search and game preview methods from the original...
    private showSearchLoadingState() {
        this.hideSearchDropdown();
        
        const searchContainer = this.contentEl.querySelector('.game-search-container');
        if (searchContainer) {
            let loadingIndicator = searchContainer.querySelector('.search-loading') as HTMLElement;
            if (!loadingIndicator) {
                loadingIndicator = searchContainer.createDiv('search-loading');
                loadingIndicator.style.cssText = `
                    position: absolute;
                    right: 10px;
                    top: 50%;
                    transform: translateY(-50%);
                    font-size: 0.8em;
                    color: var(--text-muted);
                    z-index: 5;
                `;
            }
            loadingIndicator.textContent = 'Searching...';
        }
    }

    private showSearchDropdown(searchContainer: HTMLElement) {
        this.hideSearchDropdown();
        
        const loadingIndicator = searchContainer.querySelector('.search-loading');
        if (loadingIndicator) {
            loadingIndicator.remove();
        }
        
        if (this.searchResults.length === 0) return;
        
        this.searchDropdown = searchContainer.createDiv('search-dropdown');
        this.searchDropdown.style.cssText = `
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: var(--background-primary);
            border: 1px solid var(--background-modifier-border);
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1000;
            max-height: 300px;
            overflow-y: auto;
        `;
        
        // Initialize keyboard navigation AFTER creating the dropdown
        this.searchKeyboardNav = new KeyboardNavigationHelper(this.searchDropdown);
        
        this.searchResults.forEach((game, index) => {
            if (!this.searchDropdown) return;
            const resultItem = this.searchDropdown.createDiv('search-result-item');
            resultItem.style.cssText = `
                padding: 12px 15px;
                cursor: pointer;
                border-bottom: 1px solid var(--background-modifier-border);
                transition: background-color 0.2s;
                display: flex;
                flex-direction: column;
                gap: 4px;
            `;
            
            if (index === this.searchResults.length - 1) {
                resultItem.style.borderBottom = 'none';
            }
            
            const title = resultItem.createEl('div', { text: game.name });
            title.style.cssText = `
                font-weight: 500;
                color: var(--text-normal);
            `;
            
            const info = resultItem.createDiv();
            const genres = game.genres?.map(g => g.name).slice(0, 3).join(', ') || 'Unknown genre';
            const year = game.released ? ` (${new Date(game.released).getFullYear()})` : '';
            info.textContent = `${genres}${year}`;
            info.style.cssText = `
                font-size: 0.9em;
                color: var(--text-muted);
            `;
            
            // Register for keyboard navigation
            if (this.searchKeyboardNav) {
                this.searchKeyboardNav.addItem(resultItem, () => {
                    this.selectGame(game);
                    this.hideSearchDropdown();
                });
            }
            
            resultItem.addEventListener('click', () => {
                this.selectGame(game);
                this.hideSearchDropdown();
            });
            
            resultItem.addEventListener('mouseenter', () => {
                resultItem.style.backgroundColor = 'var(--background-modifier-hover)';
            });
            resultItem.addEventListener('mouseleave', () => {
                resultItem.style.backgroundColor = '';
            });
        });
        
        const manualOption = this.searchDropdown.createDiv('manual-option');
        manualOption.style.cssText = `
            padding: 12px 15px;
            cursor: pointer;
            border-top: 1px solid var(--background-modifier-border);
            background: var(--background-secondary);
            font-style: italic;
            color: var(--text-muted);
            text-align: center;
        `;
        manualOption.textContent = `Or continue with "${this.gameData.name}" (manual entry)`;
        
        // Register manual option for keyboard navigation too
        if (this.searchKeyboardNav) {
            this.searchKeyboardNav.addItem(manualOption, () => {
                this.hideSearchDropdown();
                this.clearSelectedGame();
                this.updateGamePreview();
            });
        }
        
        manualOption.addEventListener('click', () => {
            this.hideSearchDropdown();
            this.clearSelectedGame();
            this.updateGamePreview();
        });
    }

    private hideSearchDropdown() {
        // Clean up keyboard navigation first
        if (this.searchKeyboardNav) {
            this.searchKeyboardNav.destroy();
            this.searchKeyboardNav = null;
        }
        
        if (this.searchDropdown) {
            this.searchDropdown.remove();
            this.searchDropdown = null;
        }
    }

    private handleSearchKeydown(e: KeyboardEvent) {
        if (!this.searchDropdown) return;
        
        if (e.key === 'Escape') {
            this.hideSearchDropdown();
        }
    }

    private async selectGame(game: RawgGame) {
        this.selectedGame = game;
        
        this.showGamePreviewLoading();
        
        try {
            const gameDetails = await this.fetchGameDetails(game.id);
            
            this.gameData.name = gameDetails.name || game.name;
            this.gameData.genre = gameDetails.genres?.map((g: {name: string}) => g.name).join(', ') || game.genres?.map((g: {name: string}) => g.name).join(', ') || '';
            this.gameData.description = this.cleanDescription(gameDetails.description || '');
            this.gameData.rawgId = game.id.toString();
            
            this.gameData.steamAppId = await this.findSteamAppId(game.id);
            
        } catch (error) {
            console.error('Error fetching game details:', error);
            this.gameData.name = game.name;
            this.gameData.genre = game.genres?.map(g => g.name).join(', ') || '';
            this.gameData.description = '';
            this.gameData.rawgId = game.id.toString();
        }
        
        this.updateGamePreview();
        this.updateFormFields();
        
        new Notice(`✨ Selected: ${this.gameData.name}`);
    }

    private showGamePreviewLoading() {
        const previewSection = this.contentEl.querySelector('.game-preview-section');
        if (previewSection) {
            previewSection.empty();
            previewSection.setAttribute('data-state', 'loading');
            
            const loading = previewSection.createDiv();
            loading.style.cssText = `
                display: flex;
                align-items: center;
                justify-content: center;
                height: 90px;
                color: var(--text-muted);
            `;
            loading.textContent = 'Loading game details...';
        }
    }

    private updateGamePreview() {
        const previewSection = this.contentEl.querySelector('.game-preview-section');
        if (!previewSection) return;
        
        previewSection.empty();
        
        if (this.selectedGame || this.gameData.name) {
            previewSection.setAttribute('data-state', 'filled');
            
            const content = previewSection.createDiv('preview-content');
            content.style.cssText = `
                display: flex;
                gap: 15px;
                align-items: flex-start;
            `;
            
            const imageSection = content.createDiv('preview-image');
            imageSection.style.cssText = `
                flex-shrink: 0;
                width: 60px;
                height: 90px;
                border-radius: 6px;
                overflow: hidden;
                background: var(--background-modifier-border);
                display: flex;
                align-items: center;
                justify-content: center;
            `;
            
            if (this.gameData.steamAppId) {
                const img = imageSection.createEl('img');
                img.style.cssText = `
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                `;
                img.src = `https://steamcdn-a.akamaihd.net/steam/apps/${this.gameData.steamAppId}/library_600x900.jpg`;
                img.onerror = () => {
                    imageSection.empty();
                    imageSection.createSpan({ text: '🎮' });
                };
            } else {
                imageSection.createSpan({ 
                    text: '🎮',
                    attr: { style: 'font-size: 24px;' }
                });
            }
            
            const infoSection = content.createDiv('preview-info');
            infoSection.style.cssText = `
                flex: 1;
                min-width: 0;
            `;
            
            const title = infoSection.createEl('h4', { text: this.gameData.name });
            title.style.cssText = `
                margin: 0 0 8px 0;
                color: var(--text-normal);
            `;
            
            if (this.gameData.genre) {
                const genre = infoSection.createEl('p', { text: `Genre: ${this.gameData.genre}` });
                genre.style.cssText = `
                    margin: 0 0 6px 0;
                    font-size: 0.9em;
                    color: var(--text-muted);
                `;
            }
            
            if (this.gameData.description) {
                const desc = infoSection.createEl('p');
                desc.textContent = this.gameData.description.length > 120 
                    ? this.gameData.description.substring(0, 120) + '...'
                    : this.gameData.description;
                desc.style.cssText = `
                    margin: 0;
                    font-size: 0.85em;
                    color: var(--text-muted);
                    line-height: 1.3;
                `;
            }
            
            const source = infoSection.createEl('div');
            source.textContent = this.selectedGame ? '✨ From RAWG database' : '📝 Manual entry';
            source.style.cssText = `
                margin-top: 8px;
                font-size: 0.8em;
                color: var(--text-accent);
                font-style: italic;
            `;
            
        } else {
            previewSection.setAttribute('data-state', 'empty');
            const placeholder = previewSection.createDiv('preview-placeholder');
            placeholder.style.cssText = `
                display: flex;
                align-items: center;
                justify-content: center;
                height: 90px;
                color: var(--text-muted);
                font-style: italic;
            `;
            placeholder.textContent = 'Search and select a game above, or enter details manually';
        }
    }

    private clearSelectedGame() {
        this.selectedGame = null;
        
        if (this.gameData.rawgId) {
            this.gameData.genre = '';
            this.gameData.description = '';
            delete this.gameData.rawgId;
            delete this.gameData.steamAppId;
        }
    }

    private async findSteamAppId(rawgGameId: number): Promise<string | undefined> {
        try {
            const response = await requestUrl({
                url: `https://api.rawg.io/api/games/${rawgGameId}/stores?key=${this.plugin.settings.rawgApiKey}`,
                method: 'GET'
            });
            
            const storesData = response.json;
            if (storesData.results) {
                const steamStore = storesData.results.find((store: { store_id: number; url?: string }) => store.store_id === 1);
                if (steamStore && steamStore.url) {
                    const appIdMatch = steamStore.url.match(/\/app\/(\d+)/);
                    return appIdMatch ? appIdMatch[1] : undefined;
                }
            }
            return undefined;
        } catch (error) {
            console.error('Error finding Steam App ID:', error);
            return undefined;
        }
    }

    private async searchRawg(query: string) {
        if (!this.plugin.settings.rawgApiKey) return;
        
        try {
            const response = await requestUrl({
                url: `https://api.rawg.io/api/games?key=${this.plugin.settings.rawgApiKey}&search=${encodeURIComponent(query)}&page_size=8`,
                method: 'GET'
            });
            
            this.searchResults = response.json.results || [];
        } catch (error) {
            console.error('RAWG search error:', error);
            new Notice('Failed to search RAWG database');
            this.searchResults = [];
        }
    }

    private async fetchGameDetails(gameId: number): Promise<RawgGameDetails> {
        const response = await requestUrl({
            url: `https://api.rawg.io/api/games/${gameId}?key=${this.plugin.settings.rawgApiKey}`,
            method: 'GET'
        });
        
        return response.json;
    }

    private addImageSection(containerEl: HTMLElement) {
        const imageSection = containerEl.createDiv('image-section');
        imageSection.createEl('h4', { text: 'Game Images (Optional)' });

        const dropZone = imageSection.createDiv('image-drop-zone');
        dropZone.style.cssText = `
            border: 2px dashed var(--background-modifier-border);
            border-radius: 8px;
            padding: 40px 20px;
            text-align: center;
            margin: 10px 0;
            transition: border-color 0.2s, background-color 0.2s;
            cursor: pointer;
        `;

        const dropText = dropZone.createDiv();
        dropText.innerHTML = `
            <div style="font-size: 1.2em; margin-bottom: 10px;">📁 Drag images here</div>
            <div style="color: var(--text-muted);">or click to browse files</div>
            <div style="font-size: 0.8em; color: var(--text-muted); margin-top: 5px;">
                Supports: JPG, PNG, GIF • Box art, headers, screenshots
            </div>
        `;

        const fileInput = imageSection.createEl('input', {
            type: 'file',
            attr: {
                multiple: 'true',
                accept: '.jpg,.jpeg,.png,.gif'
            }
        });
        fileInput.style.display = 'none';

        dropZone.addEventListener('click', () => {
            fileInput.click();
        });

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'var(--interactive-accent)';
            dropZone.style.backgroundColor = 'var(--background-modifier-hover)';
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.style.borderColor = 'var(--background-modifier-border)';
            dropZone.style.backgroundColor = '';
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'var(--background-modifier-border)';
            dropZone.style.backgroundColor = '';
            
            const files = Array.from(e.dataTransfer?.files || []);
            this.handleImageFiles(files);
        });

        fileInput.addEventListener('change', (e) => {
            const files = Array.from((e.target as HTMLInputElement).files || []);
            this.handleImageFiles(files);
        });
    }

    private handleImageFiles(files: File[]) {
        const validFiles = files.filter(file => 
            file.type.startsWith('image/') && file.size < 10 * 1024 * 1024 // 10MB limit
        );

        if (validFiles.length > 0) {
            new Notice(`📁 ${validFiles.length} image(s) ready to upload`);
            // Store files for use when creating the game
        }

        if (files.length > validFiles.length) {
            new Notice('⚠️ Some files were skipped (invalid type or too large)');
        }
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
            text: 'Create Game',
            cls: 'mod-cta'
        });
        createButton.id = 'create-game-button';
        
        this.updateCreateButton();
        
        createButton.onclick = async () => {
            await this.createGame();
        };
    }

    private updateFormFields() {
        const nameInput = this.contentEl.querySelector('input[placeholder="Enter game name..."]') as HTMLInputElement;
        const genreInput = this.contentEl.querySelector('input[placeholder="e.g., RPG, Action, Adventure"]') as HTMLInputElement;
        const descTextarea = this.contentEl.querySelector('textarea') as HTMLTextAreaElement;

        if (nameInput) nameInput.value = this.gameData.name;
        if (genreInput) genreInput.value = this.gameData.genre;
        if (descTextarea) descTextarea.value = this.gameData.description;
        
        this.updateCreateButton();
    }

    private cleanDescription(rawDescription: string): string {
        if (!rawDescription) return '';
        
        const cleaned = rawDescription
            .replace(/<[^>]*>/g, '') // Remove HTML tags
            .replace(/\r\n/g, ' ')
            .replace(/\r/g, ' ')
            .replace(/\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (cleaned.length <= 300) {
            return cleaned;
        }
        
        const firstPart = cleaned.substring(0, 400);
        const lastSentence = firstPart.lastIndexOf('.');
        
        if (lastSentence > 200) {
            return cleaned.substring(0, lastSentence + 1);
        }
        
        const fallback = cleaned.substring(0, 300);
        const lastSpace = fallback.lastIndexOf(' ');
        
        return lastSpace > 200 ? 
            cleaned.substring(0, lastSpace) + '...' : 
            cleaned.substring(0, 300) + '...';
    }

    private async createGame() {
        if (!this.gameData.name.trim()) {
            new Notice('Please enter a game name');
            return;
        }

        const hasValidStores = Object.values(this.gameData.deviceStores).some(stores => stores.length > 0);
        const hasSubscriptions = this.gameData.subscriptionServices.length > 0;
        
        if (!hasValidStores && !hasSubscriptions) {
            new Notice('Please select at least one store or subscription service');
            return;
        }

        try {
            await this.createGameStructure();
            
            new Notice(`🎮 "${this.gameData.name}" created successfully!`);
            this.close();
            
        } catch (error) {
            console.error('Error creating game:', error);
            new Notice(`❌ Error creating game: ${error.message}`);
        }
    }

    private async createGameStructure() {
        const gameName = this.gameData.name;
        
        // Create folder structure using readable names
        await this.app.vault.createFolder(`${this.plugin.settings.gamesFolder}/${gameName}`).catch(() => {});
        await this.app.vault.createFolder(`${this.plugin.settings.gamesFolder}/${gameName}/Playthroughs`).catch(() => {});
        await this.app.vault.createFolder(`${this.plugin.settings.gamesFolder}/${gameName}/Sessions`).catch(() => {});
        await this.app.vault.createFolder(`${this.plugin.settings.gamesFolder}/${gameName}/Reports`).catch(() => {});
        await this.app.vault.createFolder(`${this.plugin.settings.gamesFolder}/${gameName}/Images`).catch(() => {});
        await this.app.vault.createFolder(`${this.plugin.settings.gamesFolder}/${gameName}/Images/Screenshots`).catch(() => {});
        await this.app.vault.createFolder(`${this.plugin.settings.gamesFolder}/${gameName}/Images/Characters`).catch(() => {});
        await this.app.vault.createFolder(`${this.plugin.settings.gamesFolder}/${gameName}/Images/Custom`).catch(() => {});

        // Download Steam images if we have a Steam App ID
        const imagePaths = {
            box_art_image: '',
            header_image: '',
            hero_image: '',
            logo_image: ''
        };
        
        if (this.gameData.steamAppId) {
            // Download header image (for library view)
            try {
                const headerUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${this.gameData.steamAppId}/header.jpg`;
                const headerResponse = await requestUrl({ url: headerUrl });
                
                if (headerResponse.status === 200) {
                    const headerPath = `${this.plugin.settings.gamesFolder}/${gameName}/Images/header.jpg`;
                    await this.app.vault.createBinary(
                        headerPath, 
                        headerResponse.arrayBuffer
                    );
                    imagePaths.header_image = headerPath;
                }
            } catch (error) {
                console.log('Could not download header image:', error);
            }

            // Download box art
            try {
                const boxArtUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${this.gameData.steamAppId}/library_600x900_2x.jpg`;
                const boxArtResponse = await requestUrl({ url: boxArtUrl });
                
                if (boxArtResponse.status === 200) {
                    const boxArtPath = `${this.plugin.settings.gamesFolder}/${gameName}/Images/box_art.jpg`;
                    await this.app.vault.createBinary(
                        boxArtPath,
                        boxArtResponse.arrayBuffer
                    );
                    imagePaths.box_art_image = boxArtPath;
                }
            } catch (error) {
                console.log('Could not download box art:', error);
            }

            // Download hero image
            try {
                const heroUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${this.gameData.steamAppId}/library_hero.jpg`;
                const heroResponse = await requestUrl({ url: heroUrl });
                
                if (heroResponse.status === 200) {
                    const heroPath = `${this.plugin.settings.gamesFolder}/${gameName}/Images/hero.jpg`;
                    await this.app.vault.createBinary(
                        heroPath,
                        heroResponse.arrayBuffer
                    );
                    imagePaths.hero_image = heroPath;
                }
            } catch (error) {
                console.log('Could not download hero image:', error);
            }

            // Download logo
            try {
                const logoUrl = `https://steamcdn-a.akamaihd.net/steam/apps/${this.gameData.steamAppId}/logo.png`;
                const logoResponse = await requestUrl({ url: logoUrl });
                
                if (logoResponse.status === 200) {
                    const logoPath = `${this.plugin.settings.gamesFolder}/${gameName}/Images/logo.png`;
                    await this.app.vault.createBinary(
                        logoPath,
                        logoResponse.arrayBuffer
                    );
                    imagePaths.logo_image = logoPath;
                }
            } catch (error) {
                console.log('Could not download logo:', error);
            }
        }

        // Create Game Overview file with image paths
        const gameOverviewContent = this.generateGameOverviewContent(imagePaths);
        const overviewPath = `${this.plugin.settings.gamesFolder}/${gameName}/${gameName} - Game Overview.md`;
        await this.app.vault.create(overviewPath, gameOverviewContent);
        
        // Open the newly created game overview
        const createdFile = this.app.vault.getAbstractFileByPath(overviewPath);
        if (createdFile instanceof TFile) {
            await this.app.workspace.getLeaf().openFile(createdFile);
        }
    }

    private generateGameOverviewContent(imagePaths: {
            box_art_image: string;
            header_image: string;
            hero_image: string;
            logo_image: string;
        }): string {
        const gameName = this.gameData.name;
        
        // Generate platform/device summary for frontmatter
        const selectedDevices = this.plugin.settings.userDevices.filter(d => 
            this.gameData.platforms.includes(d.id)
        );
        
        const smartPlatformInfo = selectedDevices.map(device => {
            const stores = this.gameData.deviceStores[device.id] || [];
            const deviceSubs = this.gameData.subscriptionServices.filter(sub => 
                device.enabledSubscriptions && device.enabledSubscriptions.includes(sub)
        );
    
    // Combine stores and subscriptions, with subscriptions in italics
    const allSources = [
        ...stores,
        ...deviceSubs.map(sub => `*${sub}*`)
    ];
    
    if (allSources.length > 0) {
        return `${device.name} (${allSources.join(', ')})`;
    } else {
        return device.name;
    }
}).join(', ');
        
        const genre = this.gameData.genre || 'No genre specified';
        const description = this.gameData.description || 'No description available';
        const rawgId = this.gameData.rawgId || 'N/A';
        const steamAppId = this.gameData.steamAppId || 'N/A';
        const hasRawgData = this.gameData.rawgId ? 'true' : 'false';

        return `---
game_name: "${gameName}"
genre: "${genre}"
detailed_genres: "${genre}"
store_platform: "${smartPlatformInfo}"
description: "${description}"
status: Not Started
date_added: "${new Date().toISOString().split('T')[0]}"
current_playthrough: ""
total_playthroughs: 0
total_hours: 0
rating: 
box_art_image: "${imagePaths.box_art_image}"
header_image: "${imagePaths.header_image}"
hero_image: "${imagePaths.hero_image}"
logo_image: "${imagePaths.logo_image}"
has_images: ${imagePaths.header_image ? 'true' : 'false'}
rawg_id: "${rawgId}"
rawg_slug: "N/A"
steam_app_id: "${steamAppId}"
has_rawg_data: ${hasRawgData}
# Device tracking data
devices: ${JSON.stringify(this.gameData.platforms)}
device_stores: ${JSON.stringify(this.gameData.deviceStores)}
subscription_services: ${JSON.stringify(this.gameData.subscriptionServices)}
tags:
  - game-overview
  - ${genre.toLowerCase().replace(/[^a-z0-9]/g, '-')}
---
\`\`\`meta-bind-button
style: primary
label: 🎯 New Playthrough
id: createPlaythrough
hidden: true
action:
  type: command
  command: game-log:create-playthrough
\`\`\`

# ${gameName} - Game Overview

${imagePaths.box_art_image ? `![Box Art](${imagePaths.box_art_image.split('/').pop()})` : ''}

*${description}*

## Quick Info
- **Status**: \`INPUT[inlineSelect(option(Not Started), option(Planning), option(Playing), option(Completed), option(On Hold), option(Dropped)):status]\`
- **Current Playthrough**: \`VIEW[{current_playthrough}]\`
- **Total Playthroughs**: \`VIEW[{total_playthroughs}]\`
- **Total Hours Played**: \`VIEW[{total_hours}]\`
- **My Rating**: \`INPUT[inlineSelect(option(🚫), option(⭐), option(⭐⭐), option(⭐⭐⭐), option(⭐⭐⭐⭐), option(⭐⭐⭐⭐⭐)):rating]\`
- **Platforms**: ${smartPlatformInfo || 'Not specified'}
- **Genres**: ${genre}

## Actions

\`BUTTON[createPlaythrough]\`

## Recent Playthroughs

\`\`\`dataview
TABLE WITHOUT ID
  link(file.link, playthrough_name) as "Playthrough",
  status as "Status",
  last_session as "Last Played",
  total_sessions as "Sessions"
FROM "${this.plugin.settings.gamesFolder}/${gameName}/Playthroughs"
SORT file.link DESC
LIMIT 5
\`\`\`

## Notes

_Add any general notes about the game here..._
`;
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        
        if (this.searchTimeout) {
            clearTimeout(this.searchTimeout);
        }
        
        // Clean up keyboard navigation
        if (this.searchKeyboardNav) {
            this.searchKeyboardNav.destroy();
            this.searchKeyboardNav = null;
        }
        
        this.hideSearchDropdown();
    }
}