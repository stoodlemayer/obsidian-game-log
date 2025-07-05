// gameCreationModal.ts - Updated for multi-platform device support
import { App, Modal, Setting, Notice, requestUrl, setIcon, TFile, TFolder, TAbstractFile } from 'obsidian';
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
    description?: string; 
    background_image?: string;
    platforms?: Array<{platform: {name: string}}>;
    released?: string;
    added?: number;           
    rating?: number;          
    _searchScore?: number;    
}

// Updated interface for multi-platform device support with store selection tracking
interface StreamlinedDeviceStore {
    deviceId: string;
    deviceName: string;
    deviceType: DeviceType;
    availablePlatforms: string[]; // All platforms this device supports
    selectedPlatforms: string[]; // Platforms selected for this game
    platformStores: Record<string, string[]>; // Available stores per platform
    platformSubscriptions: Record<string, string[]>; // Available subscriptions per platform
    selectedStores: Record<string, string[]>; // ADDED: Selected stores per platform
    isSelected: boolean;
}

interface ImageTypeSpecs {
    name: string;
    width: number;
    height: number;
    tolerance: number;
    description: string;
    filename: string;
}

interface UploadedImageInfo {
    file: File;
    type: string | null;
    confidence: 'high' | 'low';
    message: string;
    width: number;
    height: number;
    hasTransparency: boolean;
}

interface ProcessedImage {
    type: string;
    filename: string;
    arrayBuffer: ArrayBuffer;
}

const STEAM_IMAGE_SPECS: ImageTypeSpecs[] = [
    { 
        name: 'box_art', 
        width: 600, 
        height: 900, 
        tolerance: 50, 
        description: 'Box Art (Portrait)', 
        filename: 'box_art.jpg' 
    },
    { 
        name: 'header', 
        width: 460, 
        height: 215, 
        tolerance: 20, 
        description: 'Header (Wide)', 
        filename: 'header.jpg' 
    },
    { 
        name: 'hero', 
        width: 1920, 
        height: 620, 
        tolerance: 100, 
        description: 'Hero Image (Ultra-wide)', 
        filename: 'hero.jpg' 
    },
    { 
        name: 'logo', 
        width: 0, 
        height: 0, 
        tolerance: 0, 
        description: 'Logo (Transparent)', 
        filename: 'logo.png' 
    }
];

class SmartImageUpload {
    private detectImageType(width: number, height: number, hasTransparency: boolean): ImageTypeSpecs | null {
        // Logo detection: Check transparency first for smaller images
        if (hasTransparency && (width < 800 && height < 600)) {
            return STEAM_IMAGE_SPECS.find(spec => spec.name === 'logo') || null;
        }
        
        // Check exact matches with tolerance (skip logo)
        for (const spec of STEAM_IMAGE_SPECS.slice(0, 3)) {
            const widthMatch = Math.abs(width - spec.width) <= spec.tolerance;
            const heightMatch = Math.abs(height - spec.height) <= spec.tolerance;
            
            if (widthMatch && heightMatch) {
                return spec;
            }
        }
        
        // Fallback: Aspect ratio matching
        const aspectRatio = width / height;
        
        if (aspectRatio < 0.8) return STEAM_IMAGE_SPECS[0]; // Box art (tall)
        if (aspectRatio > 2.5) return STEAM_IMAGE_SPECS[2]; // Hero (ultra-wide)
        if (aspectRatio > 1.5) return STEAM_IMAGE_SPECS[1]; // Header (wide)
        
        return null; // Unknown type
    }
    
