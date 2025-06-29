export interface KeyboardNavigableItem {
    element: HTMLElement;
    onSelect: () => void;
}

export class KeyboardNavigationHelper {
    private items: KeyboardNavigableItem[] = [];
    private selectedIndex = -1;
    private container: HTMLElement;

    constructor(container: HTMLElement) {
        this.container = container;
        this.setupEventListeners();
    }

    addItem(element: HTMLElement, onSelect: () => void) {
        this.items.push({ element, onSelect });
        element.setAttribute('data-keyboard-index', (this.items.length - 1).toString());
    }

    private setupEventListeners() {
        this.container.addEventListener('keydown', (e) => {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    this.moveSelection(1);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.moveSelection(-1);
                    break;
                case 'Enter':
                    e.preventDefault();
                    this.selectCurrent();
                    break;
                case 'Escape':
                    e.preventDefault();
                    this.clearSelection();
                    break;
            }
        });
    }

    private moveSelection(direction: number) {
        // Clear previous selection
        if (this.selectedIndex >= 0 && this.items[this.selectedIndex]) {
            this.items[this.selectedIndex].element.classList.remove('keyboard-selected');
        }

        // Calculate new index
        this.selectedIndex += direction;
        if (this.selectedIndex >= this.items.length) {
            this.selectedIndex = 0;
        } else if (this.selectedIndex < 0) {
            this.selectedIndex = this.items.length - 1;
        }

        // Apply new selection
        if (this.items[this.selectedIndex]) {
            this.items[this.selectedIndex].element.classList.add('keyboard-selected');
            this.items[this.selectedIndex].element.scrollIntoView({ block: 'nearest' });
        }
    }

    private selectCurrent() {
        if (this.selectedIndex >= 0 && this.items[this.selectedIndex]) {
            this.items[this.selectedIndex].onSelect();
        }
    }

    clearSelection() {
        if (this.selectedIndex >= 0 && this.items[this.selectedIndex]) {
            this.items[this.selectedIndex].element.classList.remove('keyboard-selected');
        }
        this.selectedIndex = -1;
    }

    destroy() {
        this.items = [];
        this.selectedIndex = -1;
    }
}