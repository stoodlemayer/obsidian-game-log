import { App, PluginSettingTab, Setting, Notice, Modal, setIcon } from 'obsidian';
import type { default as GameLogPlugin } from './main';
import type { UserDevice, DeviceType } from './main';
import { KeyboardNavigationHelper } from './keyboardNavigation';

export class GameLogSettingTab extends PluginSettingTab {
    plugin: GameLogPlugin;

    constructor(app: App, plugin: GameLogPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();

        containerEl.createEl('h2', {text: 'Game Log Settings'});

        this.addBasicSettings(containerEl);
        this.addPlatformSettings(containerEl);
        this.addSubscriptionSettings(containerEl);
    }

    private getSmartPlatformLabel(): string {
        const computerDevices = this.plugin.settings.userDevices.filter(d => 
            d.platforms.some(p => ['PC', 'Windows', 'Mac', 'Linux', 'SteamOS'].includes(p))
        );
        
        if (computerDevices.length === 0) {
            return 'PC'; // Default fallback
        }
        
        const allPlatforms = new Set<string>();
        computerDevices.forEach(device => {
            device.platforms.forEach(platform => {
                if (['PC', 'Windows', 'Mac', 'Linux', 'SteamOS'].includes(platform)) {
                    allPlatforms.add(platform);
                }
            });
        });
        
        const platformLabels: string[] = [];
        
        // Always show PC first (covers Windows/PC)
        if (allPlatforms.has('PC') || allPlatforms.has('Windows')) {
            platformLabels.push('PC');
        }
        
        if (allPlatforms.has('Mac')) {
            platformLabels.push('Mac');
        }
        
        if (allPlatforms.has('Linux')) {
            platformLabels.push('Linux');
        }
        
        // SteamOS gets treated as Linux for labeling
        if (allPlatforms.has('SteamOS') && !allPlatforms.has('Linux')) {
            platformLabels.push('SteamOS');
        }
        
        return platformLabels.length > 0 ? platformLabels.join('/') : 'PC';
    }

    private async createQuickDevice(deviceType: 'ps5' | 'xbox' | 'switch' | 'pc' | 'steamdeck'): Promise<void> {
        const deviceConfigs = {
            ps5: {
                name: 'PlayStation 5',
                type: 'console' as DeviceType,
                platforms: ['PlayStation'],
                platformStores: {
                    'PlayStation': ['PlayStation Store']
                },
                platformSubscriptions: {
                    'PlayStation': ['PlayStation Plus', 'EA Play', 'Ubisoft+'].filter(sub => 
                        this.plugin.settings.enabledSubscriptions[sub] === true
                    )
                }
            },
            xbox: {
                name: 'Xbox Series X',
                type: 'console' as DeviceType,
                platforms: ['Xbox'],
                platformStores: {
                    'Xbox': ['Xbox Store']
                },
                platformSubscriptions: {
                    'Xbox': ['Xbox Game Pass', 'EA Play', 'Ubisoft+'].filter(sub => 
                        this.plugin.settings.enabledSubscriptions[sub] === true
                    )
                }
            },
            switch: {
                name: 'Nintendo Switch 2',
                type: 'handheld' as DeviceType,
                platforms: ['Nintendo'],
                platformStores: {
                    'Nintendo': ['Nintendo eShop']
                },
                platformSubscriptions: {
                    'Nintendo': ['Nintendo Switch Online'].filter(sub => 
                        this.plugin.settings.enabledSubscriptions[sub] === true
                    )
                }
            },
            pc: {
                name: 'Gaming PC',
                type: 'computer' as DeviceType,
                platforms: ['Windows'],
                platformStores: {
                    'Windows': this.getEnabledPCStores()
                },
                platformSubscriptions: {
                    'Windows': ['PC Game Pass', 'EA Play', 'Ubisoft+'].filter(sub => 
                        this.plugin.settings.enabledSubscriptions[sub] === true
                    )
                }
            },
            steamdeck: {
                name: 'Steam Deck',
                type: 'handheld' as DeviceType,
                platforms: ['SteamOS'],
                platformStores: {
                    'SteamOS': ['Steam']
                },
                platformSubscriptions: {
                    'SteamOS': []
                }
            }
        };
        
        const config = deviceConfigs[deviceType];
        
        try {
            // Generate unique name if device already exists
            let deviceName = config.name;
            let counter = 2;
            while (this.plugin.settings.userDevices.some(d => d.name === deviceName)) {
                deviceName = `${config.name} ${counter}`;
                counter++;
            }
            
            const newDevice: UserDevice = {
                id: `quick-${deviceType}-${Date.now()}`,
                name: deviceName,
                type: config.type,
                platforms: config.platforms,
                platformStores: config.platformStores,
                platformSubscriptions: config.platformSubscriptions,
                isDefault: !this.plugin.settings.userDevices.some(d => 
                    d.platforms.some(p => config.platforms.includes(p)) && d.isDefault
                ),
                isAutoGenerated: true
            };
            
            this.plugin.settings.userDevices.push(newDevice);
            await this.plugin.saveSettings();
            
            new Notice(`✅ Added ${deviceName}!`);
            this.display(); // Refresh to show the new device
            
        } catch (error) {
            console.error('Error creating quick device:', error);
            new Notice(`❌ Error adding ${config.name}: ${error.message}`);
        }
    }