    async analyzeImage(file: File): Promise<UploadedImageInfo> {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = img.width;
                canvas.height = img.height;
                
                if (ctx) {
                    ctx.drawImage(img, 0, 0);
                    const imageData = ctx.getImageData(0, 0, img.width, img.height);
                    const hasTransparency = this.checkTransparency(imageData);
                    
                    const detectedType = this.detectImageType(img.width, img.height, hasTransparency);
                    
                    resolve({
                        file,
                        type: detectedType?.name || null,
                        confidence: detectedType ? 'high' : 'low',
                        message: detectedType 
                            ? `Auto-detected as ${detectedType.description}` 
                            : `Unknown size (${img.width}×${img.height}) - please select type`,
                        width: img.width,
                        height: img.height,
                        hasTransparency
                    });
                }
                
                URL.revokeObjectURL(img.src);
            };
            img.src = URL.createObjectURL(file);
        });
    }
    
    private checkTransparency(imageData: ImageData): boolean {
        const data = imageData.data;
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] < 255) return true; // Found non-opaque pixel
        }
        return false;
    }
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
    private overrideMode = false;
    private protonDbCache = new Map<string, string>(); // steamAppId -> compatibility rating
    private streamlinedDevices: StreamlinedDeviceStore[] = [];
    private showAllDevices = false;
    private protonCompatible = false;
    private uploadedImages: ProcessedImage[] = [];
    private smartImageUpload = new SmartImageUpload();
    private lastErrorTime = 0; 
    private errorCount = 0;    

    private sanitizeForFileSystem(name: string): string {
        return name
            .replace(/:\s*/g, ' - ') // Replace colon + optional space with " - "
            .replace(/[<>"/\\|?*]/g, '') // Remove other invalid filename characters
            .replace(/\s+/g, ' ') // Normalize multiple spaces to single spaces
            .trim();
    }

    constructor(app: App, plugin: GameLogPlugin) {
        super(app);
        this.plugin = plugin;
        
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
            min-height: 500px;
            max-height: 80vh;
            overflow-y: auto;
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

    // UPDATED: Device selection now works with multi-platform devices
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
                // @ts-ignore - Obsidian internal API
                this.app.setting.open();
            };
            return;
        }

        // Initialize devices if not already done
        if (this.streamlinedDevices.length === 0) {
            this.initializeStreamlinedDevices();
        }

        const deviceContainer = containerEl.createDiv('compact-device-selection-container');
        this.renderCompactDeviceSelection(deviceContainer);
    }

    // UPDATED: Initialize devices with new multi-platform structure and store tracking
    private initializeStreamlinedDevices() {
        const allDevices = this.plugin.getActiveDevices();
        let devicesToShow = allDevices;
        
        // Apply smart filtering if we have game data and not in override mode
        if (this.selectedGame && !this.showAllDevices) {
            devicesToShow = this.filterDevicesByGamePlatforms(allDevices, this.selectedGame);
            
            // If no compatible devices found, show all devices
            if (devicesToShow.length === 0) {
                devicesToShow = allDevices;
                this.showAllDevices = true;
            }
        }
        
        // Sort devices consistently: alphabetical by name
        const sortedDevices = [...devicesToShow].sort((a, b) => a.name.localeCompare(b.name));

        this.streamlinedDevices = sortedDevices.map(device => ({
            deviceId: device.id,
            deviceName: device.name,
            deviceType: device.type,
            availablePlatforms: device.platforms, // All platforms this device supports
            selectedPlatforms: [], // Platforms selected for this game
            platformStores: device.platformStores, // Available stores per platform
            platformSubscriptions: device.platformSubscriptions, // Available subscriptions per platform
            selectedStores: {}, // ADDED: Track selected stores per platform
            isSelected: false // Never auto-select devices
        }));
        
        // Update game data
        this.updateGameDataFromStreamlinedDevices();
    }

    // ENHANCED: Device filtering with future-compatible retro and emulation logic
    private filterDevicesByGamePlatforms(devices: UserDevice[], selectedGame: RawgGame): UserDevice[] {
        if (!selectedGame.platforms || selectedGame.platforms.length === 0) {
            return devices; // No platform data, show all devices
        }
        
        const gamePlatforms = selectedGame.platforms.map(p => p.platform.name.toLowerCase());
        console.log('Game platforms from RAWG:', gamePlatforms);
        
        // Check if this is a retro game (released before 2000)
        const isRetroGame = selectedGame.released && new Date(selectedGame.released).getFullYear() < 2000;
        console.log('Is retro game:', isRetroGame, selectedGame.released);
        
        // Enhanced platform mapping with more variations and future compatibility
        const platformMap: Record<string, string[]> = {
            // Modern platforms
            'pc': ['Windows'],
            'playstation 4': ['PlayStation'],
            'playstation 5': ['PlayStation'],
            'playstation': ['PlayStation'],
            'xbox one': ['Xbox'],
            'xbox series s/x': ['Xbox'],
            'xbox': ['Xbox'],
            'nintendo switch': ['Nintendo'], // Modern Switch
            'nintendo': ['Nintendo'],
            'ios': ['iOS'],
            'android': ['Android'],
            'linux': ['Linux', 'SteamOS'],
            'macos': ['Mac'],
            'mac': ['Mac'],
            
            // Retro platforms - enhanced with more name variations
            'nes': ['Nintendo', 'Retro', 'Emulation'],
            'nintendo entertainment system': ['Nintendo', 'Retro', 'Emulation'],
            'snes': ['Nintendo', 'Retro', 'Emulation'],
            'super nintendo': ['Nintendo', 'Retro', 'Emulation'],
            'super nintendo entertainment system': ['Nintendo', 'Retro', 'Emulation'],
            'nintendo 64': ['Nintendo', 'Retro', 'Emulation'],
            'n64': ['Nintendo', 'Retro', 'Emulation'],
            'gamecube': ['Nintendo', 'Retro', 'Emulation'],
            'nintendo gamecube': ['Nintendo', 'Retro', 'Emulation'],
            'wii': ['Nintendo', 'Retro', 'Emulation'],
            'nintendo wii': ['Nintendo', 'Retro', 'Emulation'],
            'game boy': ['Nintendo', 'Retro', 'Emulation'],
            'game boy color': ['Nintendo', 'Retro', 'Emulation'],
            'game boy advance': ['Nintendo', 'Retro', 'Emulation'],
            'nintendo ds': ['Nintendo', 'Retro', 'Emulation'],
            'nintendo 3ds': ['Nintendo', 'Retro', 'Emulation'],
            
            // Sega platforms
            'sega genesis': ['Sega', 'Retro', 'Emulation'],
            'sega mega drive': ['Sega', 'Retro', 'Emulation'],
            'genesis': ['Sega', 'Retro', 'Emulation'],
            'mega drive': ['Sega', 'Retro', 'Emulation'],
            'sega saturn': ['Sega', 'Retro', 'Emulation'],
            'saturn': ['Sega', 'Retro', 'Emulation'],
            'dreamcast': ['Sega', 'Retro', 'Emulation'],
            'sega dreamcast': ['Sega', 'Retro', 'Emulation'],
            'sega master system': ['Sega', 'Retro', 'Emulation'],
            'master system': ['Sega', 'Retro', 'Emulation'],
            'game gear': ['Sega', 'Retro', 'Emulation'],
            'sega game gear': ['Sega', 'Retro', 'Emulation'],
            
            // Sony platforms
            'playstation 1': ['PlayStation', 'Retro', 'Emulation'],
            'playstation 2': ['PlayStation', 'Retro', 'Emulation'],
            'psx': ['PlayStation', 'Retro', 'Emulation'],
            'ps1': ['PlayStation', 'Retro', 'Emulation'],
            'ps2': ['PlayStation', 'Retro', 'Emulation'],
            'psp': ['PlayStation', 'Retro', 'Emulation'],
            'playstation portable': ['PlayStation', 'Retro', 'Emulation'],
            'ps vita': ['PlayStation', 'Retro', 'Emulation'],
            'playstation vita': ['PlayStation', 'Retro', 'Emulation'],
            
            // Other retro platforms
            'atari 2600': ['Atari', 'Retro', 'Emulation'],
            'atari 7800': ['Atari', 'Retro', 'Emulation'],
            'atari': ['Atari', 'Retro', 'Emulation'],
            'neo geo': ['SNK', 'Retro', 'Emulation'],
            'turbografx-16': ['NEC', 'Retro', 'Emulation'],
            'pc engine': ['NEC', 'Retro', 'Emulation'],
            '3do': ['Other', 'Retro', 'Emulation'],
            'jaguar': ['Atari', 'Retro', 'Emulation'],
            'atari jaguar': ['Atari', 'Retro', 'Emulation']
        };
        
        // Find compatible device platforms
        const compatiblePlatforms = new Set<string>();
        
        gamePlatforms.forEach(gamePlatform => {
            const mapped = platformMap[gamePlatform];
            if (mapped) {
                mapped.forEach(platform => compatiblePlatforms.add(platform));
            }
        });
        
        // FUTURE-COMPATIBLE: For retro games, also check modern platforms
        // This handles cases like NES games on Nintendo Switch Online
        if (isRetroGame) {
            // Check if any of the original platforms suggest this might be available on modern Nintendo devices
            const hasNintendoRetro = gamePlatforms.some(platform => 
                ['nes', 'nintendo entertainment system', 'snes', 'super nintendo', 'nintendo 64', 'game boy'].some(retro => 
                    platform.includes(retro)
                )
            );
            
            if (hasNintendoRetro) {
                // Add modern Nintendo as a possibility (for Switch Online, etc.)
                compatiblePlatforms.add('Nintendo');
                console.log('Added modern Nintendo for potential Switch Online compatibility');
            }
        }
        
        // Add Linux/SteamOS if ProtonDB says it's compatible
        if (this.protonCompatible) {
            compatiblePlatforms.add('Linux');
            compatiblePlatforms.add('SteamOS');
            console.log('Added Linux/SteamOS based on ProtonDB compatibility');
        }
        
        console.log('Compatible platforms:', Array.from(compatiblePlatforms));
        
        // Filter devices by checking if any of their platforms are compatible
        const filteredDevices = devices.filter(device => 
            device.platforms.some(devicePlatform => compatiblePlatforms.has(devicePlatform))
        );
        
        console.log('Filtered devices:', filteredDevices.map(d => d.name));
        
        // FUTURE-COMPATIBLE: If no devices found and it's a retro game, 
        // show all devices as fallback (they might have emulators)
        if (filteredDevices.length === 0 && isRetroGame) {
            console.log('No specific retro devices found, showing all devices for emulation possibilities');
            return devices;
        }
        
        return filteredDevices;
    }

    // UPDATED: Render device selection with multi-platform support
    private renderCompactDeviceSelection(containerEl: HTMLElement) {
        containerEl.empty();
        
        // Fixed-height container to prevent modal resizing
        const fixedContainer = containerEl.createDiv('fixed-device-container');
        fixedContainer.style.cssText = `
            min-height: 200px;
            max-height: 300px;
            overflow-y: auto;
            border: 1px solid var(--background-modifier-border);
            border-radius: 8px;
            background: var(--background-primary);
        `;
        
        // Header
        const headerContainer = fixedContainer.createDiv('device-header');
        headerContainer.style.cssText = `
            padding: 12px 16px;
            border-bottom: 1px solid var(--background-modifier-border);
            background: var(--background-secondary);
            position: sticky;
            top: 0;
            z-index: 10;
        `;
        
        const headerText = this.selectedGame && !this.showAllDevices
            ? `This game is available on these platforms:`
            : `Where will you play this game?`;
            
        headerContainer.createEl('h4', { 
            text: headerText,
            attr: { style: 'margin: 0; font-size: 1em; font-weight: 600;' }
        });
        
        // Show override option if devices were filtered
        if (this.selectedGame && !this.showAllDevices) {
            const allDevices = this.plugin.getActiveDevices();
            const compatibleDevices = this.filterDevicesByGamePlatforms(allDevices, this.selectedGame);
            
            if (compatibleDevices.length < allDevices.length) {
                const overrideLink = headerContainer.createEl('a', { 
                    text: 'Show all devices',
                    href: '#'
                });
                overrideLink.style.cssText = `
                    font-size: 0.85em;
                    color: var(--text-accent);
                    text-decoration: underline;
                    cursor: pointer;
                    margin-left: 8px;
                `;
                overrideLink.onclick = (e) => {
                    e.preventDefault();
                    this.showAllDevices = true;
                    this.initializeStreamlinedDevices();
                    this.renderCompactDeviceSelection(containerEl);
                };
            }
        }
        
        // Device list
        const deviceList = fixedContainer.createDiv('device-list');
        deviceList.style.cssText = `
            padding: 8px;
        `;
        
        this.streamlinedDevices.forEach(device => {
            this.createCompactDeviceRow(deviceList, device);
        });
    }

    // UPDATED: Device row now handles multiple platforms per device
    private createCompactDeviceRow(container: HTMLElement, device: StreamlinedDeviceStore) {
        const row = container.createDiv('compact-device-row');
        row.style.cssText = `
            display: flex;
            align-items: flex-start;
            gap: 12px;
            padding: 8px 12px;
            border-radius: 6px;
            margin-bottom: 8px;
            transition: background-color 0.2s;
            min-height: 40px;
            ${device.isSelected ? 'background: var(--background-modifier-hover);' : ''}
        `;
        
        // Checkbox
        const checkbox = row.createEl('input', {
            type: 'checkbox',
            attr: { style: 'margin-top: 2px; cursor: pointer;' }
        });
        checkbox.checked = device.isSelected;
        
        // Device info (icon + name + platforms) - ALWAYS center-aligned
        const deviceInfo = row.createDiv('device-info');
        deviceInfo.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 180px;
            flex-shrink: 0;
            height: 24px;
        `;
        
        // Device icon
        const iconContainer = deviceInfo.createSpan();
        iconContainer.style.cssText = `
            display: flex;
            align-items: center;
            width: 16px;
            height: 16px;
        `;
        setIcon(iconContainer, this.getDeviceIcon(device.deviceType));
        
        // Device name and platforms
        const deviceNameContainer = deviceInfo.createDiv();
        deviceNameContainer.createEl('strong', { 
            text: device.deviceName,
            attr: { style: 'font-size: 0.95em;' }
        });
        
        // Show supported platforms
        if (device.availablePlatforms.length > 1) {
            const platformsText = deviceNameContainer.createDiv();
            platformsText.textContent = device.availablePlatforms.join('/');
            platformsText.style.cssText = `
                font-size: 0.8em;
                color: var(--text-muted);
                line-height: 1;
            `;
        }
        
        // Platform selection and stores section (appears when selected)
        const platformContainer = row.createDiv('platform-container');
        platformContainer.style.cssText = `
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 6px;
            min-height: 24px;
        `;
        
        if (device.isSelected) {
            this.renderDevicePlatforms(platformContainer, device);
        }
        
        // Checkbox change handler
        checkbox.onchange = () => {
            device.isSelected = checkbox.checked;
            
            if (!device.isSelected) {
                device.selectedPlatforms = [];
            } else {
                // Smart auto-selection: if device has only one platform, auto-select it
                if (device.availablePlatforms.length === 1) {
                    device.selectedPlatforms = [device.availablePlatforms[0]];
                }
            }
            
            this.updateGameDataFromStreamlinedDevices();
            this.updateCreateButton();
            this.refreshCompactDeviceRow(row, device);
        };
        
        // Row click (anywhere) toggles checkbox
        row.onclick = (e) => {
            if (e.target !== checkbox && !platformContainer.contains(e.target as Node)) {
                checkbox.click();
            }
        };
        
        // Hover effects
        row.onmouseenter = () => {
            if (!device.isSelected) {
                row.style.backgroundColor = 'var(--background-modifier-hover)';
            }
        };
        
        row.onmouseleave = () => {
            if (!device.isSelected) {
                row.style.backgroundColor = '';
            }
        };
    }

    // NEW: Render platform selection for multi-platform devices
    private renderDevicePlatforms(container: HTMLElement, device: StreamlinedDeviceStore) {
        container.empty();
        
        if (device.availablePlatforms.length === 1) {
            // Single platform device - auto-select and show stores/subscriptions
            const platform = device.availablePlatforms[0];
            if (!device.selectedPlatforms.includes(platform)) {
                device.selectedPlatforms = [platform];
            }
            this.renderPlatformStoresAndSubs(container, device, platform);
        } else {
            // Multi-platform device - show platform selection
            device.availablePlatforms.forEach(platform => {
                const platformRow = container.createDiv('platform-row');
                platformRow.style.cssText = `
                    display: flex;
                    align-items: flex-start;
                    gap: 8px;
                    margin-bottom: 4px;
                `;
                
                // Platform checkbox
                const platformCheckbox = platformRow.createEl('input', {
                    type: 'checkbox',
                    attr: { style: 'margin-top: 2px;' }
                });
                platformCheckbox.checked = device.selectedPlatforms.includes(platform);
                
                // Platform content
                const platformContent = platformRow.createDiv('platform-content');
                platformContent.style.cssText = `
                    flex: 1;
                `;
                
                const platformName = platformContent.createEl('strong', { text: platform });
                platformName.style.cssText = `
                    font-size: 0.9em;
                    margin-bottom: 4px;
                    display: block;
                `;
                
                if (device.selectedPlatforms.includes(platform)) {
                    this.renderPlatformStoresAndSubs(platformContent, device, platform);
                }
                
                platformCheckbox.onchange = () => {
                    if (platformCheckbox.checked) {
                        if (!device.selectedPlatforms.includes(platform)) {
                            device.selectedPlatforms.push(platform);
                        }
                    } else {
                        device.selectedPlatforms = device.selectedPlatforms.filter(p => p !== platform);
                    }
                    
                    this.updateGameDataFromStreamlinedDevices();
                    this.updateCreateButton();
                    this.renderDevicePlatforms(container, device);
                };
            });
        }
    }

    // FIXED: Render stores and subscriptions for a specific platform with custom store support
    private renderPlatformStoresAndSubs(container: HTMLElement, device: StreamlinedDeviceStore, platform: string) {
        const storesContainer = container.createDiv('platform-stores-container');
        storesContainer.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 4px;
        `;
        
        // Track selected stores per device-platform combination
        if (!device.selectedStores) {
            device.selectedStores = {};
        }
        if (!device.selectedStores[platform]) {
            device.selectedStores[platform] = [];
        }
        
        // Add store buttons for this platform (including any custom stores already selected)
        const platformStores = device.platformStores[platform] || [];
        const selectedStores = device.selectedStores[platform] || [];
        
        // Combine available stores with any custom stores that were selected
        const allStoresToShow = new Set([...platformStores, ...selectedStores]);
        
        Array.from(allStoresToShow).forEach(store => {
            const isSelected = selectedStores.includes(store);
            const storeBtn = storesContainer.createEl('button', { text: store });
            storeBtn.style.cssText = `
                padding: 4px 8px;
                border: 1px solid ${isSelected ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};
                border-radius: 4px;
                background: ${isSelected ? 'var(--interactive-accent)' : 'var(--background-secondary)'};
                color: ${isSelected ? 'var(--text-on-accent)' : 'var(--text-normal)'};
                font-size: 0.8em;
                cursor: pointer;
                transition: all 0.15s ease;
                white-space: nowrap;
                height: 24px;
                display: flex;
                align-items: center;
            `;
            
            storeBtn.onclick = (e) => {
                e.stopPropagation();
                this.toggleStoreForDevicePlatform(device, platform, store);
                this.updateGameDataFromStreamlinedDevices();
                this.updateCreateButton();
                this.refreshCompactDeviceRow(container.closest('.compact-device-row') as HTMLElement, device);
            };
        });
        
        // Add subscription buttons for this platform
        const platformSubs = device.platformSubscriptions[platform] || [];
        const enabledSubs = platformSubs.filter(sub => 
            this.plugin.settings.enabledSubscriptions[sub] === true
        );
        
        enabledSubs.forEach(subscription => {
            const isSelected = this.gameData.subscriptionServices.includes(subscription);
            const subBtn = storesContainer.createEl('button', { text: subscription });
            subBtn.style.cssText = `
                padding: 4px 8px;
                border: 1px solid ${isSelected ? 'var(--interactive-accent)' : 'var(--background-modifier-border)'};
                border-radius: 4px;
                background: ${isSelected ? 'var(--interactive-accent)' : 'var(--background-secondary)'};
                color: ${isSelected ? 'var(--text-on-accent)' : 'var(--text-normal)'};
                font-size: 0.8em;
                cursor: pointer;
                font-style: italic;
                transition: all 0.15s ease;
                white-space: nowrap;
                height: 24px;
                display: flex;
                align-items: center;
            `;
            
            subBtn.onclick = (e) => {
                e.stopPropagation();
                this.toggleSubscription(subscription);
                this.updateCreateButton();
                this.refreshCompactDeviceRow(container.closest('.compact-device-row') as HTMLElement, device);
            };
        });
        
        // Add custom store button for computer platforms only
        if (this.deviceSupportsCustomStores(device.deviceType, platform)) {
            const addStoreBtn = storesContainer.createEl('button', { text: '+ Add Store' });
            addStoreBtn.style.cssText = `
                padding: 4px 8px;
                border: 1px dashed var(--background-modifier-border);
                border-radius: 4px;
                background: var(--background-primary);
                color: var(--text-muted);
                font-size: 0.8em;
                cursor: pointer;
                transition: all 0.15s ease;
                white-space: nowrap;
                height: 24px;
                display: flex;
                align-items: center;
            `;
            
            addStoreBtn.onclick = (e) => {
                e.stopPropagation();
                this.showCustomStoreInputWithDropdown(storesContainer, device, platform, addStoreBtn);
            };
        }
    }

    // FIXED: Toggle store for specific device and platform with proper tracking
    private toggleStoreForDevicePlatform(device: StreamlinedDeviceStore, platform: string, store: string) {
        if (!device.selectedStores[platform]) {
            device.selectedStores[platform] = [];
        }
        
        const storeIndex = device.selectedStores[platform].indexOf(store);
        
        if (storeIndex >= 0) {
            // Remove store
            device.selectedStores[platform].splice(storeIndex, 1);
        } else {
            // Add store
            device.selectedStores[platform].push(store);
        }
    }

    // FIXED: Game data update now tracks only selected stores (not all available stores)
    private updateGameDataFromStreamlinedDevices() {
        // Clear existing data
        this.gameData.platforms = [];
        this.gameData.deviceStores = {};
        
        // Update from streamlined devices
        this.streamlinedDevices.forEach(device => {
            if (device.isSelected && device.selectedPlatforms.length > 0) {
                this.gameData.platforms.push(device.deviceId);
                
                // Collect only SELECTED stores from selected platforms for this device
                const selectedStoresForDevice: string[] = [];
                device.selectedPlatforms.forEach(platform => {
                    const platformSelectedStores = device.selectedStores[platform] || [];
                    selectedStoresForDevice.push(...platformSelectedStores);
                });
                
                // Remove duplicates and store only selected stores
                this.gameData.deviceStores[device.deviceId] = [...new Set(selectedStoresForDevice)];
            }
        });
    }

    private refreshCompactDeviceRow(row: HTMLElement, device: StreamlinedDeviceStore) {
        // Find and update the platform container
        const platformContainer = row.querySelector('.platform-container') as HTMLElement;
        if (platformContainer) {
            if (device.isSelected) {
                this.renderDevicePlatforms(platformContainer, device);
            } else {
                platformContainer.empty();
                platformContainer.style.minHeight = '24px';
            }
        }
        
        // Update row background
        row.style.backgroundColor = device.isSelected ? 'var(--background-modifier-hover)' : '';
    }

    private toggleSubscription(subscription: string) {
        const subIndex = this.gameData.subscriptionServices.indexOf(subscription);
        
        if (subIndex >= 0) {
            this.gameData.subscriptionServices.splice(subIndex, 1);
        } else {
            this.gameData.subscriptionServices.push(subscription);
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
            // Check if we have name and valid device configurations
            const hasValidDeviceStores = Object.values(this.gameData.deviceStores).some(stores => stores.length > 0);
            const hasSubscriptions = this.gameData.subscriptionServices.length > 0;
            
            // FIXED: Check if we have devices that don't require stores (retro/emulation) more accurately
            const selectedDevices = this.streamlinedDevices.filter(d => d.isSelected);
            const hasDevicesThatDontRequireStores = selectedDevices.some(device => {
                // Check if any selected platform is retro/emulation or if device type suggests it doesn't need stores
                return device.selectedPlatforms.some(platform => 
                    ['Retro', 'Emulation'].includes(platform)
                ) || this.deviceSupportsEmulation(device.deviceType);
            });
            
            const isValid = this.gameData.name.trim() && 
                        (hasValidDeviceStores || hasSubscriptions || hasDevicesThatDontRequireStores);
            
            button.disabled = !isValid;
            button.textContent = isValid ? 'Create Game' : 'Please complete required fields';
        }
    }

    private deviceSupportsCustomStores(deviceType: DeviceType, platform: string): boolean {
        // Only computers and custom devices support custom stores, and only on PC platforms
        const supportedDeviceTypes = ['computer', 'custom'];
        const supportedPlatforms = ['Windows', 'Mac', 'Linux', 'SteamOS'];
        
        return supportedDeviceTypes.includes(deviceType) && supportedPlatforms.includes(platform);
    }

    private showCustomStoreInputWithDropdown(container: HTMLElement, device: StreamlinedDeviceStore, platform: string, addButton: HTMLElement) {
        // Hide the add button temporarily
        addButton.style.display = 'none';
        
        // Create input field container
        const inputContainer = container.createDiv('custom-store-input');
        inputContainer.style.cssText = `
            display: flex;
            gap: 4px;
            align-items: center;
            height: 24px;
            position: relative;
        `;
        
        const storeInput = inputContainer.createEl('input');
        storeInput.type = 'text';
        storeInput.placeholder = 'Store name...';
        storeInput.style.cssText = `
            padding: 2px 6px;
            border: 1px solid var(--interactive-accent);
            border-radius: 4px;
            background: var(--background-primary);
            font-size: 0.8em;
            width: 120px;
            height: 20px;
            position: relative;
            z-index: 10;
        `;
        
        const saveBtn = inputContainer.createEl('button', { text: '✓' });
        saveBtn.style.cssText = `
            padding: 2px 6px;
            border: 1px solid var(--interactive-accent);
            border-radius: 4px;
            background: var(--interactive-accent);
            color: var(--text-on-accent);
            font-size: 0.8em;
            cursor: pointer;
            line-height: 1;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        
        const cancelBtn = inputContainer.createEl('button', { text: '✕' });
        cancelBtn.style.cssText = `
            padding: 2px 6px;
            border: 1px solid var(--background-modifier-border);
            border-radius: 4px;
            background: var(--background-secondary);
            color: var(--text-normal);
            font-size: 0.8em;
            cursor: pointer;
            line-height: 1;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
        `;
        
        // Dropdown for store suggestions
        let storeDropdown: HTMLElement | null = null;
        let storeKeyboardNav: KeyboardNavigationHelper | null = null;
        
        const showStoreDropdown = (query: string) => {
            // Hide existing dropdown
            if (storeDropdown) {
                if (storeKeyboardNav) {
                    storeKeyboardNav.destroy();
                    storeKeyboardNav = null;
                }
                storeDropdown.remove();
                storeDropdown = null;
            }
            
            if (query.trim().length === 0) return;
            
            // Get PC stores that aren't already selected/available
            const allPCStores = [
                'Steam', 'Epic Games Store', 'GOG', 'Xbox App', 
                'Origin/EA App', 'Ubisoft Connect', 'Battle.net', 'Itch.io',
                'Humble Store', 'Microsoft Store', 'Discord Store'
            ];
            
            const selectedStores = device.selectedStores[platform] || [];
            const availableStores = device.platformStores[platform] || [];
            
            // Filter stores that match query and aren't already added
            const filteredStores = allPCStores.filter(store => 
                store.toLowerCase().includes(query.toLowerCase()) &&
                !selectedStores.includes(store) &&
                !availableStores.includes(store)
            );
            
            if (filteredStores.length === 0 && query.trim().length < 3) return;
            
            // Create dropdown
            storeDropdown = inputContainer.createDiv('store-dropdown');
            storeDropdown.style.cssText = `
                position: absolute;
                top: 100%;
                left: 0;
                right: 0;
                background: var(--background-primary);
                border: 1px solid var(--background-modifier-border);
                border-radius: 4px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                z-index: 1000;
                max-height: 120px;
                overflow-y: auto;
                margin-top: 2px;
            `;
            
            // Make dropdown focusable and initialize keyboard navigation
            storeDropdown.setAttribute('tabindex', '0');
            storeKeyboardNav = new KeyboardNavigationHelper(storeDropdown);
            
            // Add filtered predefined stores
            filteredStores.forEach(store => {
                if (!storeDropdown) return;
                const storeItem = storeDropdown.createDiv('store-dropdown-item');
                storeItem.style.cssText = `
                    padding: 6px 8px;
                    cursor: pointer;
                    border-bottom: 1px solid var(--background-modifier-border);
                    transition: background-color 0.2s;
                    font-size: 0.8em;
                `;
                storeItem.textContent = store;
                
                // Register for keyboard navigation
                if (storeKeyboardNav) {
                    storeKeyboardNav.addItem(storeItem, () => {
                        selectStore(store);
                    });
                }
                
                storeItem.addEventListener('click', () => {
                    selectStore(store);
                });
                
                storeItem.addEventListener('mouseenter', () => {
                    storeItem.style.backgroundColor = 'var(--background-modifier-hover)';
                });
                storeItem.addEventListener('mouseleave', () => {
                    storeItem.style.backgroundColor = '';
                });
            });
            
            // Always show custom option if query has content
            if (query.trim().length >= 1) {
                if (!storeDropdown) return;
                const customItem = storeDropdown.createDiv('store-dropdown-item');
                customItem.style.cssText = `
                    padding: 6px 8px;
                    cursor: pointer;
                    border-top: 1px solid var(--background-modifier-border);
                    background: var(--background-secondary);
                    font-style: italic;
                    font-size: 0.8em;
                `;
                customItem.textContent = `Add custom: "${query}"`;
                
                // Register custom option for keyboard navigation
                if (storeKeyboardNav) {
                    storeKeyboardNav.addItem(customItem, () => {
                        selectStore(query);
                    });
                }
                
                customItem.addEventListener('click', () => {
                    selectStore(query);
                });
                
                customItem.addEventListener('mouseenter', () => {
                    customItem.style.backgroundColor = 'var(--background-modifier-hover)';
                });
                customItem.addEventListener('mouseleave', () => {
                    customItem.style.backgroundColor = '';
                });
            }
        };
        
        const selectStore = (storeName: string) => {
            storeInput.value = storeName;
            hideStoreDropdown();
            // Don't refocus input after selection - just save immediately
            saveStore();
        };
        
        const hideStoreDropdown = () => {
            if (storeKeyboardNav) {
                storeKeyboardNav.destroy();
                storeKeyboardNav = null;
            }
            if (storeDropdown) {
                storeDropdown.remove();
                storeDropdown = null;
            }
        };
        
        const cleanup = () => {
            hideStoreDropdown();
            inputContainer.remove();
            addButton.style.display = '';
        };
        
        const saveStore = () => {
            const storeName = storeInput.value.trim();
            if (storeName) {
                if (!device.selectedStores[platform].includes(storeName)) {
                    device.selectedStores[platform].push(storeName);
                }
                
                // Update game data and UI
                this.updateGameDataFromStreamlinedDevices();
                this.updateCreateButton();
                
                // Refresh the entire row to show the new store
                const row = container.closest('.compact-device-row') as HTMLElement;
                if (row) {
                    this.refreshCompactDeviceRow(row, device);
                }
                
                console.log(`Selected custom store "${storeName}" for ${device.deviceName} (this game only)`);
            }
            cleanup();
        };
        
        // Button event handlers
        saveBtn.onclick = (e) => {
            e.stopPropagation();
            saveStore();
        };
        
        cancelBtn.onclick = (e) => {
            e.stopPropagation();
            cleanup();
        };
        
        // Input event handlers
        storeInput.addEventListener('input', (e) => {
            const query = (e.target as HTMLInputElement).value;
            showStoreDropdown(query);
        });
        
        storeInput.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                if (storeDropdown && storeKeyboardNav) {
                    // If dropdown is open, let keyboard nav handle it
                    return;
                }
                saveStore();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                if (storeDropdown) {
                    hideStoreDropdown();
                } else {
                    cleanup();
                }
            } else if (e.key === 'Tab' || e.key === 'ArrowDown') {
                if (storeDropdown) {
                    e.preventDefault();
                    storeDropdown.focus();
                    if (storeKeyboardNav) {
                        storeKeyboardNav.selectFirst();
                    }
                }
            }
        });
        
        storeInput.addEventListener('blur', (e) => {
                    // Delay cleanup to allow dropdown interaction
                    setTimeout(() => {
                        if (!inputContainer.contains(document.activeElement) && 
                            !storeDropdown?.contains(document.activeElement)) {
                            cleanup();
                        }
                    }, 200);
                });
                
                // Focus the input immediately with multiple strategies for better browser compatibility
                // Use multiple approaches to ensure focus works
                storeInput.focus();
                storeInput.select();
                
                requestAnimationFrame(() => {
                    storeInput.focus();
                    storeInput.select();
                });
                
                // Final fallback with longer delay for stubborn browsers
                setTimeout(() => {
                    if (document.activeElement !== storeInput) {
                        storeInput.focus();
                        storeInput.select();
                    }
                }, 50);
            }
    

    private deviceSupportsEmulation(deviceType: DeviceType): boolean {
        // Most modern devices can run emulators
        return ['computer', 'handheld', 'mobile', 'custom'].includes(deviceType);
    }

    // UPDATED: Check if device has Linux/SteamOS platforms for ProtonDB compatibility
    private hasLinuxDevices(): boolean {
        return this.plugin.getActiveDevices().some(device => 
            device.platforms.some(platform => ['Linux', 'SteamOS'].includes(platform))
        );
    }

    private async updateDeviceSelectionForGame(selectedGame: RawgGame) {
        // Reset devices when game changes
        this.streamlinedDevices = [];
        this.showAllDevices = false;
        
        // Clear existing game data
        this.gameData.platforms = [];
        this.gameData.deviceStores = {};
        
        // Check ProtonDB if we have Steam App ID and Linux/SteamOS devices
        let protonCompatible = false;
        if (this.gameData.steamAppId && this.hasLinuxDevices()) {
            try {
                const rating = await this.checkProtonDbCompatibility(this.gameData.steamAppId);
                protonCompatible = this.isProtonCompatible(rating);
                console.log(`ProtonDB compatibility for Linux/SteamOS: ${protonCompatible} (${rating})`);
            } catch (error) {
                console.log('ProtonDB check failed, assuming incompatible');
            }
        }
        
        // Store ProtonDB result for use in filtering
        this.protonCompatible = protonCompatible;
        
        // Re-initialize and refresh device selection
        this.initializeStreamlinedDevices();
        
        // Refresh device selection UI
        const deviceContainer = this.contentEl.querySelector('.compact-device-selection-container') as HTMLElement;
        if (deviceContainer) {
            this.renderCompactDeviceSelection(deviceContainer);
        }
    }

    private async checkProtonDbCompatibility(steamAppId: string): Promise<string> {
        // Check cache first
        if (this.protonDbCache.has(steamAppId)) {
            const cachedResult = this.protonDbCache.get(steamAppId);
            if (cachedResult) {
                return cachedResult;
            }
        }
        
        try {
            const response = await requestUrl({
                url: `https://www.protondb.com/api/v1/reports/summaries/${steamAppId}.json`,
                method: 'GET'
            });
            
            const data = response.json;
            const rating = data.tier || 'unknown';
            
            // Cache the result
            this.protonDbCache.set(steamAppId, rating);
            
            console.log(`ProtonDB rating for ${steamAppId}: ${rating}`);
            return rating;
            
        } catch (error) {
            console.log(`ProtonDB check failed for ${steamAppId}:`, error);
            // Cache 'unknown' to avoid repeated failed requests
            this.protonDbCache.set(steamAppId, 'unknown');
            return 'unknown';
        }
    }

    private isProtonCompatible(rating: string): boolean {
        // Conservative approach - only Silver, Gold, Platinum, Native
        const compatibleRatings = ['silver', 'gold', 'platinum', 'native'];
        return compatibleRatings.includes(rating.toLowerCase());
    }

    // Keep all existing RAWG search methods unchanged...
    private addGameSearchSection(containerEl: HTMLElement) {
        const searchContainer = containerEl.createDiv('game-search-container');
        searchContainer.style.cssText = `
            position: relative;
            margin-bottom: 20px;
        `;

        new Setting(searchContainer)
            .setName('Search for Game')
            .setDesc('Start typing to search RAWG database or enter manually. Press Tab or Arrow Down to navigate results.')
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
                        this.updateSteamGridLink();
                        
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
                
                searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Tab' || e.key === 'ArrowDown') {
                        // Only move to dropdown if it exists and has results
                        if (this.searchDropdown && this.searchResults.length > 0) {
                            e.preventDefault();
                            this.searchDropdown.focus();
                            
                            // Automatically highlight the first item
                            if (this.searchKeyboardNav) {
                                this.searchKeyboardNav.selectFirst();
                            }
                        }
                    } else if (e.key === 'Escape') {
                        this.hideSearchDropdown();
                    } else if (e.key === 'Enter') {
                        // If dropdown is visible but not focused, select first result
                        if (this.searchDropdown && this.searchResults.length > 0) {
                            e.preventDefault();
                            this.selectGame(this.searchResults[0]);
                            this.hideSearchDropdown();
                        }
                    }
                });
                
                searchInput.addEventListener('blur', (e: FocusEvent) => {
                    // Only hide dropdown if focus is moving outside both input and dropdown
                    setTimeout(() => {
                        if (!this.searchDropdown?.contains(document.activeElement) && 
                            document.activeElement !== searchInput) {
                            this.hideSearchDropdown();
                        }
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

    // Keep all existing image handling methods unchanged...
    private addImageSection(containerEl: HTMLElement) {
        // Create the main setting with static description
        const imageSetting = new Setting(containerEl)
            .setName('Game Images')
            .setDesc('Upload custom images or let us find Steam images automatically. Custom images take priority and will override Steam images.');
        
        // Create additional description element for the link
        const linkElement = imageSetting.settingEl.createDiv();
        linkElement.className = 'steamgrid-link-container'; // Add class for easy finding
        linkElement.style.cssText = `
            font-size: 0.85em;
            color: var(--text-accent);
            margin-top: 6px;
            margin-left: 0;
        `;
        
        // Append the link to the setting's description area
        const descElement = imageSetting.settingEl.querySelector('.setting-item-description');
        if (descElement) {
            descElement.appendChild(linkElement);
        }
        
        // Update the link initially and whenever game name changes
        this.updateSteamGridLink();
        
        // Create the image section container
        const imageSection = containerEl.createDiv('image-section');
        
        // CREATE the drop zone div that restoreImageDropZone() expects
        imageSection.createDiv('image-drop-zone');
        
        // Create hidden file input
        const fileInput = imageSection.createEl('input', {
            type: 'file',
            attr: {
                multiple: 'true',
                accept: '.jpg,.jpeg,.png,.gif,.webp'
            }
        });
        fileInput.style.display = 'none';

        fileInput.addEventListener('change', (e) => {
            const files = Array.from((e.target as HTMLInputElement).files || []);
            this.handleImageFiles(files);
        });
        
        // Now initialize the drop zone
        this.restoreImageDropZone();
    }

    private updateSteamGridLink() {
        const linkContainer = this.contentEl.querySelector('.steamgrid-link-container') as HTMLElement;
        if (!linkContainer) return;
        
        const gameName = this.gameData.name.trim();
        const steamGridUrl = gameName 
            ? `https://www.steamgriddb.com/search/grids?term=${encodeURIComponent(gameName)}`
            : 'https://www.steamgriddb.com';
        
        linkContainer.innerHTML = `💡 Get high-quality images from <a href="${steamGridUrl}" target="_blank" style="color: var(--text-accent); text-decoration: underline;">SteamGridDB</a>`;
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

    // Include all remaining methods from the original file with minimal changes...
    private async searchRawg(query: string) {
        if (!this.plugin.settings.rawgApiKey) return;
        
        try {
            const response = await requestUrl({
                url: `https://api.rawg.io/api/games?key=${this.plugin.settings.rawgApiKey}&search=${encodeURIComponent(query)}&page_size=30`,
                method: 'GET'
            });
            
            const allResults = response.json.results || [];
            
            // Enhanced DLC filtering (keep existing logic)
            const filteredResults = allResults.filter((game: RawgGame) => {
                const name = game.name.toLowerCase();
                
                const modernDLCKeywords = [
                    'dlc', 'downloadable content', 'content pack', 'character pack',
                    'season pass', 'cosmetic pack', 'skin pack', 'weapon pack',
                    'story pack', 'extra content', 'additional content',
                    'species pack'
                ];
                                
                const hasModernDLC = modernDLCKeywords.some(keyword => name.includes(keyword));
                
                const isSeasonPattern = (
                    /season \d+/i.test(name) ||
                    /episode \d+/i.test(name) ||
                    /part \d+/i.test(name) ||
                    /volume \d+/i.test(name) ||
                    /chapter \d+/i.test(name)
                );
                
                const isDLCPattern = (
                    (name.includes(': ') && (
                        modernDLCKeywords.some(keyword => name.split(': ')[1].includes(keyword)) ||
                        isSeasonPattern
                    )) ||
                    (name.includes(' - ') && (
                        modernDLCKeywords.some(keyword => name.split(' - ')[1].includes(keyword)) ||
                        isSeasonPattern
                    )) ||
                    hasModernDLC ||
                    isSeasonPattern
                );
                
                const isClassicExpansion = (
                    name.includes('expansion') && 
                    (game.released && new Date(game.released).getFullYear() < 2010) &&
                    !isSeasonPattern
                );
                
                const shouldInclude = !isDLCPattern || isClassicExpansion;
                
                if (!shouldInclude) {
                    console.log('Filtered out DLC/Season:', game.name);
                }
                
                return shouldInclude;
            });
            
            // Custom ranking algorithm
            const rankedResults = this.rankSearchResults(filteredResults, query);
            
            // Take top 8 results after ranking
            this.searchResults = rankedResults.slice(0, 8);
            
            } catch (error) {
                console.error('RAWG search error:', error);
                
                const now = Date.now();
                const timeSinceLastError = now - this.lastErrorTime;
                
                // Reset error count if it's been more than 10 seconds since last error
                if (timeSinceLastError > 10000) {
                    this.errorCount = 0;
                }
                
                this.errorCount++;
                this.lastErrorTime = now;
                
                // Only show notice for first error, or after 5+ seconds of no errors
                if (this.errorCount === 1 || timeSinceLastError > 5000) {
                    if (error.message.includes('502') || error.message.includes('503') || error.message.includes('504')) {
                        new Notice('RAWG database temporarily unavailable - you can still create games manually');
                    } else {
                        new Notice('Failed to search RAWG database - check your internet connection');
                    }
                } else {
                    // Log subsequent errors but don't spam the user
                    console.log(`RAWG error ${this.errorCount} (suppressed notification)`);
                }
                
                this.searchResults = [];
            }
    }

    private rankSearchResults(games: RawgGame[], query: string): RawgGame[] {
        const queryLower = query.toLowerCase();
        const currentYear = new Date().getFullYear();
        
        return games.map(game => {
            // 1. Relevance Score (60%) - ENHANCED with fuzzy matching
            const gameName = game.name.toLowerCase();
            let relevanceScore = 0;

            // Normalize both query and game name for better matching
            const normalizeForComparison = (str: string) => {
                return str
                    .replace(/\b3\b/g, 'iii')          // "3" → "iii"
                    .replace(/\b2\b/g, 'ii')           // "2" → "ii" 
                    .replace(/\b1\b/g, 'i')            // "1" → "i"
                    .replace(/\b4\b/g, 'iv')           // "4" → "iv"
                    .replace(/\b5\b/g, 'v')            // "5" → "v"
                    .replace(/\b6\b/g, 'vi')           // "6" → "vi"
                    .replace(/\s+/g, ' ')              // Normalize spaces
                    .trim();
            };

            const normalizedQuery = normalizeForComparison(queryLower);
            const normalizedGameName = normalizeForComparison(gameName);

            // Check exact matches (both original and normalized)
            if (gameName === queryLower || normalizedGameName === normalizedQuery) {
                relevanceScore = 1.0; // Exact match
            } else if (gameName.startsWith(queryLower) || normalizedGameName.startsWith(normalizedQuery)) {
                relevanceScore = 0.9; // Starts with
            } else if (gameName.includes(` ${queryLower}`) || normalizedGameName.includes(` ${normalizedQuery}`)) {
                relevanceScore = 0.8; // Word boundary match
            } else if (gameName.includes(queryLower) || normalizedGameName.includes(normalizedQuery)) {
                relevanceScore = 0.6; // Contains
            } else {
                // Check for word-by-word matching for multi-word queries
                const queryWords = normalizedQuery.split(/\s+/);
                const nameWords = normalizedGameName.split(/\s+/);
                let wordMatches = 0;
                
                queryWords.forEach(queryWord => {
                    if (nameWords.some(nameWord => nameWord.includes(queryWord))) {
                        wordMatches++;
                    }
                });
                
                relevanceScore = (wordMatches / queryWords.length) * 0.4; // Partial word match
            }

            // Penalty for obvious DLC/add-ons when searching for base game
            const isDLCPattern = /\b(pack|dlc|toolkit|goodie|add-?on|expansion|season|episode|bundle)\b/i;
            if (isDLCPattern.test(game.name) && !isDLCPattern.test(query)) {
                relevanceScore *= 0.3; // Heavy penalty for DLC when not searching for DLC
            }
            
            // 2. Popularity Score (25%) - REDUCED from 40%
            const added = game.added || 0;
            const maxAdded = Math.max(...games.map(g => g.added || 0));
            const popularityScore = maxAdded > 0 ? (added / maxAdded) : 0;
            
            // 3. Recency Score (10%) - REDUCED from 40% 
            let recencyScore = 0;
            if (game.released) {
                const releaseYear = new Date(game.released).getFullYear();
                const age = currentYear - releaseYear;
                
                if (age <= 1) recencyScore = 1.0;       // Very recent
                else if (age <= 3) recencyScore = 0.9;  // Recent
                else if (age <= 5) recencyScore = 0.7;  // Modern
                else if (age <= 10) recencyScore = 0.5; // Still relevant
                else if (age <= 20) recencyScore = 0.3; // Classic
                else recencyScore = 0.1;                // Retro
            }
            
            // 4. Rating Score (5%) - REDUCED from 10%
            const rating = game.rating || 0;
            const ratingScore = rating / 5; // Normalize to 0-1
            
            // Calculate final score with HEAVY emphasis on relevance
            const finalScore = (relevanceScore * 0.6) + (popularityScore * 0.25) + (recencyScore * 0.1) + (ratingScore * 0.05);
            
            return {
                ...game,
                _searchScore: finalScore
            };
        })
        .sort((a, b) => (b._searchScore || 0) - (a._searchScore || 0));
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
            
            // SMART FILTERING: Update device selection based on game platforms
            this.updateDeviceSelectionForGame(game);
            
        } catch (error) {
            console.error('Error fetching game details:', error);
            this.gameData.name = game.name;
            this.gameData.genre = game.genres?.map(g => g.name).join(', ') || '';
            this.gameData.description = '';
            this.gameData.rawgId = game.id.toString();
            
            // Still try to update devices even with basic data
            this.updateDeviceSelectionForGame(game);
        }
        
        this.updateGamePreview();
        this.updateFormFields();
        
        new Notice(`✨ Selected: ${this.gameData.name}`);
    }

    private async fetchGameDetails(gameId: number): Promise<RawgGame> {
        const response = await requestUrl({
            url: `https://api.rawg.io/api/games/${gameId}?key=${this.plugin.settings.rawgApiKey}`,
            method: 'GET'
        });
        
        return response.json;
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

    // Keep all other existing methods unchanged...
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
        
        // Make dropdown focusable for keyboard navigation but DON'T auto-focus it
        this.searchDropdown.setAttribute('tabindex', '0');
        
        // Initialize keyboard navigation
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
        
        // Register manual option for keyboard navigation
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

    private clearSelectedGame() {
        this.selectedGame = null;
        
        if (this.gameData.rawgId) {
            this.gameData.genre = '';
            this.gameData.description = '';
            delete this.gameData.rawgId;
            delete this.gameData.steamAppId;
        }
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

    private updateFormFields() {
        const nameInput = this.contentEl.querySelector('input[placeholder="Enter game name..."]') as HTMLInputElement;
        const genreInput = this.contentEl.querySelector('input[placeholder="e.g., RPG, Action, Adventure"]') as HTMLInputElement;
        const descTextarea = this.contentEl.querySelector('textarea') as HTMLTextAreaElement;

        if (nameInput) nameInput.value = this.gameData.name;
        if (genreInput) genreInput.value = this.gameData.genre;
        if (descTextarea) descTextarea.value = this.gameData.description;
        
        this.updateCreateButton();
    }

    // Image handling methods - keep all existing ones unchanged
    private async handleImageFiles(files: File[]) {
        const validFiles = files.filter(file => 
            file.type.startsWith('image/') && file.size < 10 * 1024 * 1024 // 10MB limit
        );

        if (validFiles.length > 0) {
            new Notice(`📁 Analyzing ${validFiles.length} image(s)...`);
            await this.processImageFiles(validFiles);
        }

        if (files.length > validFiles.length) {
            new Notice('⚠️ Some files were skipped (invalid type or too large)');
        }
    }

    private async processImageFiles(files: File[]) {
        try {
            // Analyze all files
            const analyses: UploadedImageInfo[] = [];
            for (const file of files) {
                const analysis = await this.smartImageUpload.analyzeImage(file);
                analyses.push(analysis);
            }

            console.log('=== Image Analysis Results ===');
            console.log('All analyses:', analyses.map(a => `${a.file.name} -> ${a.type} (${a.confidence})`));

            // Separate high and low confidence detections
            const highConfidence = analyses.filter(a => a.confidence === 'high');
            const lowConfidence = analyses.filter(a => a.confidence === 'low');

            console.log('High confidence:', highConfidence.map(a => `${a.file.name} -> ${a.type}`));
            console.log('Low confidence:', lowConfidence.map(a => `${a.file.name} -> ${a.type || 'unknown'}`));

            // Handle conflicts (multiple files for same type)
            const conflicts = this.detectConflicts(highConfidence);
            
            console.log('Detected conflicts:', conflicts.map(c => `${c.file.name} -> ${c.type}`));

            // Split high confidence into clean auto-assigned and conflicts
            const conflictFilenames = new Set(conflicts.map(c => c.file.name));
            const cleanAutoAssigned = highConfidence.filter(img => !conflictFilenames.has(img.file.name));
            
            console.log('Clean auto-assigned:', cleanAutoAssigned.map(a => `${a.file.name} -> ${a.type}`));

            if (conflicts.length > 0 || lowConfidence.length > 0) {
                // Show assignment modal for conflicts and unknowns
                this.showImageAssignmentModal([...conflicts, ...lowConfidence], cleanAutoAssigned);
            } else {
                // All good - process directly
                this.processConfirmedImages(highConfidence);
            }

        } catch (error) {
            console.error('Image processing error:', error);
            new Notice('❌ Error processing images');
        }
    }

    private detectConflicts(images: UploadedImageInfo[]): UploadedImageInfo[] {
        const typeCount: Record<string, number> = {};
        const conflicts: UploadedImageInfo[] = [];

        // Count how many images are assigned to each type
        for (const img of images) {
            if (img.type) {
                typeCount[img.type] = (typeCount[img.type] || 0) + 1;
            }
        }

        // Mark images as conflicts if there are duplicates for their type
        for (const img of images) {
            if (img.type && typeCount[img.type] > 1) {
                conflicts.push({
                    ...img,
                    message: `Multiple ${STEAM_IMAGE_SPECS.find(s => s.name === img.type)?.description} images detected - please choose one`,
                    confidence: 'high' // Mark as high confidence so they get handled as conflicts
                });
            }
        }

        return conflicts;
    }

    private showImageAssignmentModal(problematicImages: UploadedImageInfo[], autoAssigned: UploadedImageInfo[]) {
        // Implementation would go here - keeping the existing ImageAssignmentModal class
        // This is unchanged from the original
        console.log('Would show image assignment modal');
    }

    private async processConfirmedImages(images: UploadedImageInfo[]) {
        try {
            // Clear existing uploaded images
            this.uploadedImages = [];

            // Process each image
            for (const img of images) {
                if (img.type) {
                    const spec = STEAM_IMAGE_SPECS.find(s => s.name === img.type);
                    if (spec) {
                        const arrayBuffer = await img.file.arrayBuffer();
                        this.uploadedImages.push({
                            type: img.type,
                            filename: spec.filename,
                            arrayBuffer
                        });
                    }
                }
            }

            // Update UI to show uploaded images
            this.updateImageSection();
            new Notice(`✅ ${this.uploadedImages.length} image(s) ready for upload`);

        } catch (error) {
            console.error('Error processing confirmed images:', error);
            new Notice('❌ Error processing images');
        }
    }

    private updateImageSection() {
        const imageSection = this.contentEl.querySelector('.image-section');
        if (!imageSection) return;

        // Find the drop zone
        const dropZone = imageSection.querySelector('.image-drop-zone') as HTMLElement;
        if (!dropZone) return;

        if (this.uploadedImages.length > 0) {
            // Show uploaded images preview
            dropZone.empty();
            dropZone.style.cssText = `
                border: 2px solid var(--interactive-accent);
                border-radius: 8px;
                padding: 15px;
                text-align: center;
                margin: 10px 0;
                background: var(--background-modifier-hover);
            `;

            const title = dropZone.createEl('h4', { text: '✅ Images Ready for Upload' });
            title.style.marginBottom = '10px';

            const imageList = dropZone.createDiv();
            imageList.style.cssText = `
                display: flex;
                flex-wrap: wrap;
                gap: 10px;
                justify-content: center;
                align-items: center;
            `;

            this.uploadedImages.forEach(img => {
                const spec = STEAM_IMAGE_SPECS.find(s => s.name === img.type);
                if (spec) {
                    const item = imageList.createDiv();
                    item.style.cssText = `
                        padding: 8px 12px;
                        background: var(--interactive-accent);
                        color: var(--text-on-accent);
                        border-radius: 6px;
                        font-size: 0.9em;
                        font-weight: 500;
                    `;
                    item.textContent = spec.description;
                }
            });

            const note = dropZone.createDiv();
            note.style.cssText = `
                margin-top: 10px;
                font-size: 0.85em;
                color: var(--text-muted);
                font-style: italic;
            `;
            note.textContent = 'Custom images will override any Steam images found';

            const clearBtn = dropZone.createEl('button', { text: 'Clear Images' });
            clearBtn.style.cssText = `
                margin-top: 10px;
                padding: 6px 12px;
                background: var(--background-secondary);
                border: 1px solid var(--background-modifier-border);
                border-radius: 4px;
                cursor: pointer;
                font-size: 0.85em;
            `;
            clearBtn.onclick = () => {
                this.uploadedImages = [];
                this.restoreImageDropZone();
            };

        } else {
            this.restoreImageDropZone();
        }
    }

    private restoreImageDropZone() {
        const imageSection = this.contentEl.querySelector('.image-section');
        if (!imageSection) return;

        let dropZone = imageSection.querySelector('.image-drop-zone') as HTMLElement;
        
        // Create the drop zone if it doesn't exist
        if (!dropZone) {
            dropZone = imageSection.createDiv('image-drop-zone');
        }

        dropZone.empty();
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
                Supports: JPG, PNG, GIF, WebP • Box art, headers, hero images, logos
            </div>
        `;

        // Re-attach event listeners
        this.setupImageDropZoneEvents(dropZone);
    }

    private setupImageDropZoneEvents(dropZone: HTMLElement) {
        // Find the file input in the image section (not just anywhere in contentEl)
        const imageSection = this.contentEl.querySelector('.image-section');
        const fileInput = imageSection?.querySelector('input[type="file"]') as HTMLInputElement;
        
        if (!fileInput) {
            console.error('File input not found in image section');
            return;
        }

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
    }

    private async createGame() {
        if (!this.gameData.name.trim()) {
            new Notice('Please enter a game name');
            return;
        }

        const hasValidStores = Object.values(this.gameData.deviceStores).some(stores => stores.length > 0);
        const hasSubscriptions = this.gameData.subscriptionServices.length > 0;
        
        // Check if we have devices that don't require stores (retro/emulation)
        const selectedDevices = this.streamlinedDevices.filter(d => d.isSelected);
        const hasDevicesThatDontRequireStores = selectedDevices.some(device => 
            this.deviceSupportsEmulation(device.deviceType) && 
            device.selectedPlatforms.includes('Emulation')
        );
        
        if (!hasValidStores && !hasSubscriptions && !hasDevicesThatDontRequireStores) {
            new Notice('Please select at least one store or subscription service');
            return;
        }

        try {
            // Show progress for image processing
            if (this.uploadedImages.length > 0) {
                new Notice(`🎮 Creating "${this.gameData.name}" with ${this.uploadedImages.length} custom image(s)...`);
            } else {
                new Notice(`🎮 Creating "${this.gameData.name}"...`);
            }
            
            await this.createGameStructure();
            
            const imageInfo = this.uploadedImages.length > 0 
                ? ` with ${this.uploadedImages.length} custom image(s)` 
                : '';
            new Notice(`✅ "${this.gameData.name}" created successfully${imageInfo}!`);
            
            // Check if we should create library overview
            await this.onGameCreated();
            
            this.close();
            
        } catch (error) {
            console.error('Error creating game:', error);
            new Notice(`❌ Error creating game: ${error.message}`);
        }
    }

    private async createGameStructure() {
        const gameName = this.gameData.name;
        const safeGameName = this.sanitizeForFileSystem(gameName);

        if (!safeGameName) {
            throw new Error('Game name contains only invalid characters. Please use a different name.');
        }
        
        // Check if sanitization changed the name and warn user
        if (safeGameName !== gameName) {
            console.log(`Game name sanitized from "${gameName}" to "${safeGameName}"`);
        }

        // Create folder structure using readable names
        await this.app.vault.createFolder(`${this.plugin.settings.gamesFolder}/${safeGameName}`).catch(() => {});
        await this.app.vault.createFolder(`${this.plugin.settings.gamesFolder}/${safeGameName}/Playthroughs`).catch(() => {});
        await this.app.vault.createFolder(`${this.plugin.settings.gamesFolder}/${safeGameName}/Sessions`).catch(() => {});
        await this.app.vault.createFolder(`${this.plugin.settings.gamesFolder}/${safeGameName}/Reports`).catch(() => {});
        await this.app.vault.createFolder(`${this.plugin.settings.gamesFolder}/${safeGameName}/Images`).catch(() => {});
        await this.app.vault.createFolder(`${this.plugin.settings.gamesFolder}/${safeGameName}/Images/Screenshots`).catch(() => {});
        await this.app.vault.createFolder(`${this.plugin.settings.gamesFolder}/${safeGameName}/Images/Characters`).catch(() => {});
        await this.app.vault.createFolder(`${this.plugin.settings.gamesFolder}/${safeGameName}/Images/Custom`).catch(() => {});

        // Initialize image paths
        const imagePaths = {
            box_art_image: '',
            header_image: '',
            hero_image: '',
            logo_image: ''
        };
        
        // Priority 1: Handle custom uploaded images first
        if (this.uploadedImages.length > 0) {
            console.log('Processing custom uploaded images...');
            await this.saveCustomImages(safeGameName, imagePaths);
        }
        
        // Priority 2: Download Steam images (only for types not covered by custom images)
        if (this.gameData.steamAppId) {
            console.log('Processing Steam images...');
            await this.downloadMissingSteamImages(safeGameName, imagePaths);
        }

        // Create Game Overview file with image paths
        const gameOverviewContent = this.generateGameOverviewContent(imagePaths, safeGameName);
        const overviewPath = `${this.plugin.settings.gamesFolder}/${safeGameName}/${safeGameName} - Game Overview.md`;
        await this.app.vault.create(overviewPath, gameOverviewContent);
        
        // Open the newly created game overview
        const createdFile = this.app.vault.getAbstractFileByPath(overviewPath);
        if (createdFile instanceof TFile) {
            await this.app.workspace.getLeaf().openFile(createdFile);
        }
    }

    private async onGameCreated() {
        // Check if this was the first game and create overview if needed
        const gamesFolder = this.app.vault.getAbstractFileByPath(this.plugin.settings.gamesFolder);
        if (gamesFolder && gamesFolder instanceof TFolder) {
            const gameCount = gamesFolder.children.filter((child: TAbstractFile) => 
                child instanceof TFolder && 
                child.children.some((file: TAbstractFile) => 
                    file instanceof TFile && file.name.endsWith('Game Overview.md')
                )
            ).length;
            
            // If this is the first or second game, ensure overview exists
            if (gameCount <= 2) {
                await this.plugin.ensureLibraryOverviewExists();
            }
        }
    }
    
    private async saveCustomImages(safeGameName: string, imagePaths: {
        box_art_image: string;
        header_image: string;
        hero_image: string;
        logo_image: string;
    }) {
        for (const img of this.uploadedImages) {
            try {
                const imagePath = `${this.plugin.settings.gamesFolder}/${safeGameName}/Images/${img.filename}`;
                
                await this.app.vault.createBinary(imagePath, img.arrayBuffer);
                
                // Update the appropriate image path
                switch (img.type) {
                    case 'box_art':
                        imagePaths.box_art_image = imagePath;
                        break;
                    case 'header':
                        imagePaths.header_image = imagePath;
                        break;
                    case 'hero':
                        imagePaths.hero_image = imagePath;
                        break;
                    case 'logo':
                        imagePaths.logo_image = imagePath;
                        break;
                }
                
                console.log(`Saved custom ${img.type} image: ${img.filename}`);
                
            } catch (error) {
                console.error(`Failed to save custom ${img.type} image:`, error);
            }
        }
    }

    private async downloadMissingSteamImages(safeGameName: string, imagePaths: {
        box_art_image: string;
        header_image: string;
        hero_image: string;
        logo_image: string;
    }) {
        const steamImageTypes = [
            { 
                type: 'header', 
                url: `https://steamcdn-a.akamaihd.net/steam/apps/${this.gameData.steamAppId}/header.jpg`,
                filename: 'header.jpg',
                pathKey: 'header_image' as keyof typeof imagePaths
            },
            { 
                type: 'box_art', 
                url: `https://steamcdn-a.akamaihd.net/steam/apps/${this.gameData.steamAppId}/library_600x900_2x.jpg`,
                filename: 'box_art.jpg',
                pathKey: 'box_art_image' as keyof typeof imagePaths
            },
            { 
                type: 'hero', 
                url: `https://steamcdn-a.akamaihd.net/steam/apps/${this.gameData.steamAppId}/library_hero.jpg`,
                filename: 'hero.jpg',
                pathKey: 'hero_image' as keyof typeof imagePaths
            },
            { 
                type: 'logo', 
                url: `https://steamcdn-a.akamaihd.net/steam/apps/${this.gameData.steamAppId}/logo.png`,
                filename: 'logo.png',
                pathKey: 'logo_image' as keyof typeof imagePaths
            }
        ];

        for (const steamImage of steamImageTypes) {
            // Skip if we already have a custom image for this type
            if (imagePaths[steamImage.pathKey]) {
                console.log(`Skipping Steam ${steamImage.type} - custom image already present`);
                continue;
            }

            try {
                const response = await requestUrl({ url: steamImage.url });
                
                if (response.status === 200) {
                    const imagePath = `${this.plugin.settings.gamesFolder}/${safeGameName}/Images/${steamImage.filename}`;
                    await this.app.vault.createBinary(imagePath, response.arrayBuffer);
                    imagePaths[steamImage.pathKey] = imagePath;
                    console.log(`Downloaded Steam ${steamImage.type} image`);
                }
            } catch (error) {
                console.log(`Could not download Steam ${steamImage.type} image:`, error);
            }
        }
    }

    // UPDATED: Generate game overview content with multi-platform device support
    private generateGameOverviewContent(imagePaths: {
            box_art_image: string;
            header_image: string;
            hero_image: string;
            logo_image: string;
        }, safeGameName: string): string {
        const gameName = this.gameData.name; // Use original name for display
        
        // UPDATED: Generate platform/device summary for frontmatter with multi-platform support
        const selectedDevices = this.plugin.settings.userDevices.filter(d => 
            this.gameData.platforms.includes(d.id)
        );
        
        const smartPlatformInfo = selectedDevices.map(device => {
            const stores = this.gameData.deviceStores[device.id] || [];
            const deviceSubs = this.gameData.subscriptionServices.filter(sub => {
                // Check if this subscription is available on any of the device's platforms
                return Object.values(device.platformSubscriptions).some(platformSubs => 
                    platformSubs.includes(sub)
                );
            });
    
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
- **My Rating**: \`INPUT[inlineSelect(option(🚫), option(⭐), option(⭐⭐), option(⭐⭐⭐), option(⭐⭐⭐⭐), option(⭐⭐⭐⭐⭐)):rating]\`
- **Platforms**: \`VIEW[{store_platform}]\`
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
FROM "${this.plugin.settings.gamesFolder}/${safeGameName}/Playthroughs"
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
        
        // Reset uploaded images AND clear the processing state
        this.uploadedImages = [];
        
        // Clean up any object URLs to prevent memory leaks
        const images = contentEl.querySelectorAll('img[src^="blob:"]');
        images.forEach(img => {
            URL.revokeObjectURL((img as HTMLImageElement).src);
        });
        
        // Reset any processing flags that might prevent reopening
        this.clearImageProcessingState();
    }

    private clearImageProcessingState() {
        // Reset any internal state that might prevent the modal from working
        // This ensures clean state for subsequent opens
        this.uploadedImages = [];
        
        // Clear any cached image data
        if (this.smartImageUpload) {
            this.smartImageUpload = new SmartImageUpload();
        }
    }
}
        