    private addBasicSettings(containerEl: HTMLElement) {
        containerEl.createEl('h3', {text: 'Basic Settings'});
        
        // Games folder
        new Setting(containerEl)
            .setName('Games folder')
            .setDesc('Folder where game files will be stored')
            .addText(text => text
                .setPlaceholder('Games')
                .setValue(this.plugin.settings.gamesFolder)
                .onChange(async (value) => {
                    this.plugin.settings.gamesFolder = value;
                    await this.plugin.saveSettings();
                }));

        // RAWG API Key
        new Setting(containerEl)
            .setName('RAWG API Key')
            .setDesc('API key for automatic game data from RAWG.io (provides game descriptions, genres, Steam detection)')
            .addText(text => text
                .setPlaceholder('Enter your RAWG API key')
                .setValue(this.plugin.settings.rawgApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.rawgApiKey = value;
                    await this.plugin.saveSettings();
                }))
            .addButton(button => button
                .setButtonText('Get API Key')
                .onClick(() => {
                    window.open('https://rawg.io/apidocs', '_blank');
                }));
    }

    private getEnabledPCStores(): string[] {
        // Get stores that are currently enabled on existing PC devices
        const pcDevices = this.plugin.settings.userDevices.filter(d => 
            d.platforms.some(p => ['PC', 'Windows', 'Mac', 'Linux', 'SteamOS'].includes(p))
        );
        
        if (pcDevices.length === 0) {
            // No existing PC devices - use minimal default
            return ['Steam'];
        }
        
        // Get stores that are enabled on existing PC devices
        const enabledStores = new Set<string>();
        pcDevices.forEach(device => {
            device.platforms.forEach(platform => {
                if (['PC', 'Windows', 'Mac', 'Linux', 'SteamOS'].includes(platform)) {
                    if (device.platformStores[platform]) {
                        device.platformStores[platform].forEach(store => enabledStores.add(store));
                    }
                }
            });
        });
        
        return Array.from(enabledStores);
    }
    
    private addPlatformSettings(containerEl: HTMLElement) {
        
        // Only show platform toggles in basic mode
        if (!this.plugin.settings.showAdvancedDeviceSettings) {
            containerEl.createEl('h3', {text: '🎮 Platforms'});
            this.addSimplePlatformSettings(containerEl);
        }

        // Show advanced device management if enabled
        if (this.plugin.settings.showAdvancedDeviceSettings) {
            this.addAdvancedDeviceManagement(containerEl);
        }

                const spacer = containerEl.createDiv();
            spacer.style.cssText = `
            height: 20px;
        `;

        // Advanced Device Management toggle - but don't put conditional content here
        const advancedDeviceManagementSetting = new Setting(containerEl)
            .setName('Advanced Device Management')
            .setDesc('Show detailed device settings, custom stores, and subscription management')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showAdvancedDeviceSettings || false)
                .onChange(async (value) => {
                    this.plugin.settings.showAdvancedDeviceSettings = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        // Style the setting name to make it more distinct
        const settingEl = advancedDeviceManagementSetting.settingEl;
        const nameEl = settingEl.querySelector('.setting-item-name') as HTMLElement;
        if (nameEl) {
            nameEl.style.cssText = `
                font-weight: 600;
                color: var(--text-accent);
                font-size: 1.05em;
            `;
        }

        // Always show PC store management (regardless of mode)
        this.addPCStoreManagement(containerEl);
    }

    private addSimplePlatformSettings(containerEl: HTMLElement) {
        const descEl = containerEl.createEl('p', { cls: 'setting-item-description' });
        descEl.innerHTML = `
            Select the platforms you game on. Each platform will have a default device created automatically.
            Enable <strong>Advanced Device Management</strong> below to customize devices and stores in detail.
        `;

        // Main platform checkboxes - these now create/remove devices immediately
        const platforms = [
            { key: 'PC', label: this.getSmartPlatformLabel() },
            { key: 'PlayStation', label: 'PlayStation' },
            { key: 'Xbox', label: 'Xbox' },
            { key: 'Nintendo', label: 'Nintendo' }
        ];
        
        platforms.forEach(platform => {
            const platformKey = typeof platform === 'string' ? platform : platform.key;
            const platformLabel = typeof platform === 'string' ? platform : platform.label;
            const hasDevicesForPlatform = this.plugin.hasPlatform(platformKey);
            
            new Setting(containerEl)
                .setName(platformLabel)
                .addToggle(toggle => toggle
                    .setValue(hasDevicesForPlatform)
                    .onChange(async (value) => {
                        if (value) {
                            await this.createDefaultDeviceForPlatform(platformKey);
                        } else {
                            await this.removeDevicesForPlatform(platformKey);
                        }
                        this.display();
                    }));
        });

    }

    private addAdvancedDeviceManagement(containerEl: HTMLElement) {
        containerEl.createEl('h3', {text: '🎮 Your Gaming Devices'});

        // Description with Add Device button
        const descContainer = containerEl.createDiv('desc-with-button-container');
        descContainer.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 15px;
        `;

        const descEl = descContainer.createEl('p', { cls: 'setting-item-description' });
        descEl.innerHTML = `
            Manage your gaming devices individually with detailed store and subscription settings.
        `;
        descEl.style.cssText = `
            margin: 0;
            flex: 1;
            margin-right: 15px;
        `;

        // Add Device button alongside description
        const addDeviceButton = descContainer.createEl('button', { text: 'Add Device' });
        addDeviceButton.style.cssText = `
            padding: 8px 16px;
            background: var(--interactive-accent);
            color: var(--text-on-accent);
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
            font-size: 0.9em;
            transition: opacity 0.2s;
            flex-shrink: 0;
        `;
        addDeviceButton.onmouseenter = () => addDeviceButton.style.opacity = '0.8';
        addDeviceButton.onmouseleave = () => addDeviceButton.style.opacity = '1';
        addDeviceButton.onclick = () => this.openAddDeviceModal();
        
        // Current devices list
        if (this.plugin.settings.userDevices.length > 0) {
            const devicesContainer = containerEl.createDiv('devices-container');
            devicesContainer.style.cssText = `
                display: grid;
                gap: 12px;
                margin: 15px 0;
            `;
            
            this.plugin.settings.userDevices.forEach((device, index) => {
                this.createDeviceCard(devicesContainer, device, index);
            });
        }
        
        // Add devices section
        const headerContainer = containerEl.createDiv('devices-header-container');
        headerContainer.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        `;

        containerEl.createEl('hr', { attr: { style: 'margin: 12px 0 8px 0;' } });

        containerEl.createEl('p', {
            text: 'Quickly add a console with default settings.',
            cls: 'setting-item-description'
        });

        const quickAddContainer = containerEl.createDiv('quick-add-container');
        quickAddContainer.style.cssText = `
            display: flex;
            gap: 8px;
            margin: 15px 0;
            flex-wrap: wrap;
        `;

        // Console quick-add buttons (smaller, secondary style)
        const ps5Button = quickAddContainer.createEl('button', { text: 'Add PlayStation 5' });
        ps5Button.style.cssText = `
            padding: 8px 12px;
            background: var(--background-secondary);
            color: var(--text-normal);
            border: 1px solid var(--background-modifier-border);
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.85em;
            transition: all 0.2s;
        `;
        ps5Button.onmouseenter = () => {
            ps5Button.style.background = 'var(--background-modifier-hover)';
            ps5Button.style.borderColor = 'var(--interactive-accent)';
        };
        ps5Button.onmouseleave = () => {
            ps5Button.style.background = 'var(--background-secondary)';
            ps5Button.style.borderColor = 'var(--background-modifier-border)';
        };
        ps5Button.onclick = () => this.createQuickDevice('ps5');

        const xboxButton = quickAddContainer.createEl('button', { text: 'Add Xbox Series X' });
        xboxButton.style.cssText = `
            padding: 8px 12px;
            background: var(--background-secondary);
            color: var(--text-normal);
            border: 1px solid var(--background-modifier-border);
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.85em;
            transition: all 0.2s;
        `;
        xboxButton.onmouseenter = () => {
            xboxButton.style.background = 'var(--background-modifier-hover)';
            xboxButton.style.borderColor = 'var(--interactive-accent)';
        };
        xboxButton.onmouseleave = () => {
            xboxButton.style.background = 'var(--background-secondary)';
            xboxButton.style.borderColor = 'var(--background-modifier-border)';
        };
        xboxButton.onclick = () => this.createQuickDevice('xbox');

        const switchButton = quickAddContainer.createEl('button', { text: 'Add Nintendo Switch 2' });
        switchButton.style.cssText = `
            padding: 8px 12px;
            background: var(--background-secondary);
            color: var(--text-normal);
            border: 1px solid var(--background-modifier-border);
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.85em;
            transition: all 0.2s;
        `;
        switchButton.onmouseenter = () => {
            switchButton.style.background = 'var(--background-modifier-hover)';
            switchButton.style.borderColor = 'var(--interactive-accent)';
        };
        switchButton.onmouseleave = () => {
            switchButton.style.background = 'var(--background-secondary)';
            switchButton.style.borderColor = 'var(--background-modifier-border)';
        };
        switchButton.onclick = () => this.createQuickDevice('switch');

        const gamingPCButton = quickAddContainer.createEl('button', { text: 'Add Gaming PC' });
        gamingPCButton.style.cssText = `
            padding: 8px 12px;
            background: var(--background-secondary);
            color: var(--text-normal);
            border: 1px solid var(--background-modifier-border);
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.85em;
            transition: all 0.2s;
        `;
        gamingPCButton.onmouseenter = () => {
            gamingPCButton.style.background = 'var(--background-modifier-hover)';
            gamingPCButton.style.borderColor = 'var(--interactive-accent)';
        };
        gamingPCButton.onmouseleave = () => {
            gamingPCButton.style.background = 'var(--background-secondary)';
            gamingPCButton.style.borderColor = 'var(--background-modifier-border)';
        };
        gamingPCButton.onclick = () => this.createQuickDevice('pc');

        const steamDeckButton = quickAddContainer.createEl('button', { text: 'Add Steam Deck' });
        steamDeckButton.style.cssText = `
            padding: 8px 12px;
            background: var(--background-secondary);
            color: var(--text-normal);
            border: 1px solid var(--background-modifier-border);
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.85em;
            transition: all 0.2s;
        `;
        steamDeckButton.onmouseenter = () => {
            steamDeckButton.style.background = 'var(--background-modifier-hover)';
            steamDeckButton.style.borderColor = 'var(--interactive-accent)';
        };
        steamDeckButton.onmouseleave = () => {
            steamDeckButton.style.background = 'var(--background-secondary)';
            steamDeckButton.style.borderColor = 'var(--background-modifier-border)';
        };
        steamDeckButton.onclick = () => this.createQuickDevice('steamdeck');
    }

    private async createDefaultDeviceForPlatform(platform: string) {
        const platformConfigs: Record<string, {name: string, type: DeviceType, platforms: string[], stores: string[], subscriptions: string[]}> = {
            'PC': { 
                name: 'Gaming PC', 
                type: 'computer', 
                platforms: ['Windows'],
                stores: this.getEnabledPCStores(),
                subscriptions: ['PC Game Pass', 'EA Play','Ubisoft+'].filter(sub => 
                    this.plugin.settings.enabledSubscriptions[sub] === true
                )
            },
            'PlayStation': { 
                name: 'PlayStation 5', 
                type: 'console', 
                platforms: ['PlayStation'],
                stores: ['PlayStation Store'],
                subscriptions: ['PlayStation Plus', 'EA Play', 'Ubisoft+'].filter(sub => 
                    this.plugin.settings.enabledSubscriptions[sub] === true
                )
            },
            'Xbox': { 
                name: 'Xbox Series X|S', 
                type: 'console', 
                platforms: ['Xbox'],
                stores: ['Xbox Store'],
                subscriptions: ['Xbox Game Pass', 'EA Play', 'Ubisoft+'].filter(sub => 
                    this.plugin.settings.enabledSubscriptions[sub] === true
                )
            },
            'Nintendo': { 
                name: 'Nintendo Switch', 
                type: 'console', 
                platforms: ['Nintendo'],
                stores: ['Nintendo eShop'],
                subscriptions: ['Nintendo Switch Online'].filter(sub => 
                    this.plugin.settings.enabledSubscriptions[sub] === true
                )
            }
        };
        
        const config = platformConfigs[platform];
        if (!config) return null;
        
        // Create device with proper platform stores structure
        const platformStores: Record<string, string[]> = {};
        const platformSubscriptions: Record<string, string[]> = {};
        
        config.platforms.forEach(platformName => {
            platformStores[platformName] = [...config.stores];
            platformSubscriptions[platformName] = [...config.subscriptions];
        });
        
        const newDevice: UserDevice = {
            id: `default-${platform.toLowerCase()}-${Date.now()}`,
            name: config.name,
            type: config.type,
            platforms: config.platforms,
            platformStores: platformStores,
            platformSubscriptions: platformSubscriptions,
            isDefault: !this.plugin.settings.userDevices.some(d => 
                d.platforms.some(p => config.platforms.includes(p)) && d.isDefault
            ),
            isAutoGenerated: true
        };
        
        this.plugin.settings.userDevices.push(newDevice);
        await this.plugin.saveSettings();
        
        new Notice(`✅ Added ${newDevice.name}!`);
        return newDevice;
    }

    private async removeDevicesForPlatform(platform: string): Promise<boolean> {
        let devicesForPlatform;
        
        if (platform === 'PC') {
            devicesForPlatform = this.plugin.settings.userDevices.filter(d => 
                d.platforms.some(p => ['PC', 'Windows', 'Mac', 'Linux', 'SteamOS'].includes(p))
            );
        } else {
            devicesForPlatform = this.plugin.settings.userDevices.filter(d => 
                d.platforms.includes(platform)
            );
        }
        
        if (devicesForPlatform.length === 0) return false;
        
        const deviceNames = devicesForPlatform.map(d => d.name).join(', ');
        const confirmed = confirm(`Remove all ${platform} devices (${deviceNames})? This cannot be undone.`);
        
        if (!confirmed) return false;
        
        if (platform === 'PC') {
            this.plugin.settings.userDevices = this.plugin.settings.userDevices.filter(d => 
                !d.platforms.some(p => ['PC', 'Windows', 'Mac', 'Linux', 'SteamOS'].includes(p))
            );
        } else {
            this.plugin.settings.userDevices = this.plugin.settings.userDevices.filter(d => 
                !d.platforms.includes(platform)
            );
        }
        
        await this.plugin.saveSettings();
        new Notice(`🗑️ Removed all ${platform} devices`);
        return true;
    }
    
    private createDeviceCard(container: HTMLElement, device: UserDevice, index: number) {
        const deviceCard = container.createDiv('device-card');
        deviceCard.style.cssText = `
            padding: 15px;
            background: var(--background-secondary);
            border: 1px solid var(--background-modifier-border);
            border-radius: 8px;
            position: relative;
        `;
        
        // Device header with icon and name
        const deviceHeader = deviceCard.createDiv('device-header');
        deviceHeader.style.cssText = `
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 12px;
        `;
        
        // Device icon
        const iconContainer = deviceHeader.createSpan();
        iconContainer.style.cssText = `
            display: flex;
            align-items: center;
            width: 20px;
            height: 20px;
        `;
        setIcon(iconContainer, this.getDeviceIcon(device.type));
        
        // Device name and platform
        const deviceInfo = deviceHeader.createDiv();
        const deviceName = deviceInfo.createEl('strong', { text: device.name });
        if (device.isDefault) {
            deviceName.style.color = 'var(--text-accent)';
        }
        
        const deviceMeta = deviceInfo.createDiv();
        deviceMeta.style.cssText = `
            font-size: 0.85em;
            color: var(--text-muted);
        `;
        deviceMeta.textContent = `${device.platforms.join('/')} ${device.type}${device.isAutoGenerated ? ' (auto-generated)' : ''}`;
        
        // Device details
        const deviceDetails = deviceCard.createDiv('device-details');
        deviceDetails.style.cssText = `
            font-size: 0.9em;
            line-height: 1.4;
        `;

        // Platforms
        if (device.platforms.length > 0) {
            const platformsLine = deviceDetails.createDiv();
            platformsLine.innerHTML = `<strong>Platforms:</strong> ${device.platforms.join(', ')}`;
        }

        // Stores (combine all platforms)
        const allStores = new Set<string>();
        Object.values(device.platformStores).forEach(stores => {
            stores.forEach(store => allStores.add(store));
        });

        if (allStores.size > 0) {
            const storesLine = deviceDetails.createDiv();
            storesLine.innerHTML = `<strong>Stores:</strong> ${Array.from(allStores).join(', ')}`;
        }

        // Subscriptions (combine all platforms)
        const allSubscriptions = new Set<string>();
        Object.values(device.platformSubscriptions).forEach(subs => {
            subs.forEach(sub => allSubscriptions.add(sub));
        });

        if (allSubscriptions.size > 0) {
            const subsLine = deviceDetails.createDiv();
            subsLine.innerHTML = `<strong>Subscriptions:</strong> ${Array.from(allSubscriptions).join(', ')}`;
        }
        
        // Actions
        const deviceActions = deviceCard.createDiv('device-actions');
        deviceActions.style.cssText = `
            display: flex;
            gap: 8px;
            margin-top: 12px;
            justify-content: flex-end;
        `;
        
        // Edit button
        const editButton = deviceActions.createEl('button', { text: 'Edit' });
        editButton.style.cssText = `
            padding: 4px 8px;
            font-size: 0.8em;
            cursor: pointer;
        `;
        editButton.onclick = () => {
            this.openEditDeviceModal(device, index);
        };
        
        // Remove button (don't allow removing the last device)
        if (this.plugin.settings.userDevices.length > 1) {
            const removeButton = deviceActions.createEl('button', { text: 'Remove' });
            removeButton.style.cssText = `
                padding: 4px 8px;
                font-size: 0.8em;
                color: var(--text-error);
                cursor: pointer;
            `;
            removeButton.onclick = async () => {
                const confirmed = confirm(`Remove ${device.name}? This cannot be undone.`);
                if (confirmed) {
                    await this.plugin.removeDevice(device.id);
                    this.display(); // Refresh the settings
                }
            };
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

    private openAddDeviceModal() {
        new AddDeviceModal(this.app, this.plugin, () => {
            this.display(); // Refresh after adding device
        }).open();
    }

    private openEditDeviceModal(device: UserDevice, index: number) {
        new EditDeviceModal(this.app, this.plugin, device, index, () => {
            this.display(); // Refresh after editing device
        }).open();
    }

    private addPCStoreManagement(containerEl: HTMLElement) {
        // Only show if there are PC devices OR we're in advanced mode (so users can pre-configure stores)
        const pcDevices = this.plugin.settings.userDevices.filter(d => 
            d.platforms.some(p => ['PC', 'Windows', 'Mac', 'Linux', 'SteamOS'].includes(p))
        );
                
        // Don't show this section if no PC devices and not in advanced mode
        if (pcDevices.length === 0 && !this.plugin.settings.showAdvancedDeviceSettings) {
            return;
        }
        
        containerEl.createEl('h4', {text: '🖥️ Manage PC Stores'});
        containerEl.createEl('p', {
            text: 'Drag and drop to reorder PC stores. Changes will sync to all PC devices.',
            cls: 'setting-item-description'
        });

        // Get current PC stores - use defaults if no devices exist
        let currentPCStores: string[];
        if (pcDevices.length > 0) {
            // Get all stores from all PC platforms
            const allPCStores = new Set<string>();
            pcDevices.forEach(device => {
                device.platforms.forEach(platform => {
                    if (['PC', 'Windows', 'Mac', 'Linux', 'SteamOS'].includes(platform)) {
                        if (device.platformStores[platform]) {
                            device.platformStores[platform].forEach(store => allPCStores.add(store));
                        }
                    }
                });
            });
            currentPCStores = Array.from(allPCStores);
        } else {
            // Use default PC stores when no devices exist
            currentPCStores = ['Steam']; // Match the device creation default
        }
        
        // Ensure we always have some default stores
        if (currentPCStores.length === 0) {
            currentPCStores = ['Steam']; // Match the device creation default
        }
        
        // Current PC stores with drag-and-drop reordering
        const enabledContainer = containerEl.createDiv('pc-stores-container');
        enabledContainer.createEl('h5', { text: 'Available PC Stores:' });
        
        const storesListContainer = enabledContainer.createDiv('stores-list-container');
        storesListContainer.style.cssText = `
            border: 1px solid var(--background-modifier-border);
            border-radius: 6px;
            background: var(--background-primary);
            padding: 8px;
            margin: 10px 0;
        `;
        
        this.createDraggableStoresList(storesListContainer, currentPCStores);
        
        // Add new stores section
        this.addNewPCStoreSection(containerEl);
    }

    private createDraggableStoresList(container: HTMLElement, stores: string[]) {
        container.empty();
        
        stores.forEach((store, index) => {
            const storeItem = container.createDiv('store-item');
            storeItem.setAttribute('data-store-index', index.toString());
            storeItem.setAttribute('data-store-name', store);
            storeItem.draggable = true;
            storeItem.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 12px;
                margin: 4px 0;
                background: var(--background-secondary);
                border-radius: 6px;
                cursor: grab;
                transition: all 0.2s ease;
                border: 2px solid transparent;
            `;
            
            // Store info with drag handle
            const storeInfo = storeItem.createDiv();
            storeInfo.style.cssText = `
                display: flex;
                align-items: center;
                gap: 8px;
                flex: 1;
            `;
            
            const dragHandle = storeInfo.createSpan();
            dragHandle.textContent = '⋮⋮';
            dragHandle.style.cssText = `
                color: var(--text-muted);
                font-size: 1.2em;
                cursor: grab;
            `;
            
            const storeText = storeInfo.createSpan();
            storeText.textContent = `${index + 1}. ${store}`;
            
            // Remove button
            const removeButton = storeItem.createEl('button', { text: 'Remove' });
            removeButton.style.cssText = `
                font-size: 0.8em;
                color: var(--text-error);
                padding: 4px 8px;
                cursor: pointer;
            `;
            removeButton.title = `Remove ${store}`;
            removeButton.onclick = async (e) => {
                e.stopPropagation();
                const confirmed = confirm(`Remove ${store} from all PC devices? This cannot be undone.`);
                if (confirmed) {
                    await this.removeStoreFromAllPCDevices(store);
                    this.display();
                }
            };
            
            // Drag and drop event handlers
            storeItem.addEventListener('dragstart', (e) => {
                storeItem.style.opacity = '0.5';
                storeItem.style.cursor = 'grabbing';
                dragHandle.style.cursor = 'grabbing';
                e.dataTransfer?.setData('text/plain', index.toString());
            });
            
            storeItem.addEventListener('dragend', () => {
                storeItem.style.opacity = '1';
                storeItem.style.cursor = 'grab';
                dragHandle.style.cursor = 'grab';
                storeItem.style.borderColor = 'transparent';
            });
            
            storeItem.addEventListener('dragover', (e) => {
                e.preventDefault();
                storeItem.style.borderColor = 'var(--interactive-accent)';
            });
            
            storeItem.addEventListener('dragleave', () => {
                storeItem.style.borderColor = 'transparent';
            });
            
            storeItem.addEventListener('drop', async (e) => {
                e.preventDefault();
                storeItem.style.borderColor = 'transparent';
                
                const draggedIndex = parseInt(e.dataTransfer?.getData('text/plain') || '-1');
                const targetIndex = index;
                
                if (draggedIndex !== -1 && draggedIndex !== targetIndex) {
                    await this.reorderPCStore(draggedIndex, targetIndex);
                    this.display();
                }
            });
            
            // Hover effects
            storeItem.addEventListener('mouseenter', () => {
                if (!storeItem.style.opacity || storeItem.style.opacity === '1') {
                    storeItem.style.background = 'var(--background-modifier-hover)';
                }
            });
            
            storeItem.addEventListener('mouseleave', () => {
                if (!storeItem.style.opacity || storeItem.style.opacity === '1') {
                    storeItem.style.background = 'var(--background-secondary)';
                }
            });
        });
        
        // Add instructions if there are multiple stores
        if (stores.length > 1) {
            const instructions = container.createDiv('drag-instructions');
            instructions.style.cssText = `
                text-align: center;
                font-size: 0.8em;
                color: var(--text-muted);
                margin-top: 8px;
                font-style: italic;
            `;
            instructions.textContent = 'Drag and drop to reorder stores';
        }
    }

    // Add this method to handle adding new PC stores
    private addNewPCStoreSection(containerEl: HTMLElement) {
        const addStoreContainer = containerEl.createDiv('add-pc-store-container');
        addStoreContainer.createEl('h5', { text: 'Add PC Stores:' });
        
        // Get current stores to filter out
        const pcDevices = this.plugin.settings.userDevices.filter(d => 
            d.platforms.some(p => ['PC', 'Windows', 'Mac', 'Linux', 'SteamOS'].includes(p))
        );
        const currentStores = Array.from(new Set(
            pcDevices.flatMap(device => 
                device.platforms
                    .filter(p => ['PC', 'Windows', 'Mac', 'Linux', 'SteamOS'].includes(p))
                    .flatMap(platform => device.platformStores[platform] || [])
            )
        ));
        
        // Predefined stores that are compatible with at least one PC device and not already added
        const allPredefinedStores = [
            'Steam', 'Epic Games Store', 'GOG', 'Xbox App', 
            'Origin/EA App', 'Ubisoft Connect', 'Battle.net', 'Humble Store', 'Itch.io'
        ];
        
        const availableStores = allPredefinedStores.filter(store => {
            // Must not already be in current stores
            if (currentStores.includes(store)) return false;
            
            // Must be compatible with at least one PC device
            return pcDevices.some((device: UserDevice) =>
                device.platforms.some((platform: string) => this.plugin.isStoreCompatible(store, platform))
            );
        });
        
        if (availableStores.length > 0) {
            const predefinedContainer = addStoreContainer.createDiv('predefined-stores');
            predefinedContainer.createEl('p', {
                text: 'Quick add popular stores:',
                cls: 'setting-item-description'
            });
            
            const storeButtons = predefinedContainer.createDiv();
            storeButtons.style.cssText = `
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-bottom: 15px;
            `;
            
            availableStores.forEach(store => {
                const addButton = storeButtons.createEl('button', { text: `+ ${store}` });
                addButton.style.cssText = `
                    padding: 6px 12px;
                    font-size: 0.85em;
                    background: var(--interactive-accent);
                    color: var(--text-on-accent);
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    transition: opacity 0.2s;
                `;
                addButton.onmouseenter = () => addButton.style.opacity = '0.8';
                addButton.onmouseleave = () => addButton.style.opacity = '1';
                addButton.onclick = async () => {
                    await this.addStoreToAllPCDevices(store);
                    new Notice(`✅ Added ${store} to all PC devices`);
                    this.display();
                };
            });
        }
        
        // Custom store input
        let customStoreName = '';
        new Setting(addStoreContainer)
            .setName('Add Custom Store')
            .setDesc('Add a store not in our predefined list')
            .addText(text => text
                .setPlaceholder('e.g., IndieGameDev Store, Company Store')
                .onChange(value => {
                    customStoreName = value;
                }))
            .addButton(button => button
                .setButtonText('Add')
                .setCta()
                .onClick(async () => {
                    if (customStoreName.trim()) {
                        const trimmedName = customStoreName.trim();
                        const currentStores = Array.from(new Set(
                            this.plugin.settings.userDevices
                                .filter(d => d.platforms.some(p => ['PC', 'Windows', 'Mac', 'Linux', 'SteamOS'].includes(p)))
                                .flatMap(device => 
                                    device.platforms
                                        .filter(p => ['PC', 'Windows', 'Mac', 'Linux', 'SteamOS'].includes(p))
                                        .flatMap(platform => device.platformStores[platform] || [])
                                )
                        ));
                        
                        if (!currentStores.includes(trimmedName)) {
                            await this.addStoreToAllPCDevices(trimmedName);
                            new Notice(`✅ Added ${trimmedName} to all PC devices`);
                            this.display();
                        } else {
                            new Notice(`${trimmedName} is already in your store list`);
                        }
                    }
                }));
    }

    // Helper methods for PC store operations

    private async addStoreToAllPCDevices(store: string) {
        let hasUpdates = false;
        const incompatibleDevices: string[] = [];
        
        // Get all devices that have PC platforms
        const targetDevices = this.plugin.settings.userDevices.filter(device => 
            device.platforms.some(p => ['PC', 'Windows', 'Mac', 'Linux', 'SteamOS'].includes(p))
        );
        
        targetDevices.forEach(device => {
            device.platforms.forEach(platform => {
                if (['PC', 'Windows', 'Mac', 'Linux', 'SteamOS'].includes(platform)) {
                    // Check compatibility before adding
                    if (this.plugin.isStoreCompatible(store, platform)) {
                        if (!device.platformStores[platform]) {
                            device.platformStores[platform] = [];
                        }
                        if (!device.platformStores[platform].includes(store)) {
                            device.platformStores[platform].push(store);
                            hasUpdates = true;
                        }
                    } else {
                        incompatibleDevices.push(`${device.name} (${platform})`);
                    }
                }
            });
        });
        
        if (hasUpdates) {
            await this.plugin.saveSettings();
        }
        
        // Show feedback about incompatible devices
        if (incompatibleDevices.length > 0) {
            new Notice(`⚠️ ${store} not compatible with: ${incompatibleDevices.join(', ')}`);
        }
    }

    private async removeStoreFromAllPCDevices(store: string) {
        let hasUpdates = false;
        
        this.plugin.settings.userDevices.forEach(device => {
            device.platforms.forEach(platform => {
                if (['PC', 'Windows', 'Mac', 'Linux', 'SteamOS'].includes(platform)) {
                    if (device.platformStores[platform]) {
                        const oldLength = device.platformStores[platform].length;
                        device.platformStores[platform] = device.platformStores[platform].filter(s => s !== store);
                        
                        if (device.platformStores[platform].length !== oldLength) {
                            hasUpdates = true;
                        }
                    }
                }
            });
        });
        
        if (hasUpdates) {
            await this.plugin.saveSettings();
            new Notice(`🗑️ Removed ${store} from all PC devices`);
        }
    }

    private async reorderPCStore(fromIndex: number, toIndex: number) {
        const pcDevicesForReorder = this.plugin.settings.userDevices.filter(d =>
            d.platforms.some(p => ['PC', 'Windows', 'Mac', 'Linux', 'SteamOS'].includes(p))
        );
        
        pcDevicesForReorder.forEach((device: UserDevice) => {
            device.platforms.forEach((platform: string) => {
                if (['PC', 'Windows', 'Mac', 'Linux', 'SteamOS'].includes(platform) && device.platformStores[platform]) {
                    // Reorder the stores array
                    const stores = [...device.platformStores[platform]];
                    const [movedStore] = stores.splice(fromIndex, 1);
                    stores.splice(toIndex, 0, movedStore);
                    device.platformStores[platform] = stores;
                }
            });
        });
        
        await this.plugin.saveSettings();
    }

    private addSubscriptionSettings(containerEl: HTMLElement) {
        containerEl.createEl('h3', {text: '📺 Subscription Services'});
        
        // Get available subscriptions based on user devices
        const availableSubscriptions = this.getAvailableSubscriptionsFromDevices();
        
        if (availableSubscriptions.length === 0) {
            const noSubsContainer = containerEl.createDiv('no-subscriptions-container');
            noSubsContainer.style.cssText = `
                padding: 20px;
                text-align: center;
                background: var(--background-secondary);
                border-radius: 8px;
                margin: 15px 0;
            `;
            
            noSubsContainer.createEl('p', {
                text: '🎮 No subscription services available for your current devices.',
                cls: 'setting-item-description'
            });
            
            noSubsContainer.createEl('p', {
                text: 'Add gaming devices above to see relevant subscription options.',
                cls: 'setting-item-description'
            });
            
            return;
        }

        const descEl = containerEl.createEl('p', { cls: 'setting-item-description' });
        descEl.innerHTML = `
            Enable subscription services available on your devices. 
            ${availableSubscriptions.length < this.getAllPossibleSubscriptions().length ? 
                `<br><em>Some services are hidden because you don't have compatible devices.</em>` : 
                ''}
        `;

        // Group subscriptions by category for better organization
        const groupedSubscriptions = this.groupSubscriptionsByCategory(availableSubscriptions);
        
        Object.entries(groupedSubscriptions).forEach(([category, subscriptions]) => {
            if (subscriptions.length === 0) return;
            
            // Add category header if we have multiple categories
            if (Object.keys(groupedSubscriptions).length > 1) {
                containerEl.createEl('h4', { 
                    text: category,
                    attr: { style: 'margin-top: 20px; margin-bottom: 10px; color: var(--text-muted); font-size: 1em;' }
                });
            }
            
            subscriptions.forEach(service => {
                // Show which devices support this subscription
                const supportingDevices = this.getDevicesSupportingSubscription(service.key);
                const deviceNames = supportingDevices.map(d => d.name).join(', ');
                
                new Setting(containerEl)
                    .setName(service.name)
                    .setDesc(`${service.desc} • Available on: ${deviceNames}`)
                    .addToggle(toggle => toggle
                        .setValue(this.plugin.settings.enabledSubscriptions[service.key] || false)
                        .onChange(async (value) => {
                            this.plugin.settings.enabledSubscriptions[service.key] = value;
                            await this.plugin.saveSettings();
                            
                            // Update device subscriptions when global settings change
                            await this.plugin.updateDeviceSubscriptions();
                            
                            // Refresh the device display to show updated subscriptions
                            if (this.plugin.settings.showAdvancedDeviceSettings) {
                                this.display();
                            }
                        }));
            });
        });
    }

    private getAvailableSubscriptionsFromDevices(): Array<{key: string, name: string, desc: string}> {
        const allSubscriptions = this.getAllPossibleSubscriptions();
        const userDevices = this.plugin.settings.userDevices;
        
        // Get all subscriptions that are available on at least one user device
        return allSubscriptions.filter(subscription => {
            return userDevices.some(device => {
                return device.platforms.some(platform => {
                    const platformSubscriptions = this.getPlatformSubscriptions(platform);
                    return platformSubscriptions.includes(subscription.key);
                });
            });
        });
    }

    private getAllPossibleSubscriptions(): Array<{key: string, name: string, desc: string, category: string}> {
        return [
            // PC Gaming
            { key: 'PC Game Pass', name: 'PC Game Pass', desc: 'Microsoft Game Pass for PC', category: 'PC Gaming' },
            { key: 'EA Play', name: 'EA Play', desc: 'Electronic Arts subscription service', category: 'Multi-Platform' },
            { key: 'Ubisoft+', name: 'Ubisoft+', desc: 'Ubisoft\'s subscription service', category: 'Multi-Platform' },
            
            // Console Gaming
            { key: 'Xbox Game Pass', name: 'Xbox Game Pass', desc: 'Microsoft Game Pass for Xbox consoles', category: 'Console Gaming' },
            { key: 'PlayStation Plus', name: 'PlayStation Plus', desc: 'Sony PlayStation Plus subscription', category: 'Console Gaming' },
            { key: 'Nintendo Switch Online', name: 'Nintendo Switch Online', desc: 'Nintendo\'s online service', category: 'Console Gaming' },
            
            // Mobile Gaming
            { key: 'Apple Arcade', name: 'Apple Arcade', desc: 'Apple\'s gaming subscription service', category: 'Mobile Gaming' }
        ];
    }

    private groupSubscriptionsByCategory(subscriptions: Array<{key: string, name: string, desc: string}>): Record<string, Array<{key: string, name: string, desc: string}>> {
        const allSubs = this.getAllPossibleSubscriptions();
        const grouped: Record<string, Array<{key: string, name: string, desc: string}>> = {
            'PC Gaming': [],
            'Console Gaming': [],
            'Mobile Gaming': [],
            'Multi-Platform': []
        };
        
        subscriptions.forEach(sub => {
            const fullSub = allSubs.find(s => s.key === sub.key);
            if (fullSub) {
                grouped[fullSub.category].push(sub);
            }
        });
        
        // Remove empty categories
        Object.keys(grouped).forEach(category => {
            if (grouped[category].length === 0) {
                delete grouped[category];
            }
        });
        
        return grouped;
    }

    private getPlatformSubscriptions(platform: string): string[] {
        const platformSubMap: Record<string, string[]> = {
            'Windows': ['PC Game Pass', 'EA Play', 'Ubisoft+'],
            'Mac': ['Apple Arcade'],
            'Linux': [],
            'SteamOS': [],
            'PlayStation': ['PlayStation Plus', 'EA Play', 'Ubisoft+'],
            'Xbox': ['Xbox Game Pass', 'EA Play', 'Ubisoft+'],
            'Nintendo': ['Nintendo Switch Online'],
            'iOS': ['Apple Arcade'],
            'Android': [],
            'Retro': [],
            'Emulation': [],
            'Other': []
        };
        
        return platformSubMap[platform] || [];
    }

    private getDevicesSupportingSubscription(subscriptionKey: string): UserDevice[] {
        return this.plugin.settings.userDevices.filter(device => {
            return device.platforms.some(platform => {
                const platformSubs = this.getPlatformSubscriptions(platform);
                return platformSubs.includes(subscriptionKey);
            });
        });
    }
}

// Modal for adding new devices
class AddDeviceModal extends Modal {
    private plugin: GameLogPlugin;
    private onSave: () => void;
    
    // State tracking for the multi-step flow
    private currentStep: 'category' | 'platform' | 'device' | 'naming' = 'category';
    private selectedCategory = '';
    private selectedPlatform = '';
    private selectedDevice = '';
    private deviceName = '';
    private finalDeviceType: DeviceType = 'computer';
    private keyboardNav: KeyboardNavigationHelper | null = null;

    constructor(app: App, plugin: GameLogPlugin, onSave: () => void) {
        super(app);
        this.plugin = plugin;
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        
        modalEl.style.cssText = `
            max-width: 500px;
            width: 90vw;
            min-height: 400px;
        `;
        
        contentEl.empty();
        this.renderCurrentStep();
    }

    private renderCurrentStep() {
        const { contentEl } = this;
        contentEl.empty();
        
        switch (this.currentStep) {
            case 'category':
                this.renderCategorySelection();
                break;
            case 'platform':
                this.renderPlatformSelection();
                break;
            case 'device':
                this.renderDeviceSelection();
                break;
            case 'naming':
                this.renderDeviceNaming();
                break;
        }
    }

    private renderCategorySelection() {
        const { contentEl } = this;
        
        contentEl.createEl('h2', { text: 'Add New Device - Select Category' });
        contentEl.createEl('p', {
            text: 'What type of gaming device are you adding?',
            cls: 'setting-item-description'
        });

        const categoriesContainer = contentEl.createDiv('categories-container');
        categoriesContainer.style.cssText = `
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin: 20px 0;
        `;

        const categories = [
            { key: 'computer', name: 'Computer', icon: '🖥️', desc: 'Desktop PC, laptop, or workstation' },
            { key: 'console', name: 'Console', icon: '🎮', desc: 'PlayStation, Xbox, Nintendo' },
            { key: 'handheld', name: 'Handheld', icon: '📱', desc: 'Steam Deck, ROG Ally, portables' },
            { key: 'retro', name: 'Retro', icon: '🕹️', desc: 'Classic gaming systems' },
            { key: 'mobile', name: 'Mobile', icon: '📱', desc: 'Phone or tablet gaming' },
            { key: 'other', name: 'Other', icon: '⚙️', desc: 'Custom or unique setup' }
        ];
            
        const categoryCards: HTMLElement[] = [];

        categories.forEach(category => {
            const categoryCard = categoriesContainer.createDiv('category-card');
            categoryCard.style.cssText = `
                padding: 20px;
                border: 2px solid var(--background-modifier-border);
                border-radius: 8px;
                cursor: pointer;
                text-align: center;
                transition: all 0.2s ease;
                background: var(--background-primary);
            `;

            categoryCard.createEl('div', { 
                text: category.icon,
                attr: { style: 'font-size: 2.5em; margin-bottom: 10px;' }
            });
            
            categoryCard.createEl('h4', { 
                text: category.name,
                attr: { style: 'margin: 0 0 8px 0; color: var(--text-normal);' }
            });
            
            categoryCard.createEl('p', {
                text: category.desc,
                attr: { 
                    style: 'margin: 0; font-size: 0.9em; color: var(--text-muted); line-height: 1.3;'
                }
            });

            categoryCard.addEventListener('click', () => {
                this.selectedCategory = category.key;
                this.currentStep = 'platform';
                this.renderCurrentStep();
            });

            categoryCard.addEventListener('mouseenter', () => {
                categoryCard.style.borderColor = 'var(--interactive-accent)';
                categoryCard.style.background = 'var(--background-modifier-hover)';
            });

            categoryCard.addEventListener('mouseleave', () => {
                categoryCard.style.borderColor = 'var(--background-modifier-border)';
                categoryCard.style.background = 'var(--background-primary)';
            });

            categoryCards.push(categoryCard);
        });

        // Setup keyboard navigation
        this.keyboardNav = new KeyboardNavigationHelper(categoriesContainer);
        categoriesContainer.setAttribute('tabindex', '0');
        
        categoryCards.forEach((categoryCard, index) => {
            if (this.keyboardNav) {
                const category = categories[index];
                this.keyboardNav.addItem(categoryCard, () => {
                    this.selectedCategory = category.key;
                    this.currentStep = 'platform';
                    this.renderCurrentStep();
                });
            }
        });
        
        setTimeout(() => {
            categoriesContainer.focus();
        }, 50);

        this.addModalButtons(['Cancel'], ['cancel']);
    }

    private renderPlatformSelection() {
        const { contentEl } = this;
        
        contentEl.createEl('h2', { text: `Add New Device - Select Platform` });
        contentEl.createEl('p', {
            text: `Choose the platform for your ${this.selectedCategory} device:`,
            cls: 'setting-item-description'
        });

        const platformsContainer = contentEl.createDiv('platforms-container');
        platformsContainer.style.cssText = `
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 12px;
            margin: 20px 0;
        `;

        const platforms = this.getPlatformsForCategory(this.selectedCategory);
        
        platforms.forEach(platform => {
            const platformCard = platformsContainer.createDiv('platform-card');
            platformCard.style.cssText = `
                padding: 15px;
                border: 2px solid var(--background-modifier-border);
                border-radius: 8px;
                cursor: pointer;
                text-align: center;
                transition: all 0.2s ease;
                background: var(--background-primary);
            `;

            platformCard.createEl('div', { 
                text: platform.icon,
                attr: { style: 'font-size: 2em; margin-bottom: 8px;' }
            });
            
            platformCard.createEl('div', { 
                text: platform.name,
                attr: { style: 'font-weight: 500; color: var(--text-normal);' }
            });

            platformCard.addEventListener('click', () => {
                this.selectedPlatform = platform.key;
                this.finalDeviceType = platform.deviceType || 'computer';
                this.currentStep = 'device';
                this.renderCurrentStep();
            });

            platformCard.addEventListener('mouseenter', () => {
                platformCard.style.borderColor = 'var(--interactive-accent)';
                platformCard.style.background = 'var(--background-modifier-hover)';
            });

            platformCard.addEventListener('mouseleave', () => {
                platformCard.style.borderColor = 'var(--background-modifier-border)';
                platformCard.style.background = 'var(--background-primary)';
            });
        });

        this.addModalButtons(['Back', 'Cancel'], ['back', 'cancel']);
    }

    private renderDeviceSelection() {
        const { contentEl } = this;
        
        contentEl.createEl('h2', { text: 'Add New Device - Select Device' });
        contentEl.createEl('p', {
            text: `Choose your specific ${this.selectedPlatform} device:`,
            cls: 'setting-item-description'
        });

        const deviceContainer = contentEl.createDiv('device-container');
        deviceContainer.style.cssText = `
            margin: 20px 0;
        `;

        if (this.selectedCategory === 'computer') {
            // For computers, just use platform name as device
            this.selectedDevice = this.selectedPlatform;
            this.deviceName = this.selectedPlatform;
            this.currentStep = 'naming';
            this.renderCurrentStep();
            return;
        }

        if (this.selectedCategory === 'retro') {
            this.renderRetroSystemSelection(deviceContainer);
            return;
        }

        if (this.selectedCategory === 'other') {
            // For "other" category, go straight to naming with custom input
            this.selectedDevice = 'custom';
            this.deviceName = 'Custom Device';
            this.currentStep = 'naming';
            this.renderCurrentStep();
            return;
        }

        // Handle console, handheld, mobile with specific device lists
        const devices = this.getDevicesForPlatform(this.selectedCategory, this.selectedPlatform);
        
        if (devices.length === 0) {
            deviceContainer.createEl('p', {
                text: 'No specific devices found for this platform.',
                cls: 'setting-item-description'
            });
            this.addModalButtons(['Back', 'Cancel'], ['back', 'cancel']);
            return;
        }

        const devicesGrid = deviceContainer.createDiv('devices-grid');
        devicesGrid.style.cssText = `
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 12px;
            margin: 15px 0;
        `;

        devices.forEach(device => {
            const deviceCard = devicesGrid.createDiv('device-card');
            deviceCard.style.cssText = `
                padding: 15px;
                border: 2px solid var(--background-modifier-border);
                border-radius: 8px;
                cursor: pointer;
                text-align: center;
                transition: all 0.2s ease;
                background: var(--background-primary);
            `;

            deviceCard.createEl('div', { 
                text: '🎮',
                attr: { style: 'font-size: 1.8em; margin-bottom: 8px;' }
            });
            
            deviceCard.createEl('div', { 
                text: device.name,
                attr: { style: 'font-weight: 500; color: var(--text-normal);' }
            });

            deviceCard.addEventListener('click', () => {
                this.selectedDevice = device.key;
                this.deviceName = device.name;
                this.currentStep = 'naming';
                this.renderCurrentStep();
            });

            deviceCard.addEventListener('mouseenter', () => {
                deviceCard.style.borderColor = 'var(--interactive-accent)';
                deviceCard.style.background = 'var(--background-modifier-hover)';
            });

            deviceCard.addEventListener('mouseleave', () => {
                deviceCard.style.borderColor = 'var(--background-modifier-border)';
                deviceCard.style.background = 'var(--background-primary)';
            });
        });

        this.addModalButtons(['Back', 'Cancel'], ['back', 'cancel']);
    }

    private renderRetroSystemSelection(container: HTMLElement) {
        const retroSystems = this.getRetroSystems();
        
        // Grid for retro systems
        const retroGrid = container.createDiv('retro-grid');
        retroGrid.style.cssText = `
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 10px;
            max-height: 300px;
            overflow-y: auto;
            border: 1px solid var(--background-modifier-border);
            border-radius: 6px;
            padding: 10px;
        `;

        this.populateRetroGrid(retroGrid, retroSystems);
        
        // Custom system option
        const customContainer = container.createDiv('custom-retro-container');
        customContainer.style.cssText = `
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid var(--background-modifier-border);
        `;
        
        customContainer.createEl('p', {
            text: "Don't see your system? Add a custom retro device:",
            cls: 'setting-item-description'
        });
        
        const customButton = customContainer.createEl('button', { text: '+ Add Custom Retro System' });
        customButton.style.cssText = `
            padding: 8px 16px;
            background: var(--interactive-accent);
            color: var(--text-on-accent);
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
        `;
        customButton.onclick = () => {
            this.selectedDevice = 'custom-retro';
            this.deviceName = 'Custom Retro System';
            this.selectedPlatform = 'Retro'; // Set proper platform for retro devices
            this.currentStep = 'naming';
            this.renderCurrentStep();
        };

        this.addModalButtons(['Back', 'Cancel'], ['back', 'cancel']);
    }

        private populateRetroGrid(grid: HTMLElement, systems: Array<{key: string, name: string, manufacturer: string, platform: string}>) {
            grid.empty();
            
            // Filter systems by selected platform
            const filteredSystems = systems.filter(system => {
                switch (this.selectedPlatform) {
                    case 'Nintendo-Retro':
                        return system.manufacturer === 'Nintendo';
                    case 'Sega-Retro':
                        return system.manufacturer === 'Sega';
                    case 'Sony-Retro':
                        return system.manufacturer === 'Sony';
                    case 'Atari-Retro':
                        return system.manufacturer === 'Atari';
                    case 'Microsoft-Retro':
                        return system.manufacturer === 'Microsoft';
                    case 'Other-Retro':
                        return !['Nintendo', 'Sega', 'Sony', 'Atari', 'Microsoft'].includes(system.manufacturer);
                    default:
                        return true; // Show all if no specific platform selected
                }
            });
            
            filteredSystems.forEach(system => {
            const systemCard = grid.createDiv('retro-system-card');
            systemCard.style.cssText = `
                padding: 12px;
                border: 1px solid var(--background-modifier-border);
                border-radius: 6px;
                cursor: pointer;
                transition: all 0.2s ease;
                background: var(--background-primary);
            `;
            
            const systemName = systemCard.createDiv();
            systemName.textContent = system.name;
            systemName.style.cssText = `
                font-weight: 500;
                color: var(--text-normal);
                margin-bottom: 4px;
            `;
            
            const manufacturer = systemCard.createDiv();
            manufacturer.textContent = system.manufacturer;
            manufacturer.style.cssText = `
                font-size: 0.85em;
                color: var(--text-muted);
            `;

            systemCard.addEventListener('click', () => {
                this.selectedDevice = system.key;
                this.deviceName = system.name;
                this.selectedPlatform = system.platform; // Use the system's proper platform
                this.currentStep = 'naming';
                this.renderCurrentStep();
            });

            systemCard.addEventListener('mouseenter', () => {
                systemCard.style.borderColor = 'var(--interactive-accent)';
                systemCard.style.background = 'var(--background-modifier-hover)';
            });

            systemCard.addEventListener('mouseleave', () => {
                systemCard.style.borderColor = 'var(--background-modifier-border)';
                systemCard.style.background = 'var(--background-primary)';
            });
        });
    }

    private renderDeviceNaming() {
        const { contentEl } = this;
        
        contentEl.createEl('h2', { text: 'Add New Device - Name Your Device' });
        contentEl.createEl('p', {
            text: 'Give your device a custom name or use the default:',
            cls: 'setting-item-description'
        });

        const namingContainer = contentEl.createDiv('naming-container');
        namingContainer.style.cssText = `
            margin: 20px 0;
        `;

        new Setting(namingContainer)
            .setName('Device Name')
            .setDesc('This name will appear in your device list')
            .addText(text => text
                .setValue(this.deviceName)
                .setPlaceholder('Enter device name...')
                .onChange(value => {
                    this.deviceName = value;
                    this.updateCreateButton();
                }));

        this.addModalButtons(['Back', 'Create Device', 'Cancel'], ['back', 'create', 'cancel']);
        this.updateCreateButton();
    }

private getPlatformsForCategory(category: string) {
        const platformMap: Record<string, Array<{key: string, name: string, icon: string, deviceType?: DeviceType}>> = {
            computer: [
                { key: 'Windows', name: 'Windows', icon: '🪟', deviceType: 'computer' },
                { key: 'Mac', name: 'Mac', icon: '🍎', deviceType: 'computer' },
                { key: 'Linux', name: 'Linux', icon: '🐧', deviceType: 'computer' },
                { key: 'SteamOS', name: 'SteamOS', icon: '🎮', deviceType: 'computer' }
            ],
            console: [
                { key: 'PlayStation', name: 'PlayStation', icon: '🎮', deviceType: 'console' },
                { key: 'Xbox', name: 'Xbox', icon: '🎮', deviceType: 'console' },
                { key: 'Nintendo', name: 'Nintendo', icon: '🎮', deviceType: 'console' }
            ],
            handheld: [
                { key: 'Windows', name: 'Windows', icon: '🪟', deviceType: 'handheld' },
                { key: 'SteamOS', name: 'SteamOS', icon: '🎮', deviceType: 'handheld' },
                { key: 'Xbox', name: 'Xbox', icon: '🎮', deviceType: 'handheld' }
            ],
            retro: [
                { key: 'Nintendo-Retro', name: 'Nintendo', icon: '🎮', deviceType: 'console' },
                { key: 'Sega-Retro', name: 'Sega', icon: '🎮', deviceType: 'console' },
                { key: 'Sony-Retro', name: 'Sony', icon: '🎮', deviceType: 'console' },
                { key: 'Atari-Retro', name: 'Atari', icon: '🕹️', deviceType: 'console' },
                { key: 'Microsoft-Retro', name: 'Microsoft', icon: '🎮', deviceType: 'console' },
                { key: 'Other-Retro', name: 'Other Retro', icon: '⚙️', deviceType: 'console' }
            ],
            mobile: [
                { key: 'iOS', name: 'iOS', icon: '📱', deviceType: 'mobile' },
                { key: 'Android', name: 'Android', icon: '📱', deviceType: 'mobile' }
            ],
            other: [
                { key: 'Custom', name: 'Custom', icon: '⚙️', deviceType: 'custom' }
            ]
        };

        return platformMap[category] || [];
    }

    private getDevicesForPlatform(category: string, platform: string): Array<{key: string, name: string}> {
        const deviceMap: Record<string, Record<string, Array<{key: string, name: string}>>> = {
            console: {
                PlayStation: [
                    { key: 'ps5', name: 'PlayStation 5' },
                    { key: 'ps5-pro', name: 'PlayStation 5 Pro' },
                    { key: 'ps4-pro', name: 'PlayStation 4 Pro' },
                    { key: 'ps4-slim', name: 'PlayStation 4 Slim' },
                    { key: 'ps4', name: 'PlayStation 4' },
                ],
                Xbox: [
                    { key: 'xbox-series-x', name: 'Xbox Series X' },
                    { key: 'xbox-series-s', name: 'Xbox Series S' },
                    { key: 'xbox-one-x', name: 'Xbox One X' },
                    { key: 'xbox-one-s', name: 'Xbox One S' },
                    { key: 'xbox-one', name: 'Xbox One' },
                ],
                Nintendo: [
                    { key: 'switch-2', name: 'Nintendo Switch 2' },
                    { key: 'switch-oled', name: 'Nintendo Switch OLED' },
                    { key: 'switch', name: 'Nintendo Switch' },
                    { key: 'switch-lite', name: 'Nintendo Switch Lite' },
                ]
            },
            handheld: {
                Windows: [
                    { key: 'rog-ally', name: 'ROG Ally' },
                    { key: 'rog-ally-x', name: 'ROG Ally X' },
                    { key: 'legion-go', name: 'Legion Go' },
                    { key: 'msi-claw', name: 'MSI Claw' },
                    { key: 'ayaneo', name: 'AyaNeo Device' },
                    { key: 'gpd-win', name: 'GPD Win' }
                ],
                SteamOS: [
                    { key: 'steam-deck', name: 'Steam Deck' },
                    { key: 'steam-deck-oled', name: 'Steam Deck OLED' }
                ],
                Xbox: [
                    { key: 'xbox-handheld', name: 'Xbox Handheld' }
                ]
            },
            mobile: {
                iOS: [
                    { key: 'iphone', name: 'iPhone' },
                    { key: 'ipad', name: 'iPad' },
                    { key: 'ipad-pro', name: 'iPad Pro' }
                ],
                Android: [
                    { key: 'android-phone', name: 'Android Phone' },
                    { key: 'android-tablet', name: 'Android Tablet' }
                ]
            }
        };

        return deviceMap[category]?.[platform] || [];
    }

    private getRetroSystems(): Array<{key: string, name: string, manufacturer: string, platform: string}> {
        return [
            // Nintendo Systems
            { key: 'nes', name: 'Nintendo Entertainment System (NES)', manufacturer: 'Nintendo', platform: 'Retro' },
            { key: 'snes', name: 'Super Nintendo Entertainment System (SNES)', manufacturer: 'Nintendo', platform: 'Retro' },
            { key: 'n64', name: 'Nintendo 64', manufacturer: 'Nintendo', platform: 'Retro' },
            { key: 'gamecube', name: 'GameCube', manufacturer: 'Nintendo', platform: 'Retro' },
            { key: 'gameboy', name: 'Game Boy', manufacturer: 'Nintendo', platform: 'Retro' },
            { key: 'gameboy-color', name: 'Game Boy Color', manufacturer: 'Nintendo', platform: 'Retro' },
            { key: 'gameboy-advance', name: 'Game Boy Advance', manufacturer: 'Nintendo', platform: 'Retro' },
            { key: 'ds', name: 'Nintendo DS', manufacturer: 'Nintendo', platform: 'Retro' },
            { key: '3ds', name: 'Nintendo 3DS', manufacturer: 'Nintendo', platform: 'Retro' },
            { key: '3ds-xl', name: 'Nintendo 3DS XL', manufacturer: 'Nintendo', platform: 'Retro' },
            { key: 'wii', name: 'Wii', manufacturer: 'Nintendo', platform: 'Retro' },
            { key: 'wii-u', name: 'Wii U', manufacturer: 'Nintendo', platform: 'Retro' },
            
            // Sega Systems
            { key: 'genesis', name: 'Sega Genesis/Mega Drive', manufacturer: 'Sega', platform: 'Retro' },
            { key: 'saturn', name: 'Sega Saturn', manufacturer: 'Sega', platform: 'Retro' },
            { key: 'dreamcast', name: 'Sega Dreamcast', manufacturer: 'Sega', platform: 'Retro' },
            { key: 'master-system', name: 'Sega Master System', manufacturer: 'Sega', platform: 'Retro' },
            { key: 'game-gear', name: 'Sega Game Gear', manufacturer: 'Sega', platform: 'Retro' },
            
            // Sony Systems
            { key: 'ps1', name: 'PlayStation (PS1)', manufacturer: 'Sony', platform: 'Retro' },
            { key: 'ps2', name: 'PlayStation 2', manufacturer: 'Sony', platform: 'Retro' },
            { key: 'psp', name: 'PlayStation Portable (PSP)', manufacturer: 'Sony', platform: 'Retro' },
            { key: 'ps-vita', name: 'PlayStation Vita', manufacturer: 'Sony', platform: 'Retro' },
            { key: 'ps3-slim', name: 'PlayStation 3 Slim', manufacturer: 'Sony', platform: 'Retro' },
            { key: 'ps3', name: 'PlayStation 3', manufacturer: 'Sony', platform: 'Retro' },
            
            // Atari Systems
            { key: 'atari-2600', name: 'Atari 2600', manufacturer: 'Atari', platform: 'Retro' },
            { key: 'atari-7800', name: 'Atari 7800', manufacturer: 'Atari', platform: 'Retro' },
            { key: 'atari-lynx', name: 'Atari Lynx', manufacturer: 'Atari', platform: 'Retro' },
            
            // Microsoft
            { key: 'xbox-original', name: 'Original Xbox', manufacturer: 'Microsoft', platform: 'Retro' },
            { key: 'xbox-360', name: 'Xbox 360', manufacturer: 'Microsoft', platform: 'Retro' },
            
            // Other Notable Systems
            { key: '3do', name: '3DO Interactive Multiplayer', manufacturer: '3DO', platform: 'Retro' },
            { key: 'neo-geo', name: 'Neo Geo', manufacturer: 'SNK', platform: 'Retro' },
            { key: 'turbografx-16', name: 'TurboGrafx-16/PC Engine', manufacturer: 'NEC', platform: 'Retro' },
            { key: 'jaguar', name: 'Atari Jaguar', manufacturer: 'Atari', platform: 'Retro' },
            { key: 'virtual-boy', name: 'Virtual Boy', manufacturer: 'Nintendo', platform: 'Retro' },
            { key: 'wonderswan', name: 'WonderSwan', manufacturer: 'Bandai', platform: 'Retro' }
        ];
    }

    private addModalButtons(labels: string[], actions: string[]) {
        const { contentEl } = this;
        
        const buttonContainer = contentEl.createDiv('modal-button-container');
        buttonContainer.style.cssText = `
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid var(--background-modifier-border);
        `;

        labels.forEach((label, index) => {
            const action = actions[index];
            const button = buttonContainer.createEl('button', { text: label });
            
            if (action === 'create') {
                button.classList.add('mod-cta');
                button.id = 'create-device-button';
                button.disabled = true;
            } else if (action === 'cancel') {
                button.classList.add('mod-cancel');
            }
            
            button.onclick = () => this.handleButtonClick(action);
        });
    }

    private handleButtonClick(action: string) {
        switch (action) {
            case 'back':
                this.goBack();
                break;
            case 'continue':
                this.goForward();
                break;
            case 'create':
                this.createDevice();
                break;
            case 'cancel':
                this.close();
                break;
        }
    }

    private goBack() {
        switch (this.currentStep) {
            case 'platform':
                this.currentStep = 'category';
                this.selectedCategory = '';
                break;
            case 'device':
                this.currentStep = 'platform';
                this.selectedPlatform = '';
                break;
            case 'naming':
                // Special case: if we came from computer category, go back to platform
                // (since computers skip the device selection step)
                if (this.selectedCategory === 'computer') {
                    this.currentStep = 'platform';
                    this.selectedPlatform = '';
                } else {
                    this.currentStep = 'device';
                    this.selectedDevice = '';
                }
                this.deviceName = '';
                break;
        }
        this.renderCurrentStep();
    }

    private goForward() {
        // This will be used for steps that need manual progression
        switch (this.currentStep) {
            case 'device':
                if (this.selectedDevice) {
                    this.currentStep = 'naming';
                    this.renderCurrentStep();
                }
                break;
        }
    }

    private updateCreateButton() {
        const button = this.contentEl.querySelector('#create-device-button') as HTMLButtonElement;
        if (button) {
            const isValid = this.deviceName.trim().length > 0;
            button.disabled = !isValid;
        }
    }

    private async createDevice() {
        if (!this.deviceName.trim()) {
            new Notice('Please enter a device name');
            return;
        }

        try {
            const newDevice = await this.plugin.addDevice(
                this.deviceName.trim(),
                this.finalDeviceType,
                [this.selectedPlatform]
            );
            
            new Notice(`✅ Added ${newDevice.name}!`);
            this.onSave();
            this.close();
            
        } catch (error) {
            console.error('Error creating device:', error);
            new Notice(`❌ Error creating device: ${error.message}`);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    
        if (this.keyboardNav) {
            this.keyboardNav.destroy();
            this.keyboardNav = null;
        }
    }
}

// Modal for editing existing devices
class EditDeviceModal extends Modal {
    private plugin: GameLogPlugin;
    private device: UserDevice;
    private deviceIndex: number;
    private onSave: () => void;
    private editedDevice: UserDevice;

    constructor(app: App, plugin: GameLogPlugin, device: UserDevice, deviceIndex: number, onSave: () => void) {
        super(app);
        this.plugin = plugin;
        this.device = device;
        this.deviceIndex = deviceIndex;
        this.onSave = onSave;
        
        // Create a proper copy
        this.editedDevice = {
            ...device,
            platforms: [...device.platforms],
            platformStores: JSON.parse(JSON.stringify(device.platformStores)),
            platformSubscriptions: JSON.parse(JSON.stringify(device.platformSubscriptions))
        };
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl('h2', { text: `Edit ${this.device.name}` });

        // Device name
        new Setting(contentEl)
            .setName('Device Name')
            .setDesc('Display name for this device')
            .addText(text => text
                .setValue(this.editedDevice.name)
                .onChange(value => {
                    this.editedDevice.name = value;
                }));

        // Platform management
        this.addPlatformManagement(contentEl);

        // Default device toggle
        if (this.plugin.settings.userDevices.filter(d => 
            d.platforms.some(p => this.editedDevice.platforms.includes(p))
        ).length > 1) {
            new Setting(contentEl)
                .setName('Default Device')
                .setDesc(`Make this the default device for its platforms`)
                .addToggle(toggle => toggle
                    .setValue(this.editedDevice.isDefault)
                    .onChange(value => {
                        this.editedDevice.isDefault = value;
                    }));
        }

        // Action buttons
        const buttonContainer = contentEl.createDiv();
        buttonContainer.style.cssText = `
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 20px;
        `;

        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.onclick = () => this.close();

        const saveButton = buttonContainer.createEl('button', { 
            text: 'Save Changes',
            cls: 'mod-cta'
        });
        saveButton.onclick = async () => {
            await this.saveChanges();
        };
    }

    private addPlatformManagement(containerEl: HTMLElement) {
        containerEl.createEl('h4', { text: 'Platforms & Features' });
        
        // Core platforms
        containerEl.createEl('h5', { text: 'Core Platforms' });
        containerEl.createEl('p', {
            text: 'The main operating system(s) this device runs:',
            cls: 'setting-item-description'
        });

        const corePlatforms = this.getCorePlatformsForDeviceType(this.editedDevice.type);
        
        corePlatforms.forEach(platform => {
            const isEnabled = this.editedDevice.platforms.includes(platform);
            
            new Setting(containerEl)
                .setName(platform)
                .addToggle(toggle => toggle
                    .setValue(isEnabled)
                    .onChange(async (value) => {
                        if (value) {
                            // Add platform
                            if (!this.editedDevice.platforms.includes(platform)) {
                                this.editedDevice.platforms.push(platform);
                                this.editedDevice.platformStores[platform] = this.getDefaultStoresForPlatform(platform);
                                this.editedDevice.platformSubscriptions[platform] = this.getDefaultSubscriptionsForPlatform(platform);
                            }
                        } else {
                            // Remove platform (but don't allow removing the last core platform)
                            const coreCount = this.editedDevice.platforms.filter(p => corePlatforms.includes(p)).length;
                            if (coreCount > 1) {
                                this.editedDevice.platforms = this.editedDevice.platforms.filter(p => p !== platform);
                                delete this.editedDevice.platformStores[platform];
                                delete this.editedDevice.platformSubscriptions[platform];
                            } else {
                                new Notice('Cannot remove the last core platform from a device');
                                toggle.setValue(true);
                            }
                        }
                        this.refreshPlatformDetails(containerEl);
                    }));
        });

        // Emulation support
        if (this.deviceSupportsEmulation(this.editedDevice.type)) {
            containerEl.createEl('h5', { text: 'Additional Features' });
            
            const hasEmulation = this.editedDevice.platforms.includes('Emulation');
            
            new Setting(containerEl)
                .setName('Emulation Support')
                .setDesc('Enable if this device runs emulators for retro games')
                .addToggle(toggle => toggle
                    .setValue(hasEmulation)
                    .onChange((value) => {
                        if (value) {
                            // Add emulation
                            if (!this.editedDevice.platforms.includes('Emulation')) {
                                this.editedDevice.platforms.push('Emulation');
                                this.editedDevice.platformStores['Emulation'] = ['ROM Files', 'No Store'];
                                this.editedDevice.platformSubscriptions['Emulation'] = [];
                            }
                        } else {
                            // Remove emulation
                            this.editedDevice.platforms = this.editedDevice.platforms.filter(p => p !== 'Emulation');
                            delete this.editedDevice.platformStores['Emulation'];
                            delete this.editedDevice.platformSubscriptions['Emulation'];
                        }
                        this.refreshPlatformDetails(containerEl);
                    }));
        }

        // Platform details section
        const detailsContainer = containerEl.createDiv('platform-details-container');
        detailsContainer.style.cssText = `
            margin-top: 20px;
        `;
        
        this.refreshPlatformDetails(containerEl);
    }

    private getCorePlatformsForDeviceType(deviceType: DeviceType): string[] {
        const platformMap: Record<DeviceType, string[]> = {
            computer: ['Windows', 'Mac', 'Linux', 'SteamOS'],
            console: ['PlayStation', 'Xbox', 'Nintendo'],
            handheld: ['Windows', 'SteamOS', 'Nintendo', 'iOS', 'Android'],
            hybrid: ['Windows', 'SteamOS', 'Nintendo'],
            mobile: ['iOS', 'Android'],
            custom: ['Windows', 'Mac', 'Linux', 'PlayStation', 'Xbox', 'Nintendo', 'iOS', 'Android', 'Other']
        };
        
        return platformMap[deviceType] || [];
    }

    private deviceSupportsEmulation(deviceType: DeviceType): boolean {
        // Most modern devices can run emulators
        return ['computer', 'handheld', 'mobile', 'custom'].includes(deviceType);
    }

    private refreshPlatformDetails(containerEl: HTMLElement) {
        const detailsContainer = containerEl.querySelector('.platform-details-container') as HTMLElement;
        if (!detailsContainer) return;
        
        detailsContainer.empty();
        
        if (this.editedDevice.platforms.length === 0) return;
        
        detailsContainer.createEl('h5', { text: 'Platform Details' });
        
        this.editedDevice.platforms.forEach(platform => {
            const platformSection = detailsContainer.createDiv();
            platformSection.style.cssText = `
                margin: 15px 0;
                padding: 15px;
                border: 1px solid var(--background-modifier-border);
                border-radius: 6px;
                background: var(--background-secondary);
            `;
            
            platformSection.createEl('h6', { text: platform });
            
            // Stores for this platform
            const stores = this.editedDevice.platformStores[platform] || [];
            if (stores.length > 0) {
                const storesText = platformSection.createEl('p');
                storesText.innerHTML = `<strong>Stores:</strong> ${stores.join(', ')}`;
                storesText.style.marginBottom = '8px';
            }
            
            // Subscriptions for this platform
            const subs = this.editedDevice.platformSubscriptions[platform] || [];
            if (subs.length > 0) {
                const subsText = platformSection.createEl('p');
                subsText.innerHTML = `<strong>Subscriptions:</strong> ${subs.join(', ')}`;
                subsText.style.marginBottom = '8px';
            }
            
            // Note about store/subscription management
            const note = platformSection.createEl('p');
            note.style.cssText = `
                font-size: 0.8em;
                color: var(--text-muted);
                font-style: italic;
                margin: 0;
            `;
            note.textContent = 'Stores and subscriptions are managed globally in the main settings.';
        });
    }

    private getAvailablePlatformsForDeviceType(deviceType: DeviceType): string[] {
        const platformMap: Record<DeviceType, string[]> = {
            computer: ['Windows', 'Mac', 'Linux', 'SteamOS'],
            console: ['PlayStation', 'Xbox', 'Nintendo', 'Retro'],
            handheld: ['Windows', 'SteamOS', 'Nintendo', 'iOS', 'Android'],
            hybrid: ['Windows', 'SteamOS', 'Nintendo'],
            mobile: ['iOS', 'Android'],
            custom: ['Windows', 'Mac', 'Linux', 'PlayStation', 'Xbox', 'Nintendo', 'Retro', 'Emulation', 'Other']
        };
        
        return platformMap[deviceType] || [];
    }

    private getDefaultStoresForPlatform(platform: string): string[] {
        if (['PC', 'Windows', 'Mac', 'Linux', 'SteamOS'].includes(platform)) {
            // For PC platforms, get currently enabled stores
            const pcDevices = this.plugin.settings.userDevices.filter(d => 
                d.platforms.some(p => ['PC', 'Windows', 'Mac', 'Linux', 'SteamOS'].includes(p))
            );
            
            if (pcDevices.length > 0) {
                const enabledStores = new Set<string>();
                pcDevices.forEach(device => {
                    device.platforms.forEach(devicePlatform => {
                        if (['PC', 'Windows', 'Mac', 'Linux', 'SteamOS'].includes(devicePlatform)) {
                            if (device.platformStores[devicePlatform]) {
                                device.platformStores[devicePlatform].forEach(store => enabledStores.add(store));
                            }
                        }
                    });
                });
                return Array.from(enabledStores);
            }
        }
        
        // Use the plugin's method for getting compatible stores
        return this.plugin.getCompatibleStoresForPlatform(platform);
    }

    private getDefaultSubscriptionsForPlatform(platform: string): string[] {
        const availableSubscriptions = this.plugin.getSubscriptionsForPlatform(platform);
        return availableSubscriptions.filter(sub => 
            this.plugin.settings.enabledSubscriptions[sub] === true
        );
    }

    private async saveChanges() {
        try {
            // Handle default device logic
            if (this.editedDevice.isDefault && !this.device.isDefault) {
                // Making this device default - remove default from others with overlapping platforms
                this.plugin.settings.userDevices.forEach(device => {
                    if (device.id !== this.editedDevice.id && 
                        device.platforms.some(p => this.editedDevice.platforms.includes(p))) {
                        device.isDefault = false;
                    }
                });
            }

            // Update the device in the settings
            this.plugin.settings.userDevices[this.deviceIndex] = this.editedDevice;
            await this.plugin.saveSettings();
            
            new Notice(`✅ Updated ${this.editedDevice.name}!`);
            this.onSave();
            this.close();
            
        } catch (error) {
            console.error('Error saving device changes:', error);
            new Notice(`❌ Error saving changes: ${error.message}`);
        }
    }
}